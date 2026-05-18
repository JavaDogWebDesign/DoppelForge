// HAR (HTTP Archive 1.2) processing.
//
// A HAR is NOT another InputFormat fed through parseInput/transform — it is a
// *container* of many request/response bodies plus connection metadata. Run
// the generic engine over the whole HAR and it would mangle timings, status
// codes, and mime types. So this module is a separate orchestrator that walks
// `log.entries[]` and reuses the existing engine per-body.
//
// Everything doppelforge can change in a HAR is surfaced as a flat list of
// `RedactionTarget`s — one per distinct value of a header / cookie / query or
// form param / JSON body field / server IP. Each target shows `original ->
// replacement` and is individually controllable, so the UI can present the
// whole HAR as one value tree (the model the main field panel uses).
//
// Per-value identity: a target id is `${section}:${nameKey}:${hash(value)}`, so
// the same (name, value) seen across many entries collapses to one target, and
// re-running with the same HAR reproduces identical ids.
//
// Every body transform is wrapped in try/catch: one malformed body must never
// abort the whole HAR (research doc, risk #3). Failures are reported per-entry.

import { TransformEngine, type FieldSummary } from "./TransformEngine";
import { ConsistencyCache } from "./Cache";
import { DEFAULT_SEED, GeneratorRegistry } from "./GeneratorRegistry";
import { parseInput, serialize } from "./xml";
import { errMsg } from "../utils/errMsg";
import { LOCALE_TYPES } from "./GenericDetector";
import {
  isSecretHeader,
  isSensitiveCookie,
  isSensitiveParam,
  redactUrl,
  urlHasSecrets,
} from "./harRedact";

// Body-field types kept verbatim by default — regional data, plain dates, and
// catalog codes (SKUs). Each is coarse, low-PII, and usually needed intact for
// API research; a birthdate is a `birthDate`, not an `isoDate`, so it is
// deliberately absent and still obfuscated. The user can opt any of these in
// per value.
const KEPT_BY_DEFAULT = new Set<string>([...LOCALE_TYPES, "isoDate", "sku"]);

/** Which categories of redaction to apply. Master switches above the per-value
 *  tree — a per-value opt-in is ignored if its category is off. */
export interface RedactionPolicy {
  /** Auth headers (request + response) and all cookies. */
  headers: boolean;
  /** Secret query-string params, postData params, and URL userinfo. */
  params: boolean;
  /** Obfuscate request/response body fields through the engine. */
  bodies: boolean;
  /** Replace serverIPAddress with a synthetic IP. */
  ips: boolean;
}

export const DEFAULT_POLICY: RedactionPolicy = {
  headers: true,
  params: true,
  bodies: true,
  ips: true,
};

/** The five surfaces a target can belong to. */
export type TargetSection = "header" | "cookie" | "param" | "body" | "ip";

/** Where a value appears — one entry of the HAR. Lets the UI trace a value
 *  back to the request that carried it. */
export interface TargetLocation {
  /** Index into `log.entries[]`. */
  entry: number;
  /** HTTP method of that entry's request. */
  method: string;
  /** That entry's request URL, shortened to host + path. */
  url: string;
}

/** Up to this many locations are kept per target — enough to trace a value
 *  without bloating the payload when one value spans hundreds of entries. */
const MAX_LOCATIONS = 20;

/**
 * One distinct value doppelforge can change, with the value it would become.
 * Deduplicated by (section, name, value) across the whole HAR.
 */
export interface RedactionTarget {
  /** Stable key — `${section}:${nameKey}:${hash(value)}`. */
  id: string;
  section: TargetSection;
  /** Header/cookie/param name, body JSON path, or "serverIPAddress". */
  name: string;
  /** The real value, truncated for display/transport. */
  original: string;
  /** What it becomes with the current decision applied (=== original if kept). */
  replacement: string;
  /** Effective decision for this run. */
  redact: boolean;
  /** Whether doppelforge would change it with no user override. */
  redactedByDefault: boolean;
  /** Short human explanation of why this value was (or wasn't) flagged. */
  reason: string;
  /** How many times this exact value appears in the HAR. */
  occurrences: number;
  /** Entries this value appears in (capped at MAX_LOCATIONS for transport). */
  locations: TargetLocation[];
}

