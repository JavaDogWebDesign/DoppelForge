import yaml from "js-yaml";
import type {
  EndpointMeta,
  EndpointSignature,
  EndpointSpec,
  FieldRule,
  Provider,
  ProviderManifest,
  SemanticType,
} from "../engine/types";

const STORAGE_KEY = "doppelforge.customProviders";
const STORAGE_VERSION = 1;

// Total size cap across all custom provider source YAMLs in localStorage.
// Browsers cap localStorage per-origin at ~5-10MB; we cap our share well
// below that to leave room for input history, settings, and field overrides.
const MAX_TOTAL_BYTES = 1_000_000;

// Mirror of SemanticType for runtime validation. Keep in sync with
// engine/types.ts - TypeScript's type-only enum can't be iterated at runtime.
const SEMANTIC_TYPES: readonly SemanticType[] = [
  "email", "firstName", "lastName", "fullName", "phone",
  "street", "streetSecondary", "city", "state", "stateOrProvince",
  "postalCode", "country", "countryCode", "company",
  "id", "uuid", "ipv4", "isoDate", "unixTimestamp", "url",
  "sku", "productName", "shortText", "longText",
  "currency", "priceAmount", "cvvCode", "cvvMessage",
  "avsCode", "avsMessage", "boolean", "custom", "preserve", "auto",
  "null", "redact",
];
const SEMANTIC_TYPE_SET = new Set<string>(SEMANTIC_TYPES);

export interface CustomProviderSource {
  manifestYaml: string;
  endpointYamls: Record<string, string>;
}

interface StorageShape {
  version: number;
  providers: CustomProviderSource[];
}

export interface ValidationError {
  scope: "manifest" | "endpoint";
  endpointSlug?: string;
  message: string;
}

export interface ParsedCustomProvider {
  source: CustomProviderSource;
  provider: Provider;
}

// ----- Storage -----

export function loadStoredSources(): CustomProviderSource[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StorageShape;
    if (parsed.version !== STORAGE_VERSION) return [];
    if (!Array.isArray(parsed.providers)) return [];
    return parsed.providers.filter(
      (p) =>
        typeof p.manifestYaml === "string" &&
        p.endpointYamls != null &&
        typeof p.endpointYamls === "object",
    );
  } catch {
    return [];
  }
}

export function saveStoredSources(sources: CustomProviderSource[]): void {
  if (typeof localStorage === "undefined") return;
  const payload: StorageShape = { version: STORAGE_VERSION, providers: sources };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function totalSourceBytes(sources: CustomProviderSource[]): number {
  let n = 0;
  for (const s of sources) {
    n += s.manifestYaml.length;
    for (const slug of Object.keys(s.endpointYamls)) {
      n += slug.length + s.endpointYamls[slug].length;
    }
  }
  return n;
}

// ----- Validation -----

// js-yaml: load() defaults to FAILSAFE_SCHEMA in v4 → no code execution path.
// We additionally cap input length and reject `__proto__`-style keys.
function safeLoad(input: string, scope: string): unknown {
  if (input.length > 200_000) {
    throw new Error(`${scope}: YAML over 200KB rejected`);
  }
  return yaml.load(input, { schema: yaml.JSON_SCHEMA });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function rejectPollutionKeys(obj: Record<string, unknown>, scope: string): void {
  for (const k of Object.keys(obj)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      throw new Error(`${scope}: forbidden key '${k}'`);
    }
  }
}

// Hex colors only. The sidebar interpolates this directly into a CSS custom
// property (`--accent`), and a value containing `;` would close the
// declaration and let an attacker inject arbitrary CSS rules through a
// shared provider zip. Built-in providers all use #RRGGBB.
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function validateManifest(rawYaml: string): ProviderManifest {
  const raw = safeLoad(rawYaml, "manifest");
  if (!isPlainObject(raw)) throw new Error("manifest: must be a YAML mapping");
  rejectPollutionKeys(raw, "manifest");

  const required = ["id", "name", "category", "icon", "color", "docs"] as const;
  for (const field of required) {
    if (typeof raw[field] !== "string" || (raw[field] as string).trim() === "") {
      throw new Error(`manifest: missing or non-string '${field}'`);
    }
  }
  const id = raw.id as string;
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(id)) {
    throw new Error(
      `manifest: id '${id}' must be lowercase alphanumeric with optional - or _, 2-41 chars`,
    );
  }
  const color = (raw.color as string).trim();
  if (!COLOR_RE.test(color)) {
    throw new Error(
      `manifest: color '${color}' must be a hex value like #RRGGBB`,
    );
  }
  return {
    id,
    name: raw.name as string,
    category: raw.category as string,
    icon: raw.icon as string,
    color,
    docs: raw.docs as string,
  };
}

function validateFieldRule(value: unknown, path: string): FieldRule {
  if (!isPlainObject(value)) {
    throw new Error(`fields["${path}"]: must be a mapping like { type: ... }`);
  }
  const type = value.type;
  if (typeof type !== "string" || !SEMANTIC_TYPE_SET.has(type)) {
    throw new Error(
      `fields["${path}"]: type '${String(type)}' not in semantic vocabulary`,
    );
  }
  const anchor = value.anchor;
  if (anchor !== undefined && typeof anchor !== "boolean") {
    throw new Error(`fields["${path}"]: anchor must be a boolean`);
  }
  return { type: type as SemanticType, anchor: anchor as boolean | undefined };
}

