import { describe, it, expect } from "vitest";
import { TransformEngine } from "./TransformEngine";
import { GeneratorRegistry } from "./GeneratorRegistry";
import { ConsistencyCache } from "./Cache";
import type { EndpointSpec, JsonValue } from "./types";

// The core promise of the tool: a forged response carries the original's
// shape but none of its sensitive values. These tests plant synthetic PII
// into representative responses, run the engine, and assert that not one
// planted string survives anywhere in the output.

function makeEngine(seed: number): TransformEngine {
  return new TransformEngine(new GeneratorRegistry(seed), new ConsistencyCache());
}

function collectStrings(value: JsonValue, out: Set<string>): void {
  if (typeof value === "string") {
    out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

// Maps every leaf to its primitive type, keeping object keys and array
// nesting - two values with the same shape are structurally identical.
function shapeOf(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) out[k] = shapeOf(value[k]);
    return out;
  }
  return value === null ? "null" : typeof value;
}

// Strings shorter than this are low-entropy (currency codes, status enums,
// country codes) where a faker collision is plausible and meaningless - the
// sweep skips them. Every planted PII value in these fixtures is >= 6 chars.
const MIN_ENTROPY = 6;

interface PrivacyFixture {
  name: string;
  endpoint: EndpointSpec | null;
  input: JsonValue;
  // Strings >= MIN_ENTROPY that are intentionally NOT obfuscated - a field
  // mapped `preserve`, or a value the generic detector doesn't recognize.
  // Everything else long must vanish; this list is the fixture's contract.
  preserved: string[];
}

function endpoint(id: string, fields: EndpointSpec["fields"]): EndpointSpec {
  return {
    id,
    providerId: "test",
    endpoint: { method: "GET", path: `/${id}` },
    signature: { required_paths: [] },
    fields,
  };
}

