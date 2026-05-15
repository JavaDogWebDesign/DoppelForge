import { describe, it, expect } from "vitest";
import { z } from "zod";
import Ajv from "ajv";
import {
  generate,
  toTypeScript,
  toZod,
  toJsonSchema,
} from "./index";
import type { JsonValue } from "../engine/types";

// The codegen emitters turn a sample payload into a TypeScript type, a Zod
// schema, or a JSON Schema. A broken emitter ships broken code to the user,
// so wherever the output is executable it is executed: the Zod schema is
// compiled and run, and the JSON Schema is compiled with ajv.

// Extracts the schema expression from a `toZod` output and evaluates it with
// `z` in scope, yielding a live schema we can actually validate against.
function compileZod(code: string): z.ZodTypeAny {
  const m = code.match(/export const \w+ = ([\s\S]+?);\nexport type/);
  if (!m) throw new Error(`could not extract a zod schema from:\n${code}`);
  return new Function("z", `return (${m[1]});`)(z) as z.ZodTypeAny;
}

function compileJsonSchema(sample: JsonValue) {
  return new Ajv().compile(toJsonSchema(sample) as Record<string, unknown>);
}

const SAMPLE: JsonValue = {
  id: "cus_123",
  count: 3,
  active: true,
  deleted: null,
  address: { city: "Boston", zip: "02101" },
  tags: ["a", "b"],
  orders: [
    { sku: "X1", qty: 2 },
    { sku: "X2", qty: 1, gift: true },
  ],
};

describe("generate (dispatcher)", () => {
  it("routes each target to its emitter", () => {
    expect(generate("typescript", SAMPLE)).toContain("export type Response");
    expect(generate("zod", SAMPLE)).toContain('import { z } from "zod"');
  });

  it("returns serialized JSON for the jsonSchema target", () => {
    const out = generate("jsonSchema", SAMPLE);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });
});

describe("toTypeScript", () => {
  it("emits primitives as their TS keyword", () => {
    expect(toTypeScript("x")).toContain("= string;");
    expect(toTypeScript(7)).toContain("= number;");
    expect(toTypeScript(true)).toContain("= boolean;");
    expect(toTypeScript(null)).toContain("= null;");
  });

  it("emits an empty object and empty array as their fallbacks", () => {
    expect(toTypeScript({})).toContain("Record<string, unknown>");
    expect(toTypeScript([])).toContain("unknown[]");
  });

  it("parenthesizes an array of object elements", () => {
    expect(toTypeScript([{ a: 1 }])).toContain("})[]");
  });

  it("emits a union for a heterogeneous primitive array", () => {
    const out = toTypeScript([1, "a"]);
    expect(out).toMatch(/\((number \| string|string \| number)\)\[\]/);
  });

  it("marks a key missing from some array elements as optional", () => {
    // `gift` is present on only one of the two orders.
    expect(toTypeScript(SAMPLE)).toMatch(/gift\?:\s*boolean;/);
  });

  it("quotes a key that is not a valid identifier", () => {
    expect(toTypeScript({ "first-name": "x" })).toContain('"first-name": string;');
  });

  it("honors a custom root name", () => {
    expect(toTypeScript(SAMPLE, "Customer")).toContain("export type Customer =");
  });
});

describe("toZod — the emitted schema actually runs", () => {
  it("accepts the sample it was generated from", () => {
    const schema = compileZod(toZod(SAMPLE));
    expect(schema.safeParse(SAMPLE).success).toBe(true);
  });

  it("rejects a payload with a wrong-typed field", () => {
    const schema = compileZod(toZod(SAMPLE));
    expect(schema.safeParse({ ...SAMPLE, count: "three" }).success).toBe(false);
  });

  it("treats a key absent from some array elements as optional", () => {
    const schema = compileZod(toZod(SAMPLE));
    // An order without `gift` must still validate.
    const trimmed = { ...SAMPLE, orders: [{ sku: "X3", qty: 9 }] };
    expect(schema.safeParse(trimmed).success).toBe(true);
  });

  it("emits the import line and an inferred type export", () => {
    const out = toZod(SAMPLE, "Customer");
    expect(out).toContain('import { z } from "zod";');
    expect(out).toContain("export type Customer = z.infer<typeof Customer>;");
  });

  it("produces a compilable schema for an empty object", () => {
    const schema = compileZod(toZod({}));
    expect(schema.safeParse({ anything: 1 }).success).toBe(true);
  });
});

describe("toJsonSchema — validated with ajv", () => {
  it("produces a draft-07 schema that accepts the sample", () => {
    const validate = compileJsonSchema(SAMPLE);
    expect(validate(SAMPLE)).toBe(true);
  });

  it("rejects a payload with a wrong-typed field", () => {
    const validate = compileJsonSchema(SAMPLE);
    expect(validate({ ...SAMPLE, active: "yes" })).toBe(false);
  });

  it("distinguishes integer from number and enforces it", () => {
    const node = toJsonSchema(3) as { type: string };
    expect(node.type).toBe("integer");
    expect((toJsonSchema(3.5) as { type: string }).type).toBe("number");
    const validateInt = compileJsonSchema(3);
    expect(validateInt(3)).toBe(true);
    expect(validateInt(3.5)).toBe(false);
  });

  it("lists every object key in `required`", () => {
    const node = toJsonSchema({ a: 1, b: 2 }) as { required: string[] };
    expect(node.required.sort()).toEqual(["a", "b"]);
  });

  it("emits oneOf for a heterogeneous array", () => {
    const node = toJsonSchema([1, "a"]) as {
      items: { oneOf?: unknown[] };
    };
    expect(node.items.oneOf).toHaveLength(2);
  });

  it("emits a bare array type for an empty array", () => {
    const node = toJsonSchema([]) as Record<string, unknown>;
    expect(node.type).toBe("array");
    expect(node.items).toBeUndefined();
  });
});
