// Standalone runtime smoke test for the engine.
// Run with: node --experimental-strip-types scripts/smoke.mjs
// (or via tsx if installed). Validates XML round-trip + obfuscation
// of the BigCommerce v2 order detail endpoint.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
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

const xmlInput = `<?xml version="1.0"?>
<order>
    <id>62652221</id>
    <customer_id>5523951</customer_id>
    <date_created>Thu, 03 Jul 2025 09:42:12 +0000</date_created>
    <status_id>0</status_id>
    <status>Incomplete</status>
    <ip_address>130.176.96.137</ip_address>
    <geoip_country>United Kingdom</geoip_country>
    <geoip_country_iso2>GB</geoip_country_iso2>
    <cart_id>0aa7f02e-4e76-4447-9918-4334a568ec00</cart_id>
    <payment_provider_id>686650791A01674E0000082A00001C8A52505334</payment_provider_id>
    <billing_address>
        <first_name>Annette</first_name>
        <last_name>Neal</last_name>
        <street_1>7124 E Sandy Lake Rd</street_1>
        <city>Port St. Lucie</city>
        <state>Arizona</state>
        <zip>11147</zip>
        <country>United States</country>
        <country_iso2>US</country_iso2>
        <phone>(267) 668-8720</phone>
        <email>mmoxuriiv2ug3ylnzzab@yahoo.com</email>
    </billing_address>
    <fees>
        <link rel="resource" href="https://api.bigcommerce.com/stores/yneuaokjib/v2/orders/62652221/fees">/orders/62652221/fees</link>
    </fees>
</order>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  indentBy: "    ",
});

const rootObj = parser.parse(xmlInput);
const rootName = Object.keys(rootObj).filter((k) => !k.startsWith("?"))[0];
const data = rootObj[rootName];

const spec = loadSpec("v2-orders-detail");
const match = bestMatch(data, [spec]);
console.log("Match:", match ? `${match.endpoint.id} (score=${match.score.toFixed(2)})` : "NONE");

const engine = new TransformEngine(new GeneratorRegistry(), new ConsistencyCache());
const result = engine.transform(data, match?.endpoint ?? null);
console.log("Stats:", JSON.stringify(result.stats));

const out = builder.build({ [rootName]: result.output });
console.log("\n--- Output XML ---\n");
console.log(out);

// Invariants
const original = data;
const transformed = result.output;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}
assert(typeof transformed === "object" && transformed, "output is an object");
assert(
  transformed.billing_address.email !== original.billing_address.email,
  "email was obfuscated",
);
assert(
  /@/.test(transformed.billing_address.email),
  "email is still email-shaped",
);
assert(
  transformed.billing_address.first_name !== "Annette",
  "first_name was obfuscated",
);
assert(
  transformed.status === "Incomplete",
  "status enum preserved",
);
assert(
  transformed.geoip_country_iso2.length === 2,
  "country code shape preserved",
);
assert(
  transformed.cart_id !== original.cart_id,
  "cart_id was obfuscated",
);
assert(
  /^[0-9a-f-]{36}$/i.test(transformed.cart_id),
  "cart_id is still UUID-shaped",
);
console.log("\n✓ all invariants pass");
