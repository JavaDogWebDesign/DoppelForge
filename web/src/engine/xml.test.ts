import { describe, it, expect } from "vitest";
import { parseXml, serialize, detectFormat } from "./xml";
import { TransformEngine } from "./TransformEngine";
import { GeneratorRegistry } from "./GeneratorRegistry";
import { ConsistencyCache } from "./Cache";
import type { EndpointSpec, JsonValue } from "./types";

// The engine accepts XML as well as JSON, but every other test exercises the
// JSON path. These cover the XML pipeline: detect → parse → (transform) →
// serialize, and the round-trip invariant that the data tree survives intact.

function makeEngine(seed: number): TransformEngine {
  return new TransformEngine(new GeneratorRegistry(seed), new ConsistencyCache());
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

const NOTIFICATION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<notification version="6">
  <kind>subscription_charged_successfully</kind>
  <timestamp>2024-03-11T14:22:08Z</timestamp>
  <subject>
    <transaction>
      <id>7h9k2p</id>
      <amount>49.99</amount>
      <customer>
        <first-name>Eleanor</first-name>
        <last-name>Pemberton</last-name>
        <email>eleanor.pemberton@example.com</email>
      </customer>
      <billing>
        <street-address>88 Rosewood Lane</street-address>
        <locality>Asheville</locality>
      </billing>
      <line-items>
        <line-item><name>Annual Subscription Plan</name></line-item>
        <line-item><name>Priority Support Addon</name></line-item>
      </line-items>
    </transaction>
  </subject>
</notification>`;

describe("detectFormat", () => {
  it("identifies XML by its leading angle bracket", () => {
    expect(detectFormat("<root/>")).toBe("xml");
    expect(detectFormat("  \n<?xml version=\"1.0\"?><a><b/></a>")).toBe("xml");
  });
});

describe("parseXml", () => {
  it("extracts the single root element and its tree", () => {
    const parsed = parseXml(NOTIFICATION_XML);
    expect(parsed.format).toBe("xml");
    expect(parsed.rootName).toBe("notification");
    const data = parsed.data as Record<string, JsonValue>;
    expect(data.kind).toBe("subscription_charged_successfully");
  });

  it("surfaces element attributes with the @_ prefix", () => {
    const data = parseXml(NOTIFICATION_XML).data as Record<string, JsonValue>;
    expect(data["@_version"]).toBe("6");
  });

  it("throws when the document has multiple root elements", () => {
    expect(() => parseXml("<a/><b/>")).toThrow(/single root element/);
  });
});

describe("XML round-trip (parse -> serialize -> parse)", () => {
  it("preserves a nested element tree", () => {
    const before = parseXml(NOTIFICATION_XML);
    const after = parseXml(serialize(before.data, before));
    expect(after.data).toEqual(before.data);
    expect(after.rootName).toBe(before.rootName);
  });

  it("preserves repeated tags as a stable array", () => {
    const before = parseXml("<list><item>a</item><item>b</item><item>c</item></list>");
    expect((before.data as { item: JsonValue }).item).toEqual(["a", "b", "c"]);
    const after = parseXml(serialize(before.data, before));
    expect(after.data).toEqual(before.data);
  });

  it("preserves element attributes", () => {
    const before = parseXml(NOTIFICATION_XML);
    const after = parseXml(serialize(before.data, before));
    expect((after.data as Record<string, JsonValue>)["@_version"]).toBe("6");
  });

  it("preserves values containing XML entities", () => {
    const before = parseXml("<root><note>Tom &amp; Jerry &lt;draft&gt;</note></root>");
    expect((before.data as { note: string }).note).toBe("Tom & Jerry <draft>");
    const after = parseXml(serialize(before.data, before));
    expect(after.data).toEqual(before.data);
  });

  it("emits an XML declaration header", () => {
    const before = parseXml(NOTIFICATION_XML);
    expect(serialize(before.data, before)).toMatch(/^<\?xml version="1\.0"\?>/);
  });
});

describe("XML through the transform engine", () => {
  const endpoint: EndpointSpec = {
    id: "braintree-notification",
    providerId: "braintree",
    endpoint: { method: "POST", path: "/notification", kind: "webhook" },
    signature: { required_paths: [] },
    fields: {
      kind: { type: "preserve" },
      "subject.transaction.id": { type: "id" },
      "subject.transaction.amount": { type: "priceAmount" },
      "subject.transaction.customer.first-name": { type: "firstName" },
      "subject.transaction.customer.last-name": { type: "lastName" },
      "subject.transaction.customer.email": { type: "email" },
      "subject.transaction.billing.street-address": { type: "street" },
      "subject.transaction.billing.locality": { type: "city" },
      "subject.transaction.line-items.line-item[].name": { type: "productName" },
    },
  };

  it("obfuscates an XML-derived tree and serializes back to same-shaped, valid XML", () => {
    const before = parseXml(NOTIFICATION_XML);
    const { output } = makeEngine(77).transform(before.data, endpoint);
    const xml = serialize(output, before);
    // Re-parsing proves the output is still well-formed XML, and the shape
    // check proves obfuscation didn't add, drop, or restructure any element.
    const reparsed = parseXml(xml);
    expect(shapeOf(reparsed.data)).toEqual(shapeOf(before.data));
  });

  it("removes planted PII from the serialized XML", () => {
    const before = parseXml(NOTIFICATION_XML);
    const { output } = makeEngine(77).transform(before.data, endpoint);
    const xml = serialize(output, before);
    for (const pii of [
      "Eleanor",
      "Pemberton",
      "eleanor.pemberton@example.com",
      "88 Rosewood Lane",
      "Asheville",
      "Annual Subscription Plan",
      "Priority Support Addon",
    ]) {
      expect(xml).not.toContain(pii);
    }
  });

  it("keeps a field mapped `preserve` untouched in the XML output", () => {
    const before = parseXml(NOTIFICATION_XML);
    const { output } = makeEngine(77).transform(before.data, endpoint);
    const xml = serialize(output, before);
    expect(xml).toContain("subscription_charged_successfully");
  });
});
