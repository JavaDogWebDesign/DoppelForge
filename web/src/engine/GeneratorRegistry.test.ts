import { describe, it, expect } from "vitest";
import { GeneratorRegistry, CVV_PAIRS, AVS_PAIRS } from "./GeneratorRegistry";

describe("GeneratorRegistry.generate - determinism", () => {
  it("produces the same fake for the same seed, type, value and salt", () => {
    const a = new GeneratorRegistry(7).generate("email", "x@y.com", "path");
    const b = new GeneratorRegistry(7).generate("email", "x@y.com", "path");
    expect(b).toBe(a);
  });

  it("produces a different fake when the salt differs", () => {
    const reg = new GeneratorRegistry(7);
    expect(reg.generate("fullName", "n", "first")).not.toBe(
      reg.generate("fullName", "n", "second"),
    );
  });

  it("generates an identical isoDate for the same seed across instances", () => {
    // Regression guard: faker's date.recent() once anchored to wall-clock
    // `now`, so equal seeds drifted by milliseconds. The full-datetime branch
    // (sub-second precision) is where that non-determinism surfaced.
    const a = new GeneratorRegistry(5).generate("isoDate", "2026-04-18T14:32:07Z");
    const b = new GeneratorRegistry(5).generate("isoDate", "2026-04-18T14:32:07Z");
    expect(b).toBe(a);
  });
});

describe("GeneratorRegistry.generate - type fidelity", () => {
  it("keeps a numeric id numeric and preserves its digit length", () => {
    const fake = new GeneratorRegistry(1).generate("id", 4242);
    expect(typeof fake).toBe("number");
    expect(fake).toBeGreaterThanOrEqual(1000);
    expect(fake).toBeLessThanOrEqual(9999);
  });

  it("keeps an all-digit string id a string of the same length", () => {
    const fake = new GeneratorRegistry(1).generate("id", "00042");
    expect(typeof fake).toBe("string");
    expect(fake).toMatch(/^\d{5}$/);
  });

  it("preserves casing and separators in an alphanumeric id", () => {
    const fake = new GeneratorRegistry(1).generate("id", "cus_AB12");
    expect(fake).toMatch(/^[a-z0-9]{3}_[A-Z0-9]{4}$/);
    expect(fake).not.toBe("cus_AB12");
  });

  it("preserves a date-only ISO format", () => {
    expect(new GeneratorRegistry(1).generate("isoDate", "2020-01-01")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("preserves a full ISO datetime format", () => {
    const fake = new GeneratorRegistry(1).generate("isoDate", "2020-01-01T00:00:00Z");
    expect(fake).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("keeps a numeric price numeric and a string price a string", () => {
    expect(typeof new GeneratorRegistry(1).generate("priceAmount", 19.99)).toBe("number");
    expect(typeof new GeneratorRegistry(1).generate("priceAmount", "19.99")).toBe("string");
  });

  it("flips a boolean to its opposite", () => {
    expect(new GeneratorRegistry(1).generate("boolean", true)).toBe(false);
    expect(new GeneratorRegistry(1).generate("boolean", false)).toBe(true);
  });

  it("forges a country code for a code value, a name for a name value", () => {
    // A 2-letter `us` must not become a full country name like `Mayotte`.
    const lower = new GeneratorRegistry(1).generate("country", "us") as string;
    expect(lower).toMatch(/^[a-z]{2}$/);
    expect(lower).not.toBe("us");
    const upper = new GeneratorRegistry(1).generate("country", "US") as string;
    expect(upper).toMatch(/^[A-Z]{2}$/);
    const name = new GeneratorRegistry(1).generate("country", "United States") as string;
    expect(name.length).toBeGreaterThan(3);
  });

  it("forges a same-width, same-casing currency code", () => {
    expect(new GeneratorRegistry(1).generate("currency", "USD")).toMatch(/^[A-Z]{3}$/);
    expect(new GeneratorRegistry(1).generate("currency", "usd")).toMatch(/^[a-z]{3}$/);
  });

  it("forges a birthdate, preserving the original's date format", () => {
    const dateOnly = new GeneratorRegistry(1).generate("birthDate", "1990-05-12");
    expect(dateOnly).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateOnly).not.toBe("1990-05-12");
    const dateTime = new GeneratorRegistry(1).generate("birthDate", "1990-05-12T00:00:00.000Z");
    expect(dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("returns the original value for preserve and a constant for redact", () => {
    expect(new GeneratorRegistry(1).generate("preserve", "keep-me")).toBe("keep-me");
    expect(new GeneratorRegistry(1).generate("redact", "4111111111111111")).toBe(
      "[REDACTED]",
    );
  });
});

describe("GeneratorRegistry.generate - paired gateway fields", () => {
  // A code and its message, seeded from the same parent path, must land on the
  // same row of the gateway response table. The expected mapping is the real
  // table imported from the source, so editing it forces this test to update.
  const tableOf = (pairs: Array<[string, string]>): Record<string, string> =>
    Object.fromEntries(pairs);

  it("keeps cvv code and message consistent when they share a parent path", () => {
    const reg = new GeneratorRegistry(42);
    const code = reg.generate("cvvCode", "M", "payment.cvv_result.code") as string;
    const message = reg.generate(
      "cvvMessage",
      "Match",
      "payment.cvv_result.message",
    ) as string;
    expect(tableOf(CVV_PAIRS)[code]).toBe(message);
  });

  it("keeps avs code and message consistent when they share a parent path", () => {
    const reg = new GeneratorRegistry(99);
    const code = reg.generate("avsCode", "Y", "payment.avs_result.code") as string;
    const message = reg.generate(
      "avsMessage",
      "Address and 5-digit ZIP match",
      "payment.avs_result.message",
    ) as string;
    expect(tableOf(AVS_PAIRS)[code]).toBe(message);
  });
});
