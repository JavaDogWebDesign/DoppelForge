import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { ConsistencyCache } from "../src/engine/Cache.ts";
import { GeneratorRegistry } from "../src/engine/GeneratorRegistry.ts";
import { TransformEngine } from "../src/engine/TransformEngine.ts";
import { bestMatch } from "../src/engine/Matcher.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const providersDir = resolve(__dirname, "../../providers/bigcommerce/endpoints");

function loadSpec(slug) {
  const raw = readFileSync(resolve(providersDir, `${slug}.yaml`), "utf8");
  const parsed = yaml.load(raw);
  return {
    id: `bigcommerce/${slug}`,
    providerId: "bigcommerce",
    endpoint: parsed.endpoint,
    signature: parsed.signature ?? { required_paths: [] },
    fields: parsed.fields ?? {},
  };
}

const specs = [
  loadSpec("v2-orders-detail"),
  loadSpec("v2-orders-transactions"),
  loadSpec("v3-customers"),
  loadSpec("v3-customers-subscribers"),
];

const input = {
  data: [
    {
      id: 1155115748,
      order_id: "6676112",
      event: "purchase",
      method: "credit_card",
      amount: 110.71,
      currency: "USD",
      gateway: "orbital",
      gateway_transaction_id: "696FE8633411EAA500000C1300009B0E525054B5;6676112",
      payment_method_id: "orbital.card",
      status: "ok",
      test: false,
      fraud_review: false,
      reference_transaction_id: null,
      date_created: "2026-01-20T20:41:08+00:00",
      avs_result: {
        code: "B",
        message: "Zip Match/Zip 4 no Match/Locale match",
        street_match: "Y",
        postal_match: "Y",
      },
      cvv_result: { code: "M", message: "Match" },
      credit_card: {
        card_type: "master",
        card_iin: "520578",
        card_last4: "3767",
        card_expiry_month: 2,
        card_expiry_year: 2027,
      },
      gift_certificate: null,
      store_credit: null,
      offline: null,
      custom: null,
      payment_instrument_token: null,
      custom_provider_field_result: null,
    },
    {
      id: 1158317771,
      order_id: "6676112",
      event: "refund",
      method: "offline",
      amount: 110.71,
      currency: "USD",
      gateway: "orbital",
      gateway_transaction_id: "697841D12485B69900002F3A00012F73525054ED;6676112",
      payment_method_id: "orbital.card",
      status: "ok",
      test: false,
      fraud_review: false,
      reference_transaction_id: null,
      date_created: "2026-01-27T04:40:50+00:00",
      avs_result: { code: "3", message: "AVS not performed", street_match: "", postal_match: "" },
      cvv_result: { code: "", message: "Not applicable" },
      credit_card: null,
      gift_certificate: null,
      store_credit: null,
      offline: null,
      custom: null,
      payment_instrument_token: null,
      custom_provider_field_result: null,
    },
  ],
  meta: {
    pagination: {
      total: 2,
      count: 2,
      per_page: 50,
      current_page: 1,
      total_pages: 1,
      links: { current: "?page=1&limit=50" },
    },
  },
};

const match = bestMatch(input, specs);
console.log("Match:", match ? `${match.endpoint.id} (score=${match.score.toFixed(2)})` : "NONE");

const engine = new TransformEngine(new GeneratorRegistry(), new ConsistencyCache());
const result = engine.transform(input, match?.endpoint ?? null);
console.log("Stats:", JSON.stringify(result.stats));
console.log("\n--- Output ---\n");
console.log(JSON.stringify(result.output, null, 2));

function assert(cond, msg) {
  if (!cond) {
    console.error("\nFAIL:", msg);
    process.exit(1);
  }
}

const out0 = result.output.data[0];
const out1 = result.output.data[1];

assert(out0.id !== 1155115748, "id was obfuscated");
assert(String(out0.id).length === 10, `id preserved 10-digit length (got ${out0.id})`);
assert(out0.order_id !== "6676112", "order_id was obfuscated");
assert(/^\d+$/.test(out0.order_id), `order_id stayed numeric-string (got "${out0.order_id}")`);
assert(out0.order_id.length === 7, `order_id preserved 7-char length (got "${out0.order_id}")`);
assert(out0.order_id === out1.order_id, "same order_id maps to same fake (anchor consistency)");
assert(out0.gateway_transaction_id !== "696FE8633411EAA500000C1300009B0E525054B5;6676112", "gateway_transaction_id was obfuscated");
assert(out0.gateway_transaction_id.includes(";"), "gateway_transaction_id preserved ; separator");
assert(out0.gateway === "orbital", "gateway preserved");
assert(out0.event === "purchase", "event preserved");
assert(out0.amount === 110.71, "amount preserved");
assert(/^\d{6}$/.test(out0.credit_card.card_iin), `card_iin is 6 digits (got "${out0.credit_card.card_iin}")`);
assert(out0.credit_card.card_iin !== "520578", "card_iin was obfuscated");
assert(/^\d{4}$/.test(out0.credit_card.card_last4), `card_last4 is 4 digits (got "${out0.credit_card.card_last4}")`);
assert(out0.credit_card.card_last4 !== "3767", "card_last4 was obfuscated");
assert(out0.credit_card.card_type === "master", "card_type preserved");
assert(out0.avs_result.message === "Zip Match/Zip 4 no Match/Locale match", "avs message preserved");
assert(result.output.meta.pagination.total === 2, "pagination preserved");

console.log("\n✓ all invariants pass");
