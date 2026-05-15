import { describe, it, expect } from "vitest";
import { GeneratorRegistry } from "./GeneratorRegistry";

describe("GeneratorRegistry.generate — determinism", () => {
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
});

describe("GeneratorRegistry.generate — type fidelity", () => {
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

  it("returns the original value for preserve and a constant for redact", () => {
    expect(new GeneratorRegistry(1).generate("preserve", "keep-me")).toBe("keep-me");
    expect(new GeneratorRegistry(1).generate("redact", "4111111111111111")).toBe(
      "[REDACTED]",
    );
  });
});

describe("GeneratorRegistry.generate — paired gateway fields", () => {
  // A cvvCode and its cvvMessage seeded from the same parent path must land on
  // the same row of the gateway response table.
  const CVV_PAIRS: Record<string, string> = {
    M: "Match",
    N: "No match",
    P: "Not processed",
    S: "CVV not present",
    U: "Issuer unable to process CVV",
    X: "Service not supported",
  };

  it("keeps cvv code and message consistent when they share a parent path", () => {
    const reg = new GeneratorRegistry(42);
    const code = reg.generate("cvvCode", "M", "payment.cvv_result.code") as string;
    const message = reg.generate(
      "cvvMessage",
      "Match",
      "payment.cvv_result.message",
    ) as string;
    expect(CVV_PAIRS[code]).toBe(message);
  });
});
