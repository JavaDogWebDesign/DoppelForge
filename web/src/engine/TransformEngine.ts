import type { EndpointSpec, FieldRule, JsonValue, SemanticType } from "./types";
import { ConsistencyCache } from "./Cache";
import { GeneratorRegistry } from "./GeneratorRegistry";
import { detectGeneric } from "./GenericDetector";
import { normalizePath } from "./paths";

export interface FieldSummary {
  path: string;
  defaultType: SemanticType;
  effectiveType: SemanticType;
  sampleOriginal: JsonValue;
  sampleFake: JsonValue;
  overridden: boolean;
}

export interface TransformResult {
  output: JsonValue;
  stats: {
    fieldsTransformed: number;
    fieldsPreserved: number;
    fieldsFromGeneric: number;
    cacheHits: number;
  };
  fields: FieldSummary[];
}

type OverrideMap = Map<string, boolean>;
type ValueOverrideMap = Map<string, string>;

export class TransformEngine {
  private generators: GeneratorRegistry;
  private cache: ConsistencyCache;

  constructor(generators: GeneratorRegistry, cache: ConsistencyCache) {
    this.generators = generators;
    this.cache = cache;
  }

  transform(
    input: JsonValue,
    endpoint: EndpointSpec | null,
    overrides: OverrideMap = new Map(),
    valueOverrides: ValueOverrideMap = new Map(),
  ): TransformResult {
    const stats = {
      fieldsTransformed: 0,
      fieldsPreserved: 0,
      fieldsFromGeneric: 0,
      cacheHits: 0,
    };
    const fieldsByPath = new Map<string, FieldSummary>();
    const output = this.walk(input, "", endpoint, overrides, valueOverrides, stats, fieldsByPath);
    return { output, stats, fields: Array.from(fieldsByPath.values()) };
  }

  private baseRule(path: string, endpoint: EndpointSpec | null): FieldRule | null {
    if (!endpoint) return null;
    const normalized = normalizePath(path);
    const fields = endpoint.fields;
    if (fields[normalized]) return fields[normalized];
    if (fields["*"]) return fields["*"];
    return null;
  }

  private defaultType(rule: FieldRule | null, path: string, value: JsonValue): SemanticType {
    if (!rule || rule.type === "auto") return detectGeneric(path, value);
    return rule.type;
  }

  private applyRule(
    path: string,
    value: JsonValue,
    endpoint: EndpointSpec | null,
    overrides: OverrideMap,
    valueOverrides: ValueOverrideMap,
    stats: TransformResult["stats"],
    summaries: Map<string, FieldSummary>,
  ): JsonValue {
    const normalized = normalizePath(path);
    const rule = this.baseRule(path, endpoint);
    const override = overrides.get(normalized);
    const valueOverride = valueOverrides.get(normalized);
    const defaultT = this.defaultType(rule, path, value);
    const fromGeneric = !rule || rule.type === "auto";

    // Literal user-supplied value beats every other rule.
    if (valueOverride !== undefined) {
      const fake = coerceToOriginalType(valueOverride, value);
      stats.fieldsTransformed++;
      if (!summaries.has(normalized)) {
        summaries.set(normalized, {
          path: normalized,
          defaultType: defaultT,
          effectiveType: "custom",
          sampleOriginal: value,
          sampleFake: fake,
          overridden: true,
        });
      }
      return fake;
    }

    let effective: SemanticType;
    let anchor = false;

    if (override === false) {
      effective = "preserve";
    } else if (override === true) {
      // User explicitly enabled obfuscation. If the field map said preserve,
      // pick a sensible generator from key-name + value-pattern hints, falling
      // back to ID-shape for short strings/numbers.
      if (defaultT !== "preserve") {
        effective = defaultT;
      } else {
        let t = detectGeneric(path, value);
        if (t === "preserve") t = detectIdLike(value);
        effective = t;
      }
      anchor = rule?.anchor ?? false;
    } else {
      effective = defaultT;
      anchor = rule?.anchor ?? false;
    }

    let fake: JsonValue;
    if (effective === "preserve") {
      stats.fieldsPreserved++;
      fake = value;
    } else if (effective === "nestedJson") {
      fake = this.transformNestedJson(
        value, path, endpoint, overrides, valueOverrides, stats, summaries,
      );
      if (fromGeneric) stats.fieldsFromGeneric++;
      else stats.fieldsTransformed++;
    } else if (anchor) {
      // Anchored: cache holds value→fake; seed with value only so cache hits
      // (which skip generation) are consistent with the first generation.
      const cached = this.cache.get(effective, value);
      if (cached !== undefined) {
        stats.cacheHits++;
        fake = cached;
      } else {
        fake = this.generators.generate(effective, value);
        this.cache.set(effective, value, fake);
      }
      if (fromGeneric) stats.fieldsFromGeneric++;
      else stats.fieldsTransformed++;
    } else {
      // Non-anchored: salt with the concrete path so two siblings with the
      // same input value produce different fakes (avoids "every currency USD
      // becomes the same word" repetition).
      fake = this.generators.generate(effective, value, path);
      if (fromGeneric) stats.fieldsFromGeneric++;
      else stats.fieldsTransformed++;
    }

    if (!summaries.has(normalized)) {
      summaries.set(normalized, {
        path: normalized,
        defaultType: defaultT,
        effectiveType: effective,
        sampleOriginal: value,
        sampleFake: fake,
        overridden: override !== undefined,
      });
    }

    return fake;
  }

