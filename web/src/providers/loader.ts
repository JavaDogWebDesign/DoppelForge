import yaml from "js-yaml";
import type {
  EndpointSpec,
  Provider,
  ProviderManifest,
} from "../engine/types";

const manifestModules = import.meta.glob("../../../providers/*/manifest.yaml", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const endpointModules = import.meta.glob(
  "../../../providers/*/endpoints/*.yaml",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

function providerIdFromManifestPath(path: string): string {
  const m = path.match(/\/providers\/([^/]+)\/manifest\.yaml$/);
  if (!m) throw new Error(`Bad manifest path: ${path}`);
  return m[1];
}

function endpointInfoFromPath(path: string): { providerId: string; slug: string } {
  const m = path.match(/\/providers\/([^/]+)\/endpoints\/([^/]+)\.yaml$/);
  if (!m) throw new Error(`Bad endpoint path: ${path}`);
  return { providerId: m[1], slug: m[2] };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Minimal shape check: every required string field is a non-empty string.
// Provider YAML is build-time-trusted, so this is defense-in-depth for typos
// and merge mistakes - not a security boundary.
function validateManifest(raw: unknown): ProviderManifest | null {
  if (!isObject(raw)) return null;
  const required = ["id", "name", "category", "icon", "color", "docs"] as const;
  for (const k of required) {
    if (typeof raw[k] !== "string" || !raw[k]) return null;
  }
  return raw as unknown as ProviderManifest;
}

function validateEndpoint(
  raw: unknown,
): { endpoint: EndpointSpec["endpoint"]; signature: EndpointSpec["signature"]; fields: EndpointSpec["fields"] } | null {
  if (!isObject(raw)) return null;
  const endpoint = raw.endpoint;
  if (!isObject(endpoint)) return null;
  if (typeof endpoint.method !== "string" || !endpoint.method) return null;
  if (typeof endpoint.path !== "string" || !endpoint.path) return null;
  const signature = isObject(raw.signature) ? raw.signature : null;
  const requiredPaths = signature && Array.isArray(signature.required_paths)
    ? (signature.required_paths.filter((p) => typeof p === "string") as string[])
    : [];
  const optionalPaths = signature && Array.isArray(signature.optional_paths)
    ? (signature.optional_paths.filter((p) => typeof p === "string") as string[])
    : undefined;
  const fields = isObject(raw.fields) ? (raw.fields as EndpointSpec["fields"]) : {};
  return {
    endpoint: endpoint as unknown as EndpointSpec["endpoint"],
    signature: optionalPaths
      ? { required_paths: requiredPaths, optional_paths: optionalPaths }
      : { required_paths: requiredPaths },
    fields,
  };
}

export function loadProviders(): Provider[] {
  const byId = new Map<string, Provider>();

  for (const [path, raw] of Object.entries(manifestModules)) {
    const id = providerIdFromManifestPath(path);
    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (err) {
      console.warn(`[loadProviders] skipping ${path}: YAML parse error`, err);
      continue;
    }
    const manifest = validateManifest(parsed);
    if (!manifest) {
      console.warn(`[loadProviders] skipping ${path}: invalid manifest shape`);
      continue;
    }
    byId.set(id, { manifest, endpoints: [] });
  }

  for (const [path, raw] of Object.entries(endpointModules)) {
    const { providerId, slug } = endpointInfoFromPath(path);
    const provider = byId.get(providerId);
    if (!provider) continue;
    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (err) {
      console.warn(`[loadProviders] skipping ${path}: YAML parse error`, err);
      continue;
    }
    const validated = validateEndpoint(parsed);
    if (!validated) {
      console.warn(`[loadProviders] skipping ${path}: missing endpoint.method or endpoint.path`);
      continue;
    }
    provider.endpoints.push({
      id: `${providerId}/${slug}`,
      providerId,
      ...validated,
    });
  }

  for (const p of byId.values()) {
    p.endpoints.sort((a, b) => a.endpoint.path.localeCompare(b.endpoint.path));
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name),
  );
}