function validateEndpoint(
  rawYaml: string,
  slug: string,
  providerId: string,
): EndpointSpec {
  const raw = safeLoad(rawYaml, `endpoint '${slug}'`);
  if (!isPlainObject(raw)) {
    throw new Error(`endpoint '${slug}': must be a YAML mapping`);
  }
  rejectPollutionKeys(raw, `endpoint '${slug}'`);

  // endpoint block
  if (!isPlainObject(raw.endpoint)) {
    throw new Error(`endpoint '${slug}': missing 'endpoint' block`);
  }
  const ep = raw.endpoint as Record<string, unknown>;
  rejectPollutionKeys(ep, `endpoint '${slug}'.endpoint`);
  if (typeof ep.method !== "string") {
    throw new Error(`endpoint '${slug}': endpoint.method required`);
  }
  if (typeof ep.path !== "string") {
    throw new Error(`endpoint '${slug}': endpoint.path required`);
  }
  const meta: EndpointMeta = {
    method: ep.method,
    path: ep.path,
    description: typeof ep.description === "string" ? ep.description : undefined,
    doc_url: typeof ep.doc_url === "string" ? ep.doc_url : undefined,
    kind:
      ep.kind === "response" || ep.kind === "webhook"
        ? ep.kind
        : undefined,
  };

  // signature block
  let signature: EndpointSignature = { required_paths: [] };
  if (raw.signature !== undefined) {
    if (!isPlainObject(raw.signature)) {
      throw new Error(`endpoint '${slug}': signature must be a mapping`);
    }
    const sig = raw.signature as Record<string, unknown>;
    rejectPollutionKeys(sig, `endpoint '${slug}'.signature`);
    if (!Array.isArray(sig.required_paths)) {
      throw new Error(
        `endpoint '${slug}': signature.required_paths must be a list`,
      );
    }
    const required_paths = sig.required_paths.map((p, i) => {
      if (typeof p !== "string") {
        throw new Error(
          `endpoint '${slug}': signature.required_paths[${i}] must be a string`,
        );
      }
      return p;
    });
    let optional_paths: string[] | undefined;
    if (sig.optional_paths !== undefined) {
      if (!Array.isArray(sig.optional_paths)) {
        throw new Error(
          `endpoint '${slug}': signature.optional_paths must be a list`,
        );
      }
      optional_paths = sig.optional_paths.map((p, i) => {
        if (typeof p !== "string") {
          throw new Error(
            `endpoint '${slug}': signature.optional_paths[${i}] must be a string`,
          );
        }
        return p;
      });
    }
    signature = { required_paths, optional_paths };
  }

  // fields block
  if (!isPlainObject(raw.fields)) {
    throw new Error(`endpoint '${slug}': fields must be a mapping`);
  }
  rejectPollutionKeys(raw.fields, `endpoint '${slug}'.fields`);
  const fields: Record<string, FieldRule> = {};
  for (const [path, rule] of Object.entries(raw.fields)) {
    fields[path] = validateFieldRule(rule, path);
  }

  return {
    id: `${providerId}/${slug}`,
    providerId,
    endpoint: meta,
    signature,
    fields,
  };
}

// ----- Parse a full custom provider (manifest + endpoints) -----

export function parseCustomProvider(
  source: CustomProviderSource,
): ParsedCustomProvider {
  const manifest = validateManifest(source.manifestYaml);
  const endpoints: EndpointSpec[] = [];
  for (const [slug, rawYaml] of Object.entries(source.endpointYamls)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(slug)) {
      throw new Error(`endpoint slug '${slug}': invalid (lowercase, - or _)`);
    }
    endpoints.push(validateEndpoint(rawYaml, slug, manifest.id));
  }
  endpoints.sort((a, b) => a.endpoint.path.localeCompare(b.endpoint.path));
  return {
    source,
    provider: { manifest, endpoints },
  };
}

export function loadCustomProviders(): ParsedCustomProvider[] {
  const sources = loadStoredSources();
  const out: ParsedCustomProvider[] = [];
  for (const s of sources) {
    try {
      out.push(parseCustomProvider(s));
    } catch {
      // Silently skip broken entries - they remain in storage so the user
      // can re-open them in the edit modal and fix them. The sidebar simply
      // won't render the broken provider until the YAML is valid.
    }
  }
  return out;
}

// ----- Public API for the upload modal / sidebar -----

export interface SaveResult {
  ok: true;
  provider: ParsedCustomProvider;
}

export interface SaveError {
  ok: false;
  error: string;
}

export function addCustomProvider(
  source: CustomProviderSource,
  builtInIds: Set<string>,
): SaveResult | SaveError {
  let parsed: ParsedCustomProvider;
  try {
    parsed = parseCustomProvider(source);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const id = parsed.provider.manifest.id;
  if (builtInIds.has(id)) {
    return {
      ok: false,
      error: `Provider id '${id}' is reserved by a built-in provider. Pick a different id.`,
    };
  }
  const existing = loadStoredSources();
  // Replace any existing custom provider with the same id.
  const withoutDup = existing.filter((s) => {
    try {
      const m = validateManifest(s.manifestYaml);
      return m.id !== id;
    } catch {
      return true;
    }
  });
  const next = [...withoutDup, source];
  if (totalSourceBytes(next) > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      error: `Total custom provider size exceeds 1MB cap`,
    };
  }
  saveStoredSources(next);
  return { ok: true, provider: parsed };
}

export function removeCustomProvider(id: string): void {
  const existing = loadStoredSources();
  const next = existing.filter((s) => {
    try {
      const m = validateManifest(s.manifestYaml);
      return m.id !== id;
    } catch {
      return true;
    }
  });
  saveStoredSources(next);
}
