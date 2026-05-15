import { describe, it, expect } from "vitest";
import { loadProviders } from "./loader";
import { TransformEngine } from "../engine/TransformEngine";
import { GeneratorRegistry } from "../engine/GeneratorRegistry";
import { ConsistencyCache } from "../engine/Cache";
import { bestMatch } from "../engine/Matcher";
import { parseXml } from "../engine/xml";
import type { JsonValue } from "../engine/types";

// Layer 2 golden tests. Unlike the synthesized Layer 1 tests, these use
// fixtures shaped like REAL provider responses, so they verify the field map
// against reality: that the matcher recognizes a real shape, and that PII
// sitting where it actually sits in a real payload gets obfuscated.
//
// PRIVACY: every fixture below is hand-authored synthetic data. The real
// responses they were modeled on are never committed to this repo.

const allEndpoints = loadProviders().flatMap((p) => p.endpoints);

function endpointById(id: string) {
  const ep = allEndpoints.find((e) => e.id === id);
  if (!ep) throw new Error(`endpoint not found: ${id}`);
  return ep;
}

function makeEngine(): TransformEngine {
  return new TransformEngine(new GeneratorRegistry(987654), new ConsistencyCache());
}

function shapeOf(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) out[k] = shapeOf(value[k]);
    return out;
  }
  return value === null ? "null" : typeof value;
}

// ----- Piano: GET /api/v3/publisher/subscription/get -----

const PIANO_INPUT: JsonValue = {
  code: 0,
  ts: 1778757991,
  subscription: {
    subscription_id: "SUBFAKE7PZQW",
    auto_renew: true,
    will_auto_renew: false,
    next_renewal_date: 1803790800,
    billing_plan: "Free for Mar 10, 2026 - Feb 28, 2027",
    end_date: 1803790800,
    cancelable: true,
    is_active: false,
    status: "completed",
    status_name: "Completed",
    in_grace_period: false,
    term: {
      aid: "aidFAKE01",
      term_id: "TERMFAKE9AQZ",
      resource: {
        rid: "RIDFAKE01",
        aid: "aidFAKE01",
        deleted: false,
        create_date: 1745511280,
        name: "Premium Digital Pass",
        description: "",
        type: "standard",
      },
      name: "Annual | Premium Digital Pass | Site License | USD",
      description: "",
      type: "specific_email_addresses_contract",
      create_date: 1771960695,
      schedule: {
        schedule_id: "SCHEDFAKE9nc",
        name: "Northwind Trading Company",
        aid: "aidFAKE01",
        create_date: 1771960728,
        periods: [
          {
            period_id: "PERIODFAKE9nc",
            name: "Northwind Trading Company",
            begin_date: 1771909200,
            end_date: 1803790800,
            is_active: true,
          },
        ],
      },
      payment_billing_plan:
        '{"type":"contract","periods":[{"periodPubId":"PERIODFAKE9nc","name":"Northwind Trading Company","currency":"USD"}],"currencyCode":"USD"}',
      payment_billing_plan_description: "Free for Feb 24, 2026 - Feb 28, 2027",
    },
    user: {
      first_name: "Marisol",
      last_name: "Vandenberg",
      personal_name: "Marisol Vandenberg",
      email: "marisol.vandenberg@example.test",
      uid: "UID7C2FAKE4E8AAC10EXAMPLE0001",
      create_date: 1773123267,
      display_name: "marisol.vandenberg@example.test",
    },
    resource: {
      rid: "RIDFAKE01",
      aid: "aidFAKE01",
      name: "Premium Digital Pass",
      type: "standard",
    },
    start_date: 1773123270,
    create_date: 1773123270,
    charge_count: 1,
    acquisition_type: "SELF",
  },
};

const PIANO_PII = [
  "Marisol",
  "Vandenberg",
  "marisol.vandenberg@example.test",
  "UID7C2FAKE4E8AAC10EXAMPLE0001",
  "Northwind Trading Company",
];

// ----- BigCommerce: GET /v2/orders/{orderId} (XML) -----

const BIGCOMMERCE_XML = `<?xml version="1.0"?>
<order>
    <id>88007766</id>
    <customer_id>55114433</customer_id>
    <date_created>Thu, 03 Jul 2025 09:42:12 +0000</date_created>
    <date_modified>Thu, 03 Jul 2025 09:42:22 +0000</date_modified>
    <date_shipped/>
    <status_id>0</status_id>
    <status>Incomplete</status>
    <total_inc_tax>24.1500</total_inc_tax>
    <items_total>1</items_total>
    <payment_method>Credit Card</payment_method>
    <payment_provider_id>ZZQ9FAKEPROVIDER0001XYZ</payment_provider_id>
    <payment_status>declined</payment_status>
    <ip_address>203.0.113.47</ip_address>
    <ip_address_v6/>
    <geoip_country>United Kingdom</geoip_country>
    <geoip_country_iso2>GB</geoip_country_iso2>
    <currency_code>USD</currency_code>
    <staff_notes/>
    <customer_message/>
    <is_deleted>true</is_deleted>
    <cart_id>aaaa1111-bbbb-2222-cccc-333344445555</cart_id>
    <billing_address>
        <first_name>Tamsin</first_name>
        <last_name>Brightwater</last_name>
        <company/>
        <street_1>412 Marigold Hollow Way</street_1>
        <street_2/>
        <city>Fernrock</city>
        <state>Vermillion</state>
        <zip>58420</zip>
        <country>United States</country>
        <country_iso2>US</country_iso2>
        <phone>(555) 014-2733</phone>
        <email>tamsin.brightwater@example.test</email>
        <form_fields/>
    </billing_address>
    <fees>
        <link rel="resource" href="https://api.bigcommerce.com/stores/examplehash9z/v2/orders/88007766/fees">/orders/88007766/fees</link>
    </fees>
    <products>
        <link rel="resource" href="https://api.bigcommerce.com/stores/examplehash9z/v2/orders/88007766/products">/orders/88007766/products</link>
    </products>
    <customer_locale>en</customer_locale>
    <custom_status>Incomplete</custom_status>
</order>`;

