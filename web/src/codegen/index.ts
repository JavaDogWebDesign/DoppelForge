import type { JsonValue } from "../engine/types";

export type CodegenTarget = "typescript" | "zod" | "jsonSchema";

export interface CodegenOption {
  id: CodegenTarget;
  label: string;
  filenameExt: string;
}

export const CODEGEN_OPTIONS: CodegenOption[] = [
  { id: "typescript", label: "TypeScript", filenameExt: "ts" },
  { id: "zod", label: "Zod schema", filenameExt: "ts" },
  { id: "jsonSchema", label: "JSON Schema", filenameExt: "json" },
];

export function generate(target: CodegenTarget, sample: JsonValue): string {
  switch (target) {
    case "typescript":
      return toTypeScript(sample);
    case "zod":
      return toZod(sample);
    case "jsonSchema":
      return JSON.stringify(toJsonSchema(sample), null, 2);
  }
}

// ---------- TypeScript ----------

export function toTypeScript(sample: JsonValue, rootName = "Response"): string {
  const body = tsType(sample, 0);
  return `export type ${rootName} = ${body};\n`;
}

function tsType(value: JsonValue, depth: number): string {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";

  if (Array.isArray(value)) {
    if (value.length === 0) return "unknown[]";
    const elementType = mergeTsArrayTypes(value, depth);
    const needsParens = elementType.includes("|") || elementType.startsWith("{");
    return needsParens ? `(${elementType})[]` : `${elementType}[]`;
  }

  // Object
  const entries = Object.entries(value);
  if (entries.length === 0) return "Record<string, unknown>";
  const indent = "  ".repeat(depth + 1);
  const closeIndent = "  ".repeat(depth);
  const lines = entries.map(([k, v]) => {
    const key = isValidIdent(k) ? k : JSON.stringify(k);
    return `${indent}${key}: ${tsType(v, depth + 1)};`;
  });
  return `{\n${lines.join("\n")}\n${closeIndent}}`;
}

function mergeTsArrayTypes(items: JsonValue[], depth: number): string {
  // Take the union of element types; merge sibling object shapes by key so
  // a heterogeneous array of similar objects produces one combined shape with
  // optional-marked keys for the missing-from-some entries.
  const objectShapes: Record<string, JsonValue>[] = [];
  const otherTypes = new Set<string>();

  for (const item of items) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      objectShapes.push(item as Record<string, JsonValue>);
    } else {
      otherTypes.add(tsType(item, depth + 1));
    }
  }

  if (objectShapes.length > 0) {
    const merged = mergeObjectShapes(objectShapes);
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    const lines = Object.entries(merged.shape).map(([k, info]) => {
      const key = isValidIdent(k) ? k : JSON.stringify(k);
      const optional = info.optional ? "?" : "";
      const sample = info.samples[0] ?? null;
      return `${indent}${key}${optional}: ${tsType(sample, depth + 1)};`;
    });
    otherTypes.add(`{\n${lines.join("\n")}\n${closeIndent}}`);
  }

  return Array.from(otherTypes).join(" | ") || "unknown";
}

interface MergedShape {
  shape: Record<string, { samples: JsonValue[]; optional: boolean }>;
}

function mergeObjectShapes(shapes: Record<string, JsonValue>[]): MergedShape {
  const out: MergedShape["shape"] = {};
  for (const shape of shapes) {
    for (const [k, v] of Object.entries(shape)) {
      if (!out[k]) out[k] = { samples: [v], optional: false };
      else out[k].samples.push(v);
    }
  }
  for (const k of Object.keys(out)) {
    if (out[k].samples.length < shapes.length) out[k].optional = true;
  }
  return { shape: out };
}

// ---------- Zod ----------

export function toZod(sample: JsonValue, rootName = "Response"): string {
  const body = zodType(sample, 0);
  return `import { z } from "zod";\n\nexport const ${rootName} = ${body};\nexport type ${rootName} = z.infer<typeof ${rootName}>;\n`;
}

function zodType(value: JsonValue, depth: number): string {
  if (value === null) return "z.null()";
  if (typeof value === "string") return "z.string()";
  if (typeof value === "number") return "z.number()";
  if (typeof value === "boolean") return "z.boolean()";

  if (Array.isArray(value)) {
    if (value.length === 0) return "z.array(z.unknown())";
    return `z.array(${mergeZodArrayTypes(value, depth)})`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return "z.record(z.unknown())";
  const indent = "  ".repeat(depth + 1);
  const closeIndent = "  ".repeat(depth);
  const lines = entries.map(([k, v]) => {
    const key = isValidIdent(k) ? k : JSON.stringify(k);
    return `${indent}${key}: ${zodType(v, depth + 1)},`;
  });
  return `z.object({\n${lines.join("\n")}\n${closeIndent}})`;
}

function mergeZodArrayTypes(items: JsonValue[], depth: number): string {
  const objectShapes: Record<string, JsonValue>[] = [];
  const others: string[] = [];

  for (const item of items) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      objectShapes.push(item as Record<string, JsonValue>);
    } else {
      others.push(zodType(item, depth + 1));
    }
  }

  const variants: string[] = [...new Set(others)];
  if (objectShapes.length > 0) {
    const merged = mergeObjectShapes(objectShapes);
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    const lines = Object.entries(merged.shape).map(([k, info]) => {
      const key = isValidIdent(k) ? k : JSON.stringify(k);
      const sample = info.samples[0] ?? null;
      const inner = zodType(sample, depth + 1);
      const wrapped = info.optional ? `${inner}.optional()` : inner;
      return `${indent}${key}: ${wrapped},`;
    });
    variants.push(`z.object({\n${lines.join("\n")}\n${closeIndent}})`);
  }

  if (variants.length === 1) return variants[0];
  return `z.union([${variants.join(", ")}])`;
}

// ---------- JSON Schema (draft-07) ----------

export function toJsonSchema(sample: JsonValue): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Response",
    ...jsonSchemaNode(sample),
  };
}

function jsonSchemaNode(value: JsonValue): Record<string, unknown> {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "number")
    return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array" };
    return { type: "array", items: mergeJsonSchemaItems(value) };
  }

  const entries = Object.entries(value);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, v] of entries) {
    properties[k] = jsonSchemaNode(v);
    required.push(k);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function mergeJsonSchemaItems(items: JsonValue[]): Record<string, unknown> {
  const objectShapes: Record<string, JsonValue>[] = [];
  const others: Record<string, unknown>[] = [];

  for (const item of items) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      objectShapes.push(item as Record<string, JsonValue>);
    } else {
      others.push(jsonSchemaNode(item));
    }
  }

  // Dedupe primitive variants: a homogeneous array (e.g. ["a","b"]) yields
  // repeated identical nodes, and `oneOf` requires EXACTLY one match — two
  // identical subschemas make every value match twice and fail validation.
  const seen = new Set<string>();
  const variants: Record<string, unknown>[] = [];
  for (const node of others) {
    const key = JSON.stringify(node);
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(node);
  }
  if (objectShapes.length > 0) {
    const merged = mergeObjectShapes(objectShapes);
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, info] of Object.entries(merged.shape)) {
      const sample = info.samples[0] ?? null;
      properties[k] = jsonSchemaNode(sample);
      if (!info.optional) required.push(k);
    }
    variants.push({
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    });
  }

  if (variants.length === 1) return variants[0];
  return { oneOf: variants };
}

// ---------- helpers ----------

const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
function isValidIdent(s: string): boolean {
  return IDENT_RE.test(s);
}