/** User's decision for one target: redact or keep, plus an optional literal
 *  replacement (when omitted, a realistic shape-preserving fake is used). */
export interface HarOverrideRule {
  redact: boolean;
  value?: string;
}

/** Keyed by `RedactionTarget.id`. */
export type HarOverrides = Record<string, HarOverrideRule>;

export interface HarStats {
  entries: number;
  bodiesObfuscated: number;
  bodiesSkipped: number;
  headersRedacted: number;
  cookiesRedacted: number;
  paramsRedacted: number;
  ipsRedacted: number;
  /** Per-entry failures. A non-empty list means some data was left as-is. */
  entryErrors: Array<{ entry: number; message: string }>;
}

export interface ProcessHarOptions {
  /** Seed for the generator registry; same seed -> same synthetic values. */
  seed?: number;
  /** Which redaction categories to apply. Defaults to all on. */
  policy?: RedactionPolicy;
  /** Per-target opt-in / opt-out / custom-value rules, keyed by target id. */
  overrides?: HarOverrides;
}

export interface ProcessHarResult {
  /** The mutated HAR tree, ready to JSON.stringify. */
  har: unknown;
  stats: HarStats;
  /** Every distinct changeable value — drives the review/control tree. */
  targets: RedactionTarget[];
}

/** Loose shape — extra/unknown keys (Chrome `_initiator`, Firefox extensions,
 *  proxy quirks) are tolerated and passed through untouched. */
interface HarRoot {
  log: { entries: unknown[]; [k: string]: unknown };
  [k: string]: unknown;
}

/** Structural check. Forgiving on purpose: only `log.entries` being an array
 *  is required, so HARs from any exporter validate. */
