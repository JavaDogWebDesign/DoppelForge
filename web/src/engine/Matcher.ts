import type { EndpointSpec, JsonValue } from "./types";
import { normalizePath } from "./paths";

export interface MatchResult {
  endpoint: EndpointSpec;
  score: number;
  matchedRequired: number;
  matchedOptional: number;
}

// Skip these keys when walking user-supplied JSON so a payload like
// {"__proto__": {...}} cannot taint downstream object building. JSON.parse
// admits them as own enumerable properties, so Object.entries returns them.
const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function collectPaths(value: JsonValue, path: string, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectPaths(value[i], `${path}[${i}]`, out);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (POLLUTION_KEYS.has(k)) continue;
      const childPath = path === "" ? k : `${path}.${k}`;
      out.add(childPath);
      collectPaths(v, childPath, out);
    }
    return;
  }
}

export function bestMatch(
  input: JsonValue,
  endpoints: EndpointSpec[],
  threshold = 1.0,
): MatchResult | null {
  const raw = new Set<string>();
  collectPaths(input, "", raw);
  const normalized = new Set<string>();
  for (const p of raw) normalized.add(normalizePath(p));

  let best: MatchResult | null = null;

  for (const ep of endpoints) {
    const req = ep.signature.required_paths || [];
    const opt = ep.signature.optional_paths || [];
    let matchedReq = 0;
    for (const p of req) if (normalized.has(p)) matchedReq++;
    let matchedOpt = 0;
    for (const p of opt) if (normalized.has(p)) matchedOpt++;

    if (req.length === 0) continue;
    const requiredRatio = matchedReq / req.length;
    if (requiredRatio < threshold) continue;

    // Specificity tiebreaker: when two signatures both satisfy the threshold
    // with the same optional-match count, prefer the one with MORE required
    // paths (it's the more discriminating signature). Without this, a subset
    // signature like merchant-account [id, status, currency] wins over the
    // superset transaction [id, type, amount, status, currency] just because
    // it iterates first.
    const score = requiredRatio + matchedOpt * 0.1 + req.length * 0.001;
    if (!best || score > best.score) {
      best = {
        endpoint: ep,
        score,
        matchedRequired: matchedReq,
        matchedOptional: matchedOpt,
      };
    }
  }

  return best;
}

// Custom providers (loaded from user YAML in localStorage) feed
// `endpoint.path` straight into `new RegExp`. Without escaping, a malicious
// path like `/api/(a+)+$` would cause catastrophic backtracking, and a
// malformed pattern like `/api/(unclosed` would throw at construction time.
// Escape every literal segment; only `{placeholder}` segments expand into a
// regex token (`[^/]+`).
function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPathRegex(specPath: string): RegExp | null {
  const trimmed = specPath.replace(/^\//, "");
  const pattern = trimmed.replace(/(\{[^}]+\})|([^{}]+)/g, (_m, placeholder, literal) =>
    placeholder ? "[^/]+" : escapeRegexLiteral(literal),
  );
  try {
    return new RegExp(`(^|/)${pattern}/?($|\\?)`);
  } catch {
    return null;
  }
}

export function matchByUrl(
  url: string,
  endpoints: EndpointSpec[],
): EndpointSpec | null {
  if (!url.trim()) return null;
  let pathOnly = url.trim();
  try {
    if (/^https?:\/\//i.test(pathOnly)) {
      pathOnly = new URL(pathOnly).pathname;
    }
  } catch {
    /* fall through with raw string */
  }
  for (const ep of endpoints) {
    // Webhook endpoints are inbound POSTs to the user's server; their "path"
    // is the literal event/topic/scope, not a provider URL. URL hints
    // describe outbound API calls — only response endpoints can match.
    if (ep.endpoint.kind === "webhook") continue;
    const re = buildPathRegex(ep.endpoint.path);
    if (re && re.test(pathOnly)) return ep;
  }
  return null;
}
