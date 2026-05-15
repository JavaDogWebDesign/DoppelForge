import { describe, it, expect } from "vitest";
import { detectGeneric } from "./GenericDetector";

describe("detectGeneric - key-name hints", () => {
  it("maps known PII key names to their semantic type", () => {
    expect(detectGeneric("user.first_name", "Bob")).toBe("firstName");
    expect(detectGeneric("user.email", "a@b.com")).toBe("email");
    expect(detectGeneric("billing.postal_code", "94016")).toBe("postalCode");
    expect(detectGeneric("contact.phone", "555-0100")).toBe("phone");
  });

  it("treats an id-named field with a non-id-shaped value as preserve", () => {
    // small number / short string don't look like real identifiers
    expect(detectGeneric("order.id", 5)).toBe("preserve");
    expect(detectGeneric("order.id", "ab")).toBe("preserve");
  });

  it("keeps an id-named field with an id-shaped value as id", () => {
    expect(detectGeneric("order.id", 5000)).toBe("id");
    expect(detectGeneric("order.id", "abc123")).toBe("id");
  });
});

describe("detectGeneric - path hints take precedence over key hints", () => {
  it("disambiguates a generic `code` key by its parent context", () => {
    expect(detectGeneric("payment.cvv_result.code", "M")).toBe("cvvCode");
    expect(detectGeneric("payment.avs_result.message", "Match")).toBe("avsMessage");
  });
});

describe("detectGeneric - value-pattern fallback", () => {
  it("detects formats from the value when the key gives no hint", () => {
    expect(detectGeneric("ref", "550e8400-e29b-41d4-a716-446655440000")).toBe("uuid");
    expect(detectGeneric("addr", "192.168.1.1")).toBe("ipv4");
    expect(detectGeneric("link", "https://example.com/x")).toBe("url");
    expect(detectGeneric("ts", "2020-01-15")).toBe("isoDate");
  });

  it("redacts credit-card-shaped digit runs", () => {
    expect(detectGeneric("pan", "4111111111111111")).toBe("redact");
  });

  it("detects a separator-bearing phone number by value", () => {
    expect(detectGeneric("line", "+1 555-123-4567")).toBe("phone");
  });

  it("falls back to preserve for an unrecognized value", () => {
    expect(detectGeneric("status", "hello")).toBe("preserve");
  });
});