export function isHarLike(data: unknown): data is HarRoot {
  const root = asRecord(data);
  if (!root) return false;
  const log = asRecord(root.log);
  if (!log) return false;
  return Array.isArray(log.entries);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** FNV-1a, base36. Compact, stable hash for target ids. */
function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Cap a value for display/transport. 512 is generous enough for the expanded
 *  detail view to show a value in full while still bounding the payload. */
function disp(s: string, max = 512): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Case-insensitive for headers (HTTP folds case); exact for everything else. */
function nameKey(section: TargetSection, name: string): string {
  return section === "header" ? name.toLowerCase() : name;
}

export function targetId(
  section: TargetSection,
  name: string,
  value: string,
): string {
  return `${section}:${nameKey(section, name)}:${hashStr(value)}`;
}

// Short, tag-sized "why this was flagged" labels.

/** Why a header / cookie / param was (or wasn't) flagged. */
function nameReason(section: "header" | "cookie" | "param", def: boolean): string {
  if (section === "cookie") return def ? "session cookie" : "preference cookie";
  if (section === "header") return def ? "credential header" : "standard header";
  return def ? "secret-looking param" : "standard param";
}

// Friendly labels for the engine's semantic field types.
const BODY_REASON: Record<string, string> = {
  email: "email address",
  phone: "phone number",
  firstName: "first name",
  lastName: "last name",
  fullName: "person name",
  street: "street address",
  streetSecondary: "address line",
  city: "city",
  state: "state",
  stateOrProvince: "state / province",
  postalCode: "postal code",
  country: "country",
  countryCode: "country code",
  company: "company name",
  id: "identifier",
  uuid: "UUID",
  ipv4: "IP address",
  isoDate: "date",
  birthDate: "date of birth",
  unixTimestamp: "timestamp",
  url: "URL",
  sku: "SKU",
  productName: "product name",
  currency: "currency",
  priceAmount: "price",
  cvvCode: "CVV code",
  avsCode: "AVS code",
  redact: "sensitive value",
};

function bodyReason(type: string, changed: boolean): string {
  if (!changed) return "no PII detected";
  return BODY_REASON[type] ?? "sensitive value";
}

/**
 * Decide whether a body should be fed to the obfuscation engine. Base64-encoded
 * bodies (images, fonts, wasm) are skipped — no PII value and 80-95% of bytes
 * in large HARs. Only structured text mime types are obfuscatable; HTML, JS,
 * CSS, and plain text are skipped. See docs ("Mime-type fast-path").
 */
export function bodyIsObfuscatable(
  mimeType: string,
  encoding: string | undefined,
): boolean {
  if (encoding && encoding.trim().toLowerCase() === "base64") return false;
  const mt = mimeType.split(";")[0].trim().toLowerCase();
  if (!mt) return false;
  // Media types are binary even when the subtype carries a `+xml` / `+json`
  // suffix — image/svg+xml is an image, not an obfuscatable document.
  if (/^(image|audio|video|font)\//.test(mt)) return false;
  return (
    mt.includes("json") ||
    mt.includes("xml") ||
    mt === "application/x-www-form-urlencoded" ||
    mt === "text/csv" ||
    mt.endsWith("+csv")
  );
}

/**
 * Whether a body's text is compressed or base64-encoded rather than the JSON /
 * XML / form text its mime claims — gzip/zlib magic bytes, other binary control
 * characters, or a bare base64 blob (some exporters store a body base64-encoded
 * without setting `content.encoding`). Such bodies can't be parsed in place.
 */
function looksEncodedBody(text: string): boolean {
  const c = text.charCodeAt(0);
  if (c === 0x1f || c === 0x78) return true; // gzip (1f 8b) / zlib (78 xx)
  // Binary control bytes near the start (tab/newline/CR excluded).
  for (let i = 0; i < Math.min(64, text.length); i++) {
    const x = text.charCodeAt(i);
    if (x < 9 || (x > 13 && x < 32)) return true;
  }
  const t = text.trim();
  return t.length > 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}

/**
 * Some HAR bodies arrive wrapped: an anti-JSON-hijacking prefix (`)]}'`), or
 * raw HTTP chunked-transfer framing the capture never stripped. Unwrap to the
 * real payload so it can be parsed, with a `reframe` to restore the wrapper on
 * the obfuscated output. Returns null when the body isn't wrapped.
 */
function unframeBody(
  text: string,
): { payload: string; reframe: (out: string) => string } | null {
  // Anti-hijacking prefix — `)]}'` or `)]}',`, then a newline.
  const hijack = /^\)\]\}'[,]?\r?\n?/.exec(text);
  if (hijack) {
    const prefix = hijack[0];
    return { payload: text.slice(prefix.length), reframe: (out) => prefix + out };
  }
  // HTTP chunked transfer framing: <hex-size>CRLF<data>CRLF … 0CRLFCRLF. The
  // framing is a capture artifact, so the de-chunked body is written clean.
  if (/^[0-9a-fA-F]+(;[^\r\n]*)?\r\n/.test(text)) {
    const dechunked = dechunk(text);
    if (dechunked !== null) return { payload: dechunked, reframe: (out) => out };
  }
  return null;
}

/** De-chunk an HTTP chunked-transfer body. Works in byte space (chunk sizes
 *  are byte counts) so multi-byte UTF-8 stays aligned. Null if malformed. */