const BIGCOMMERCE_PII = [
  "Tamsin",
  "Brightwater",
  "412 Marigold Hollow Way",
  "Fernrock",
  "Vermillion",
  "(555) 014-2733",
  "tamsin.brightwater@example.test",
  "203.0.113.47",
  "aaaa1111-bbbb-2222-cccc-333344445555",
  "ZZQ9FAKEPROVIDER0001XYZ",
  "examplehash9z",
  "88007766",
  "55114433",
];

// ----- Braintree: GraphQL API, node(id) resolved to a Transaction -----

const BRAINTREE_INPUT: JsonValue = {
  data: {
    node: {
      id: "FAKEBASE64NODEID9XZ",
      legacyId: "fakelegacy01",
      createdAt: "2026-04-16T02:59:53.000000Z",
      status: "SETTLED",
      orderId: "BT_FAKEORDER0001XYZ",
      merchantAccountId: "ExampleMerchantAcct_MXN",
      amount: { value: "236.64", currencyIsoCode: "MXN" },
      disbursementDetails: {
        date: "2026-04-20",
        amount: { value: "13.70", currencyIsoCode: "USD" },
        exchangeRate: "0.05791",
        fundsHeld: false,
      },
      statusHistory: [
        {
          status: "SETTLED",
          timestamp: "2026-04-16T06:58:40.000000Z",
          amount: { value: "236.64", currencyIsoCode: "MXN" },
        },
        {
          status: "AUTHORIZED",
          timestamp: "2026-04-16T02:59:53.000000Z",
          amount: { value: "236.64", currencyIsoCode: "MXN" },
        },
      ],
    },
  },
  extensions: { requestId: "fa11ec0f-1111-2222-3333-444455556666" },
};

const BRAINTREE_PII = [
  "FAKEBASE64NODEID9XZ",
  "fakelegacy01",
  "BT_FAKEORDER0001XYZ",
  "ExampleMerchantAcct_MXN",
  "fa11ec0f-1111-2222-3333-444455556666",
];

describe("Layer 2 golden tests (realistic synthetic responses)", () => {
  describe("piano/v3-publisher-subscription-get", () => {
    const ep = endpointById("piano/v3-publisher-subscription-get");

    it("the matcher identifies this endpoint from a realistic response", () => {
      expect(bestMatch(PIANO_INPUT, allEndpoints)?.endpoint.id).toBe(ep.id);
    });

    it("transforms with the response structure preserved", () => {
      const { output } = makeEngine().transform(PIANO_INPUT, ep);
      expect(shapeOf(output)).toEqual(shapeOf(PIANO_INPUT));
    });

    it("obfuscates every PII value, including the unmapped schedule names", () => {
      const { output } = makeEngine().transform(PIANO_INPUT, ep);
      const serialized = JSON.stringify(output);
      for (const pii of PIANO_PII) {
        expect(serialized).not.toContain(pii);
      }
    });
  });

  describe("bigcommerce/v2-orders-detail", () => {
    const ep = endpointById("bigcommerce/v2-orders-detail");
    const parsed = parseXml(BIGCOMMERCE_XML);

    it("the matcher identifies this endpoint from a realistic XML response", () => {
      expect(bestMatch(parsed.data, allEndpoints)?.endpoint.id).toBe(ep.id);
    });

    it("transforms with the response structure preserved", () => {
      const { output } = makeEngine().transform(parsed.data, ep);
      expect(shapeOf(output)).toEqual(shapeOf(parsed.data));
    });

    it("obfuscates every PII value, including the store hash in resource links", () => {
      const { output } = makeEngine().transform(parsed.data, ep);
      const serialized = JSON.stringify(output);
      for (const pii of BIGCOMMERCE_PII) {
        expect(serialized).not.toContain(pii);
      }
    });
  });

  describe("braintree/graphql-transaction", () => {
    const ep = endpointById("braintree/graphql-transaction");

    it("the matcher identifies this endpoint from a GraphQL response", () => {
      expect(bestMatch(BRAINTREE_INPUT, allEndpoints)?.endpoint.id).toBe(ep.id);
    });

    it("transforms with the response structure preserved", () => {
      const { output } = makeEngine().transform(BRAINTREE_INPUT, ep);
      expect(shapeOf(output)).toEqual(shapeOf(BRAINTREE_INPUT));
    });

    it("obfuscates every identifier, including the merchant account id", () => {
      const { output } = makeEngine().transform(BRAINTREE_INPUT, ep);
      const serialized = JSON.stringify(output);
      for (const pii of BRAINTREE_PII) {
        expect(serialized).not.toContain(pii);
      }
    });
  });
});