  private walk(
    value: JsonValue,
    path: string,
    endpoint: EndpointSpec | null,
    overrides: OverrideMap,
    valueOverrides: ValueOverrideMap,
    stats: TransformResult["stats"],
    summaries: Map<string, FieldSummary>,
  ): JsonValue {
    if (value === null) return null;

    if (Array.isArray(value)) {
      return value.map((item, i) =>
        this.walk(item, `${path}[${i}]`, endpoint, overrides, valueOverrides, stats, summaries),
      );
    }

    if (typeof value === "object") {
      const out: Record<string, JsonValue> = {};
      for (const [k, v] of Object.entries(value)) {
        // Skip pollution keys: JSON.parse admits __proto__ / constructor /
        // prototype as own properties, and assigning out[k]=… would either
        // mutate the local prototype chain or shadow inherited methods.
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        const childPath = path === "" ? k : `${path}.${k}`;
        out[k] = this.walk(v, childPath, endpoint, overrides, valueOverrides, stats, summaries);
      }
      return out;
    }

    return this.applyRule(path, value, endpoint, overrides, valueOverrides, stats, summaries);
  }

  // A `nestedJson` field is a string that itself holds a JSON document (e.g.
  // a serialized billing plan). Parse it, run the engine over the contents so
  // embedded PII is obfuscated too, then re-serialize. If the value isn't a
  // string, or isn't valid JSON, or decodes to a bare primitive, it is left
  // untouched — there is nothing structured to walk.
  private transformNestedJson(
    value: JsonValue,
    path: string,
    endpoint: EndpointSpec | null,
    overrides: OverrideMap,
    valueOverrides: ValueOverrideMap,
    stats: TransformResult["stats"],
    summaries: Map<string, FieldSummary>,
  ): JsonValue {
    if (typeof value !== "string") return value;
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(value) as JsonValue;
    } catch {
      return value;
    }
    if (parsed === null || typeof parsed !== "object") return value;
    const transformed = this.walk(
      parsed, path, endpoint, overrides, valueOverrides, stats, summaries,
    );
    return JSON.stringify(transformed);
  }
}

// Best-effort coerce the user-typed literal to match the original value's
// primitive type so we don't break shape-validating consumers.
function coerceToOriginalType(literal: string, original: JsonValue): JsonValue {
  if (typeof original === "number") {
    const n = Number(literal);
    return Number.isFinite(n) ? n : literal;
  }
  if (typeof original === "boolean") {
    const low = literal.toLowerCase().trim();
    if (low === "true") return true;
    if (low === "false") return false;
    return literal;
  }
  return literal;
}

function detectIdLike(value: JsonValue): SemanticType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "id";
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return "id";
    if (/^[0-9a-f-]{36}$/i.test(value)) return "uuid";
    if (/^[A-Za-z0-9_-]{6,}$/.test(value)) return "id";
    return "shortText";
  }
  return "preserve";
}