function dechunk(text: string): string | null {
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    let nl = -1;
    for (let j = i; j + 1 < bytes.length; j++) {
      if (bytes[j] === 0x0d && bytes[j + 1] === 0x0a) {
        nl = j;
        break;
      }
    }
    if (nl < 0) return null;
    const sizeHex = decoder.decode(bytes.slice(i, nl)).split(";")[0].trim();
    if (!/^[0-9a-fA-F]+$/.test(sizeHex)) return null;
    const size = parseInt(sizeHex, 16);
    if (size === 0) break;
    const start = nl + 2;
    if (start + size > bytes.length) return null;
    for (let k = start; k < start + size; k++) out.push(bytes[k]);
    i = start + size + 2; // skip the chunk's trailing CRLF
  }
  return decoder.decode(new Uint8Array(out));
}

/** Accumulates distinct targets across the whole HAR, recording every entry
 *  each value is seen in (up to MAX_LOCATIONS) so the UI can trace it back. */
class TargetSet {
  private map = new Map<string, RedactionTarget>();

  add(
    t: Omit<RedactionTarget, "occurrences" | "locations">,
    loc: TargetLocation,
  ): void {
    const existing = this.map.get(t.id);
    if (existing) {
      existing.occurrences++;
      if (existing.locations.length < MAX_LOCATIONS) {
        existing.locations.push(loc);
      }
    } else {
      this.map.set(t.id, { ...t, occurrences: 1, locations: [loc] });
    }
  }

  list(): RedactionTarget[] {
    return [...this.map.values()];
  }
}

/**
 * Obfuscate a HAR. Mutates `har` in place and returns it with stats and the
 * full target list. Throws only if the input isn't HAR-shaped — per-entry
 * failures go into `stats.entryErrors`.
 */
export function processHar(
  har: unknown,
  options: ProcessHarOptions = {},
  onProgress?: (done: number, total: number) => void,
): ProcessHarResult {
  if (!isHarLike(har)) {
    throw new Error(
      "Not a valid HAR file: expected a top-level { log: { entries: [...] } }.",
    );
  }
  const policy = options.policy ?? DEFAULT_POLICY;
  const overrides = options.overrides ?? {};
  const seed = options.seed ?? DEFAULT_SEED;
  // One shared engine across the whole HAR so an identical real value forges
  // the same fake everywhere (a body with a per-field override is the only
  // case that gets its own throwaway engine — see obfuscateBody).
  const sharedEngine = new TransformEngine(
    new GeneratorRegistry(seed),
    new ConsistencyCache(),
  );

  const entries = har.log.entries;
  const stats: HarStats = {
    entries: entries.length,
    bodiesObfuscated: 0,
    bodiesSkipped: 0,
    headersRedacted: 0,
    cookiesRedacted: 0,
    paramsRedacted: 0,
    ipsRedacted: 0,
    entryErrors: [],
  };
  const targets = new TargetSet();
  // Dedicated generator for header/cookie/param/IP fakes. Salt "" means a value
  // seeds itself, so an identical real value forges the same fake everywhere.
  const fakeGen = new GeneratorRegistry(seed);

  const ctx: Ctx = {
    policy, overrides, seed, sharedEngine, fakeGen, stats, targets,
    fakeCache: new Map(),
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = asRecord(entries[i]);
    if (entry) {
      try {
        processEntry(entry, ctx, i);
      } catch (err) {
        stats.entryErrors.push({ entry: i, message: errMsg(err) });
      }
    }
    onProgress?.(i + 1, entries.length);
  }

  return { har, stats, targets: targets.list() };
}

interface Ctx {
  policy: RedactionPolicy;
  overrides: HarOverrides;
  seed: number;
  sharedEngine: TransformEngine;
  fakeGen: GeneratorRegistry;
  stats: HarStats;
  targets: TargetSet;
  /** Memoized generator output, keyed `${type}:${value}` — see genCached. */
  fakeCache: Map<string, string>;
}

/**
 * A generator's output for one value, memoized for the run. Output is
 * deterministic per value (salt ""), so the same real value seen across
 * thousands of entries is generated once, not once per occurrence.
 */