const fixtures: PrivacyFixture[] = [
  {
    name: "payments customer (mapped endpoint)",
    endpoint: endpoint("customer", {
      id: { type: "id" },
      object: { type: "preserve" },
      email: { type: "email" },
      name: { type: "fullName" },
      phone: { type: "phone" },
      "address.line1": { type: "street" },
      "address.city": { type: "city" },
      "address.postal_code": { type: "postalCode" },
      "address.country": { type: "countryCode" },
      created: { type: "unixTimestamp" },
      livemode: { type: "preserve" },
      currency: { type: "preserve" },
      "metadata.internal_note": { type: "shortText" },
    }),
    input: {
      id: "cus_9Hv2KpQ4xMnL",
      object: "customer",
      email: "penelope.hartwell@example.com",
      name: "Penelope Hartwell",
      phone: "+1-617-555-0142",
      address: {
        line1: "4471 Maplewood Crescent",
        city: "Worcester",
        postal_code: "02139",
        country: "US",
      },
      created: 1715000000,
      livemode: false,
      currency: "usd",
      metadata: { internal_note: "VIP account, contact Penelope directly" },
    },
    preserved: ["customer"],
  },
  {
    name: "e-commerce order with line items (mapped endpoint)",
    endpoint: endpoint("order", {
      id: { type: "id" },
      email: { type: "email" },
      "customer.first_name": { type: "firstName" },
      "customer.last_name": { type: "lastName" },
      "customer.email": { type: "email" },
      "billing_address.address1": { type: "street" },
      "billing_address.city": { type: "city" },
      "billing_address.phone": { type: "phone" },
      financial_status: { type: "preserve" },
      fulfillment_status: { type: "preserve" },
      currency: { type: "preserve" },
      "line_items[].title": { type: "productName" },
      "line_items[].sku": { type: "sku" },
      "line_items[].price": { type: "priceAmount" },
    }),
    input: {
      id: "gid://shopify/Order/5512098",
      email: "marcus.delgado@example.net",
      customer: {
        first_name: "Marcus",
        last_name: "Delgado",
        email: "marcus.delgado@example.net",
      },
      billing_address: {
        address1: "88 Birchwood Terrace",
        city: "Northampton",
        phone: "+1-802-555-0173",
      },
      financial_status: "paid",
      fulfillment_status: "fulfilled",
      currency: "USD",
      line_items: [
        { title: "Handwoven Wool Blanket", sku: "BLNKT-WOOL-01", price: "129.00" },
        { title: "Ceramic Pour-Over Brewer", sku: "CRMC-POUR-02", price: "64.95" },
      ],
    },
    preserved: ["fulfilled"],
  },
  {
    name: "unknown provider (no endpoint - pure generic detection)",
    endpoint: null,
    input: {
      user_email: "tobias.greenfield@example.org",
      full_name: "Tobias Greenfield",
      phone_number: "+44 20 7946 0958",
      ip_address: "192.0.2.146",
      request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      shipping: {
        street_address: "12 Larkspur Lane",
        city: "Harrogate",
      },
      event_type: "account.updated",
      notes: "Refund requested by Tobias on the prior invoice",
    },
    preserved: ["account.updated"],
  },
  {
    name: "payment transaction (mapped endpoint)",
    endpoint: endpoint("transaction", {
      id: { type: "id" },
      object: { type: "preserve" },
      status: { type: "preserve" },
      amount: { type: "priceAmount" },
      "card.number": { type: "redact" },
      "card.cardholder_name": { type: "fullName" },
      "card.expiry": { type: "isoDate" },
      "merchant.name": { type: "company" },
      "merchant.support_url": { type: "url" },
      "billing.line1": { type: "street" },
      "billing.line2": { type: "streetSecondary" },
      "billing.state": { type: "state" },
      "billing.province": { type: "stateOrProvince" },
      processed_at: { type: "isoDate" },
      receipt_url: { type: "url" },
      description: { type: "longText" },
    }),
    input: {
      id: "txn_Pk29Lm4Vx81Q",
      object: "transaction",
      status: "settled",
      amount: "248.50",
      card: {
        number: "4539114427362961",
        cardholder_name: "Geraldine Whitcombe",
        expiry: "2027-09-30",
      },
      merchant: {
        name: "Brightwater Coffee Roasters LLC",
        support_url: "https://brightwater-roasters.example.com/support",
      },
      billing: {
        line1: "270 Sycamore Avenue",
        line2: "Suite 412",
        state: "Vermont",
        province: "Ontario",
      },
      processed_at: "2026-04-18T14:32:07Z",
      receipt_url: "https://pay.example.com/receipts/9Xy2LpQ",
      description:
        "Recurring monthly subscription charge for the Founders tier membership plan",
    },
    preserved: ["transaction", "settled"],
  },
];

describe("privacy invariant - no original value survives obfuscation", () => {
  for (const fx of fixtures) {
    describe(fx.name, () => {
      const { output } = makeEngine(1234).transform(fx.input, fx.endpoint);
      const serialized = JSON.stringify(output);
      const inputStrings = new Set<string>();
      collectStrings(fx.input, inputStrings);
      const preserved = new Set(fx.preserved);

      it("preserves the response structure", () => {
        expect(shapeOf(output)).toEqual(shapeOf(fx.input));
      });

      it("removes every sensitive string from the output", () => {
        const checked: string[] = [];
        const survivors: string[] = [];
        for (const s of inputStrings) {
          if (s.length < MIN_ENTROPY || preserved.has(s)) continue;
          checked.push(s);
          if (serialized.includes(s)) survivors.push(s);
        }
        // Guard against a vacuously-passing fixture: there must be real PII
        // to remove in the first place.
        expect(checked.length).toBeGreaterThanOrEqual(4);
        expect(survivors).toEqual([]);
      });

      it("keeps the values that are intentionally preserved", () => {
        for (const s of fx.preserved) {
          expect(serialized).toContain(s);
        }
      });
    });
  }

  it("is deterministic - the same seed forges the identical output", () => {
    for (const fx of fixtures) {
      const a = makeEngine(2024).transform(fx.input, fx.endpoint).output;
      const b = makeEngine(2024).transform(fx.input, fx.endpoint).output;
      expect(b).toEqual(a);
    }
  });
});
