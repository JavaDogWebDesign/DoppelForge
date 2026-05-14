import type { EndpointSpec, JsonValue } from "./types";
import { normalizePath } from "./paths";

export interface MatchResult {
  endpoint: EndpointSpec;
  score: number;
  matchedRequired: number;
  matchedOptional: number;
}

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
    // Regex source is build-time-trusted provider YAML, NOT user input.
    // If a future change ever takes `ep.endpoint.path` from user-supplied
    // data, this becomes an unbounded-pattern + ReDoS risk and needs
    // escaping/validation before reaching `new RegExp`.
    const specPath = ep.endpoint.path.replace(/\{[^}]+\}/g, "[^/]+");
    const re = new RegExp(`(^|/)${specPath.replace(/^\//, "")}/?($|\\?)`);
    if (re.test(pathOnly)) return ep;
  }
  return null;
}