function genCached(ctx: Ctx, type: "id" | "ipv4", value: string): string {
  const key = `${type}:${value}`;
  const hit = ctx.fakeCache.get(key);
  if (hit !== undefined) return hit;
  const fake = String(ctx.fakeGen.generate(type, value, ""));
  ctx.fakeCache.set(key, fake);
  return fake;
}

/**
 * A realistic, shape-preserving fake for a header / cookie / param / IP value.
 * The engine's `id` generator scrambles alphanumeric runs while keeping length,
 * casing, and every separator — so a JWT stays JWT-shaped, a `k=v; k=v` cookie
 * stays parseable, an IP stays an IP.
 */
function fakeValue(ctx: Ctx, value: string): string {
  return genCached(ctx, "id", value);
}

/** Redact userinfo + secret query params in a URL string field, in place, but
 *  only when it actually carries a secret — clean URLs are left verbatim. */
function maybeRedactUrl(holder: Record<string, unknown>, key: string, ctx: Ctx): void {
  const url = holder[key];
  if (typeof url === "string" && urlHasSecrets(url)) {
    holder[key] = redactUrl(url, (v) => fakeValue(ctx, v));
  }
}

/** True for a loopback / link-local / RFC1918 (or IPv6 ULA) address — an
 *  internal IP that reveals network topology. Public IPs return false. */
function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (/^10\./.test(v)) return true;
  if (/^127\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (v === "::1") return true;
  if (/^fe80:/.test(v)) return true; // IPv6 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(v)) return true; // IPv6 unique-local
  return false;
}

function processEntry(entry: Record<string, unknown>, ctx: Ctx, index: number): void {
  const { policy } = ctx;
  const request = asRecord(entry.request);

  // Request-URL redaction is automatic under the params category — it backstops
  // HARs whose queryString[] array is empty.
  if (request && policy.params) maybeRedactUrl(request, "url", ctx);

  // Where every target of this entry will say it lives.
  const loc: TargetLocation = {
    entry: index,
    method: request && typeof request.method === "string" ? request.method : "",
    url: request && typeof request.url === "string" ? shortUrl(request.url) : "",
  };

  if (request) {
    ctx.stats.headersRedacted += redactNameValues(request.headers, "header", policy.headers, ctx, loc);
    ctx.stats.cookiesRedacted += redactNameValues(request.cookies, "cookie", policy.headers, ctx, loc);
    ctx.stats.paramsRedacted += redactNameValues(request.queryString, "param", policy.params, ctx, loc);
    const postData = asRecord(request.postData);
    if (postData) {
      ctx.stats.paramsRedacted += redactNameValues(postData.params, "param", policy.params, ctx, loc);
      obfuscateBody(postData, ctx, "request", loc);
    }
  }

  const response = asRecord(entry.response);
  if (response) {
    // Redirect destinations leak OAuth codes / tokens via `?code=`, `?token=`.
    if (policy.params) maybeRedactUrl(response, "redirectURL", ctx);
    ctx.stats.headersRedacted += redactNameValues(response.headers, "header", policy.headers, ctx, loc);
    ctx.stats.cookiesRedacted += redactNameValues(response.cookies, "cookie", policy.headers, ctx, loc);
    const content = asRecord(response.content);
    if (content) {
      obfuscateBody(content, ctx, "response", loc);
    }
  }

  if (typeof entry.serverIPAddress === "string" && entry.serverIPAddress) {
    const real = entry.serverIPAddress;
    const id = targetId("ip", "serverIPAddress", real);
    const rule = ctx.overrides[id];
    // A public server IP identifies third-party infrastructure (a CDN, an ad
    // server), not a person — only internal/private IPs are flagged by default.
    const def = isPrivateIp(real);
    const redact = ctx.policy.ips && (rule ? rule.redact : def);
    let replacement = real;
    if (redact) {
      replacement = rule?.value || genCached(ctx, "ipv4", real);
      entry.serverIPAddress = replacement;
      ctx.stats.ipsRedacted++;
    }
    ctx.targets.add({
      id, section: "ip", name: "serverIPAddress",
      original: disp(real), replacement: disp(replacement),
      redact, redactedByDefault: def,
      reason: def ? "internal server IP" : "public server IP",
    }, loc);
  }
}

