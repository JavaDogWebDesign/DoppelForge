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
    expect(detectGeneric("user.id", "t2_20v0t6zvap")).toBe("id");
  });

  it("treats an id-named field holding a slug/enum value as preserve", () => {
    // a lowercase hyphenated slug or a plain word is a label, not an identifier
    expect(detectGeneric("trophy.id", "frequent-contributor")).toBe("preserve");
    expect(detectGeneric("badge.id", "active")).toBe("preserve");
  });

  it("flags a bare `name` field only for a person-name or handle value", () => {
    expect(detectGeneric("user.name", "Jane Doe")).toBe("fullName");
    // a handle (underscore/digit token) sitting in a generic name field
    expect(detectGeneric("redditor.name", "ur_mamas_krama")).toBe("id");
    // a plain label / number is left alone
    expect(detectGeneric("room.name", "50")).toBe("preserve");
    expect(detectGeneric("product.name", "Widget")).toBe("preserve");
  });

  it("matches camelCase / PascalCase keys against the snake_case hints", () => {
    expect(detectGeneric("geo.countryCode", "US")).toBe("countryCode");
    expect(detectGeneric("geo.CountryCode", "US")).toBe("countryCode");
    expect(detectGeneric("user.firstName", "Bob")).toBe("firstName");
    expect(detectGeneric("billing.postalCode", "94016")).toBe("postalCode");
    expect(detectGeneric("profile.userName", "night_owl_2")).toBe("id");
  });

  it("always redacts username / display-name / handle fields", () => {
    expect(detectGeneric("profile.username", "ur_mamas_krama")).toBe("id");
    expect(detectGeneric("profile.displayName", "ur_mamas_krama")).toBe("id");
    expect(detectGeneric("x.display_name", "Ada Lovelace")).toBe("id");
    expect(detectGeneric("user.login", "octocat")).toBe("id");
    expect(detectGeneric("post.screen_name", "night_owl_2")).toBe("id");
  });
});

describe("detectGeneric - identifier and credential keys", () => {
  it("treats any *_id / *Id / *_ids key as an identifier", () => {
    expect(detectGeneric("event.entityId", "1457595")).toBe("id");
    expect(detectGeneric("a.experimentIds", "9300002856528")).toBe("id");
    expect(detectGeneric("a.layer_id", "rollout-22405")).toBe("id");
    expect(detectGeneric("a.uid", "3ced34ac47e2f9c6a53b26566c5d2406")).toBe("id");
    // The id gate still applies — a tiny value under an id key stays preserved.
    expect(detectGeneric("a.entityId", 7)).toBe("preserve");
  });

  it("treats jwt / token / secret / api-key keys as identifiers", () => {
    // id-shaped values (mixed case / digits) so the key rule is what's tested.
    expect(detectGeneric("auth.jwt", "Hdr9Pay7Sig2")).toBe("id");
    expect(detectGeneric("x.connectionToken", "7668b16abd4F4f1e")).toBe("id");
    expect(detectGeneric("x.client_secret", "abc123def456ghi7")).toBe("id");
    expect(detectGeneric("x.apiKey", "QVJ3LEKkvaE39FLM")).toBe("id");
  });
});

describe("detectGeneric - value-shape: tokens and placeholders", () => {
  it("detects a JWT by value and obfuscates it", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2EuY29tIn0.c2lnbmF0dXJlMQ";
    expect(detectGeneric("body.tac", jwt)).toBe("id");
  });

  it("detects a long hex run (hash / tracking id) as an identifier", () => {
    expect(detectGeneric("evt.vxid", "3ced34ac47e2f9c6a53b26566c5d2406d5d99eab")).toBe("id");
    // A short hex word is not swept up.
    expect(detectGeneric("evt.tag", "beef")).toBe("preserve");
  });

  it("keeps a placeholder value verbatim whatever the key says", () => {
    expect(detectGeneric("user.first_name", "N/A")).toBe("preserve");
    expect(detectGeneric("user.last_name", "")).toBe("preserve");
    expect(detectGeneric("user.email", "unknown")).toBe("preserve");
  });

  it("redacts a credit card only when it passes the Luhn checksum", () => {
    // 4111 1111 1111 1111 is a valid test card — passes Luhn.
    expect(detectGeneric("pay.pan", "4111111111111111")).toBe("redact");
    // A 13-digit run that fails Luhn is not a card — left as preserve.
    expect(detectGeneric("a.lotteryRun", "1111111111111")).toBe("preserve");
    // An id-named field with the same digits resolves as an identifier, not a
    // card — the key hint wins before the value pattern is ever consulted.
    expect(detectGeneric("a.experimentId", "9300002856528")).toBe("id");
  });
});

describe("detectGeneric - dates vs birthdates", () => {
  it("types a plain date value as isoDate", () => {
    expect(detectGeneric("article.published", "2026-05-16")).toBe("isoDate");
    expect(detectGeneric("evt.ts", "2026-05-16T07:51:00")).toBe("isoDate");
  });

  it("types a birthdate key as birthDate, distinct from a plain date", () => {
    expect(detectGeneric("user.dob", "1990-05-12")).toBe("birthDate");
    expect(detectGeneric("user.date_of_birth", "1990-05-12")).toBe("birthDate");
    expect(detectGeneric("user.birthday", "1990-05-12")).toBe("birthDate");
    expect(detectGeneric("user.dateOfBirth", "1990-05-12")).toBe("birthDate");
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
