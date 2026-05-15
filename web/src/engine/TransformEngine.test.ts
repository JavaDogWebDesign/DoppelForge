import { describe, it, expect } from "vitest";
import { TransformEngine } from "./TransformEngine";
import { GeneratorRegistry, DEFAULT_SEED } from "./GeneratorRegistry";
import { ConsistencyCache } from "./Cache";
import type { EndpointSpec, JsonValue } from "./types";

function makeEngine(seed: number = DEFAULT_SEED): TransformEngine {
  return new TransformEngine(new GeneratorRegistry(seed), new ConsistencyCache());
}

// Maps every leaf to its primitive type while keeping object keys and array
// nesting. Two values with the same `shape` are structurally identical — the
// core invariant of the tool (forge the same shape, change the values).
function shape(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = shape(value[key]);
    return out;
  }
  return value === null ? "null" : typeof value;
}

const customerEndpoint: EndpointSpec = {
  id: "test-customer",
  providerId: "test",
  endpoint: { method: "GET", path: "/customers/{id}" },
  signature: { required_paths: ["id", "email"] },
  fields: {
    id: { type: "id" },
    email: { type: "email" },
    object: { type: "preserve" },
  },
};

const sample: JsonValue = {
  id: "cus_AB12cd34",
  object: "customer",
  email: "real.person@example.com",
  metadata: {
    name: "Real Person",
    orders: [{ id: 991 }, { id: 992 }],
  },
};

describe("TransformEngine.transform", () => {
  it("preserves the structure of the input", () => {
    const { output } = makeEngine().transform(sample, customerEndpoint);
    expect(shape(output)).toEqual(shape(sample));
  });

  it("is deterministic for a given seed", () => {
    const a = makeEngine(123).transform(sample, customerEndpoint);
    const b = makeEngine(123).transform(sample, customerEndpoint);
    expect(b.output).toEqual(a.output);
  });

  it("produces different output for a different seed", () => {
    const a = makeEngine(1).transform(sample, customerEndpoint);
    const b = makeEngine(2).transform(sample, customerEndpoint);
    expect(b.output).not.toEqual(a.output);
  });

  it("keeps fields marked `preserve` byte-for-byte", () => {
    const { output } = makeEngine().transform(sample, customerEndpoint);
    expect((output as Record<string, JsonValue>).object).toBe("customer");
  });

  it("replaces a PII field with a different but well-formed value", () => {
    const { output } = makeEngine().transform(sample, customerEndpoint);
    const email = (output as Record<string, JsonValue>).email;
    expect(email).not.toBe(sample.email);
    expect(email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  it("strips prototype-pollution keys from object input", () => {
    const polluted = JSON.parse('{"id":"x","__proto__":{"admin":true},"ok":1}') as JsonValue;
    const { output } = makeEngine().transform(polluted, customerEndpoint);
    expect(Object.keys(output as object)).toEqual(["id", "ok"]);
  });

  it("counts preserved vs transformed fields in stats", () => {
    // A flat, fully-mapped input so the counts don't depend on the generic
    // detector's handling of unmapped fields.
    const flat: JsonValue = { id: "abc123", object: "customer", email: "x@y.com" };
    const { stats } = makeEngine().transform(flat, customerEndpoint);
    expect(stats.fieldsPreserved).toBe(1);
    expect(stats.fieldsTransformed).toBe(2);
    expect(stats.fieldsFromGeneric).toBe(0);
  });
});

describe("TransformEngine.transform — overrides", () => {
  const flat: JsonValue = { id: "abc123", object: "customer", email: "real@person.com" };

  it("override=false forces a normally-transformed field to preserve", () => {
    const overrides = new Map([["email", false]]);
    const { output } = makeEngine().transform(flat, customerEndpoint, overrides);
    expect((output as Record<string, JsonValue>).email).toBe("real@person.com");
  });

  it("override=true obfuscates a field the map marked preserve", () => {
    const overrides = new Map([["object", true]]);
    const { output } = makeEngine().transform(flat, customerEndpoint, overrides);
    expect((output as Record<string, JsonValue>).object).not.toBe("customer");
  });

  it("a literal value override beats every other rule", () => {
    const valueOverrides = new Map([["email", "fixed@test.example"]]);
    const { output } = makeEngine().transform(flat, customerEndpoint, new Map(), valueOverrides);
    expect((output as Record<string, JsonValue>).email).toBe("fixed@test.example");
  });

  it("coerces a value override back to the original primitive type", () => {
    const numeric = makeEngine().transform(
      { id: 42 },
      customerEndpoint,
      new Map(),
      new Map([["id", "999"]]),
    );
    expect((numeric.output as Record<string, JsonValue>).id).toBe(999);

    const bool = makeEngine().transform(
      { object: true },
      customerEndpoint,
      new Map(),
      new Map([["object", "false"]]),
    );
    expect((bool.output as Record<string, JsonValue>).object).toBe(false);
  });
});

describe("TransformEngine.transform — anchoring & wildcard rules", () => {
  const anchored: EndpointSpec = {
    id: "anchored",
    providerId: "test",
    endpoint: { method: "GET", path: "/x" },
    signature: { required_paths: [] },
    fields: { "*": { type: "id", anchor: true } },
  };
  const unanchored: EndpointSpec = { ...anchored, fields: { "*": { type: "id" } } };

  it("reuses the cached fake for a repeated anchored value and counts the hit", () => {
    const input: JsonValue = { first: "REPEATEDVAL", second: "REPEATEDVAL" };
    const { output, stats } = makeEngine().transform(input, anchored);
    const o = output as Record<string, JsonValue>;
    expect(o.first).toBe(o.second);
    expect(stats.cacheHits).toBe(1);
  });

  it("salts non-anchored siblings so identical values get different fakes", () => {
    const input: JsonValue = { first: "REPEATEDVAL", second: "REPEATEDVAL" };
    const { output } = makeEngine().transform(input, unanchored);
    const o = output as Record<string, JsonValue>;
    expect(o.first).not.toBe(o.second);
  });
});

describe("TransformEngine.transform — auto type & array-path rules", () => {
  it("routes an `auto` field through the generic detector", () => {
    const ep: EndpointSpec = {
      id: "auto",
      providerId: "test",
      endpoint: { method: "GET", path: "/x" },
      signature: { required_paths: [] },
      fields: { email: { type: "auto" } },
    };
    const { output, stats } = makeEngine().transform({ email: "a@b.com" }, ep);
    expect(stats.fieldsFromGeneric).toBe(1);
    expect(stats.fieldsTransformed).toBe(0);
    const email = (output as Record<string, JsonValue>).email;
    expect(email).not.toBe("a@b.com");
    expect(email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  it("applies a rule keyed on an array path to every element", () => {
    const ep: EndpointSpec = {
      id: "items",
      providerId: "test",
      endpoint: { method: "GET", path: "/x" },
      signature: { required_paths: [] },
      fields: { "items[].price": { type: "priceAmount" } },
    };
    const { output, stats } = makeEngine().transform(
      { items: [{ price: 10 }, { price: 20 }] },
      ep,
    );
    const items = (output as { items: Array<{ price: JsonValue }> }).items;
    expect(items[0].price).not.toBe(10);
    expect(items[1].price).not.toBe(20);
    expect(typeof items[0].price).toBe("number");
    expect(stats.fieldsTransformed).toBe(2);
  });
});