/** Shorten a URL to host + path for compact display. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return disp(url, 80);
  }
}

// Headers whose value is a URL — redirect destinations that leak OAuth codes
// and tokens. Redacted by userinfo/secret-param like a request URL, not faked.
const URL_HEADER_NAMES = new Set(["location", "content-location"]);

// Headers whose value is `<scheme> <credential>` — the scheme word (`Bearer`,
// `Basic`…) is part of the protocol, not a secret, so it is kept verbatim and
// only the credential after it is faked.
const AUTH_HEADER_NAMES = new Set(["authorization", "proxy-authorization"]);
const AUTH_SCHEME_RE = /^([A-Za-z][\w.+-]*)(\s+)(\S[\s\S]*)$/;

/** Fake an `Authorization`-style header value, keeping its auth scheme word
 *  (and the gap after it) intact. A value with no scheme prefix is faked
 *  whole. */
function fakeAuthHeaderValue(ctx: Ctx, value: string): string {
  const m = AUTH_SCHEME_RE.exec(value);
  if (!m) return fakeValue(ctx, value);
  return m[1] + m[2] + fakeValue(ctx, m[3]);
}

/**
 * Fake a query / form param value. When the value is itself a JSON document
 * (a config blob like `custom_variables`), each string leaf is faked while the
 * keys and structure are preserved — so the field names stay readable but no
 * real data survives. Any other value gets a whole-string shape-preserving
 * fake, exactly as before.
 */
function fakeParamValue(ctx: Ctx, value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object") {
        return JSON.stringify(fakeJsonLeaves(ctx, parsed));
      }
    } catch {
      // Not JSON after all — fall through to the whole-string fake.
    }
  }
  return fakeValue(ctx, value);
}

/** Recursively fake every non-empty string leaf of a parsed JSON value,
 *  leaving object keys, numbers, booleans and null untouched. */
function fakeJsonLeaves(ctx: Ctx, node: unknown): unknown {
  if (typeof node === "string") return node === "" ? node : fakeValue(ctx, node);
  if (Array.isArray(node)) return node.map((x) => fakeJsonLeaves(ctx, x));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(node as Record<string, unknown>)) {
      out[k] = fakeJsonLeaves(ctx, (node as Record<string, unknown>)[k]);
    }
    return out;
  }
  return node; // number, boolean, null
}

/** The out-of-the-box redaction decision for one header/cookie/param value. */
function defaultRedact(
  section: "header" | "cookie" | "param",
  name: string,
  value: string,
  isUrlHeader: boolean,
): boolean {
  if (isUrlHeader) return urlHasSecrets(value);
  if (section === "cookie") return isSensitiveCookie(name, value);
  if (section === "param") return isSensitiveParam(name, value);
  return isSecretHeader(name);
}

/**
 * Walk a HAR `[{ name, value }]` array. For every value: register a target and,
 * when the category is enabled and the effective decision says so, replace it.
 * Returns the count of values actually replaced.
 */
function redactNameValues(
  arr: unknown,
  section: "header" | "cookie" | "param",
  categoryEnabled: boolean,
  ctx: Ctx,
  loc: TargetLocation,
): number {
  if (!Array.isArray(arr)) return 0;
  let count = 0;
  for (const item of arr) {
    const rec = asRecord(item);
    if (!rec) continue;
    const name = typeof rec.name === "string" ? rec.name : "";
    if (typeof rec.value !== "string" || rec.value === "") continue;

    const value = rec.value;
    const isUrlHeader =
      section === "header" && URL_HEADER_NAMES.has(name.toLowerCase());
    const def = defaultRedact(section, name, value, isUrlHeader);
    const id = targetId(section, name, value);
    const rule = ctx.overrides[id];
    const redact = categoryEnabled && (rule ? rule.redact : def);

    let replacement = value;
    if (redact) {
      if (rule?.value && rule.value !== "") {
        replacement = rule.value;
      } else if (isUrlHeader) {
        replacement = redactUrl(value, (v) => fakeValue(ctx, v));
      } else if (section === "header" && AUTH_HEADER_NAMES.has(name.toLowerCase())) {
        replacement = fakeAuthHeaderValue(ctx, value);
      } else if (section === "param") {
        replacement = fakeParamValue(ctx, value);
      } else {
        replacement = fakeValue(ctx, value);
      }
      rec.value = replacement;
      count++;
    }
    ctx.targets.add({
      id, section, name: name || "(unnamed)",
      original: disp(value), replacement: disp(replacement),
      redact, redactedByDefault: def,
      reason: isUrlHeader
        ? def
          ? "redirect url with a secret"
          : "redirect url"
        : nameReason(section, def),
    }, loc);
  }
  return count;
}

/**
 * Obfuscate the `text` field of a HAR body holder (`postData` or
 * `response.content`) in place, and register one target per JSON/XML body
 * field (full parity with the main field panel). Skips binary/non-structured
 * bodies. A transform failure leaves the body untouched and records a per-entry
 * error — never a silent pass.
 */
function obfuscateBody(
  holder: Record<string, unknown>,
  ctx: Ctx,
  side: "request" | "response",
  loc: TargetLocation,
): void {
  const text = holder.text;
  if (typeof text !== "string" || text === "") return;
  const mt = typeof holder.mimeType === "string" ? holder.mimeType : "";
  const enc = typeof holder.encoding === "string" ? holder.encoding : undefined;
  // Binary / non-structured bodies — and every body when the category is off —
  // are left exactly as-is. Skipping here also avoids a wasted parse+transform.
  if (!bodyIsObfuscatable(mt, enc) || !ctx.policy.bodies) {
    ctx.stats.bodiesSkipped++;
    return;
  }
  // A body whose mime claims JSON/XML but whose bytes are gzip-compressed or
  // base64-encoded can't be parsed and obfuscated in place. Surface it so the
  // user knows it went out untouched — don't let it become a cryptic error.
  if (looksEncodedBody(text)) {
    ctx.stats.bodiesSkipped++;
    ctx.stats.entryErrors.push({
      entry: loc.entry,
      message: `${side} body is compressed or base64-encoded — left unobfuscated; decode it before sharing if it may hold personal data`,
    });
    return;
  }
  try {
    // Unwrap an anti-hijacking prefix or chunked-transfer framing, if present,
    // so the real payload can be parsed; restored on output via `reframe`.
    const framed = unframeBody(text);
    const parsed = parseInput(framed ? framed.payload : text);

    // Pass 1: no overrides. Establishes each field's default behavior — whether
    // the engine changes it out of the box (sampleOriginal !== sampleFake).
    const base = ctx.sharedEngine.transform(parsed.data, null);
    const defaultChanged = new Map<string, boolean>();
    // URL-typed body fields are handled like request URLs: a link carrying a
    // secret (userinfo / secret query param) gets that part redacted; a clean
    // link (avatar_url, docs link…) is kept verbatim — not faked, not even
    // re-encoded, so it never shows up as noise.
    const urlPaths = new Set<string>();
    const urlRedacted = new Map<string, string>();
    for (const f of base.fields) {
      if (f.defaultType === "url" && typeof f.sampleOriginal === "string") {
        urlPaths.add(f.path);
        if (urlHasSecrets(f.sampleOriginal)) {
          urlRedacted.set(f.path, redactUrl(f.sampleOriginal, (v) => fakeValue(ctx, v)));
          defaultChanged.set(f.path, true);
        } else {
          defaultChanged.set(f.path, false);
        }
      } else if (KEPT_BY_DEFAULT.has(f.defaultType)) {
        // Regional data and plain dates are kept by default — coarse and often
        // needed for research; the user opts them in per value when not.
        defaultChanged.set(f.path, false);
      } else {
        defaultChanged.set(f.path, !sameValue(f.sampleOriginal, f.sampleFake));
      }
    }

    // Translate per-target overrides into the engine's path-keyed maps.
    const engOverrides = new Map<string, boolean>();
    const engValues = new Map<string, string>();
    for (const f of base.fields) {
      const id = targetId("body", f.path, String(f.sampleOriginal));
      const rule = ctx.overrides[id];
      if (rule) {
        if (!rule.redact) {
          engOverrides.set(f.path, false);
        } else {
          if (!defaultChanged.get(f.path)) engOverrides.set(f.path, true);
          if (rule.value !== undefined) engValues.set(f.path, rule.value);
        }
      } else if (urlRedacted.has(f.path)) {
        // URL carrying a secret: inject the userinfo/param-redacted value.
        engValues.set(f.path, urlRedacted.get(f.path)!);
      } else if (urlPaths.has(f.path)) {
        // Clean URL: preserve it exactly (the engine would otherwise fake it).
        engOverrides.set(f.path, false);
      } else if (KEPT_BY_DEFAULT.has(f.defaultType)) {
        // Regional / date field with no opt-in override: keep it as-is.
        engOverrides.set(f.path, false);
      }
    }

    // Pass 2 only when this body actually has overrides — a throwaway engine so
    // the shared engine's cross-body consistency isn't disturbed.
    let result = base;
    if (engOverrides.size || engValues.size) {
      const fresh = new TransformEngine(
        new GeneratorRegistry(ctx.seed),
        new ConsistencyCache(),
      );
      result = fresh.transform(parsed.data, null, engOverrides, engValues);
    }

    const out = serialize(result.output, parsed);
    holder.text = framed ? framed.reframe(out) : out;
    ctx.stats.bodiesObfuscated++;

    // Register a target per body field, keyed on its default-pass value so the
    // id is stable regardless of the override applied.
    for (const f of result.fields) {
      registerBodyTarget(f, defaultChanged, urlPaths, ctx, loc);
    }
  } catch (err) {
    ctx.stats.bodiesSkipped++;
    ctx.stats.entryErrors.push({
      entry: loc.entry,
      message: `${side} body left unobfuscated: ${errMsg(err)}`,
    });
  }
}

function registerBodyTarget(
  f: FieldSummary,
  defaultChanged: Map<string, boolean>,
  urlPaths: Set<string>,
  ctx: Ctx,
  loc: TargetLocation,
): void {
  const original = String(f.sampleOriginal);
  const id = targetId("body", f.path, original);
  const def = defaultChanged.get(f.path) ?? false;
  const replacement = String(f.sampleFake);
  // The final transform already reflects any override, so "did the value
  // change" is the effective decision.
  const redact = !sameValue(f.sampleOriginal, f.sampleFake);
  // URL fields get a `custom` effectiveType once redacted, so their reason is
  // set explicitly rather than derived from the (now meaningless) type.
  const isUrl = urlPaths.has(f.path);
  const reason = isUrl
    ? def
      ? "url with a secret"
      : "public url"
    : LOCALE_TYPES.has(f.defaultType)
      ? "regional data"
      : f.defaultType === "isoDate"
        ? "date"
        : f.defaultType === "sku"
          ? "catalog data"
          : bodyReason(f.effectiveType, def);
  ctx.targets.add({
    id, section: "body", name: f.path,
    original: disp(original), replacement: disp(replacement),
    redact, redactedByDefault: def, reason,
  }, loc);
}

function sameValue(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}
