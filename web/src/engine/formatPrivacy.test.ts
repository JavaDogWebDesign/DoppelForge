import { describe, it, expect } from "vitest";
import { parseInput, serialize } from "./xml";
import { TransformEngine } from "./TransformEngine";
import { GeneratorRegistry } from "./GeneratorRegistry";
import { ConsistencyCache } from "./Cache";

// The privacy invariant ("no original value survives") is checked elsewhere
// for JSON and XML. The engine ALSO accepts form-encoded, base64-wrapped,
// CSV, and NDJSON input — and the parse -> transform -> serialize path for
// each of those is its own chance to leak. These tests close that gap: every
// format, full round-trip, no planted PII survives.

function makeEngine(): TransformEngine {
  return new TransformEngine(new GeneratorRegistry(424242), new ConsistencyCache());
}

// PII chosen so the generic detector recognizes it by value pattern (email,
// uuid, ipv4) or key name — independent of which provider map, if any.
const EMAIL_A = "marlowe.fairwind@example.test";
const EMAIL_B = "delphine.ashgrove@example.test";
const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const UUID_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const IP = "198.51.100.23";

const formBody =
  `customer_email=${EMAIL_A}&first_name=Marlowe&ip_address=${IP}&reference=${UUID_A}`;

const braintreeXml =
  `<callback><field_a>${EMAIL_A}</field_a>` +
  `<field_b>${UUID_A}</field_b><field_c>${IP}</field_c></callback>`;
const base64Body = btoa(braintreeXml);

const csvBody =
  `email,reference,note\n` +
  `${EMAIL_A},${UUID_A},follow up\n` +
  `${EMAIL_B},${UUID_B},priority`;

const ndjsonBody =
  `{"email":"${EMAIL_A}","trace_id":"${UUID_A}"}\n` +
  `{"email":"${EMAIL_B}","trace_id":"${UUID_B}"}`;

const cases: Array<{ name: string; input: string; pii: string[] }> = [
  { name: "form-encoded (Twilio-style)", input: formBody, pii: [EMAIL_A, "Marlowe", IP, UUID_A] },
  { name: "base64-wrapped XML (Braintree-style)", input: base64Body, pii: [EMAIL_A, UUID_A, IP] },
  { name: "CSV", input: csvBody, pii: [EMAIL_A, EMAIL_B, UUID_A, UUID_B] },
  { name: "NDJSON", input: ndjsonBody, pii: [EMAIL_A, EMAIL_B, UUID_A, UUID_B] },
];

describe("privacy invariant holds for every supported input format", () => {
  for (const c of cases) {
    describe(c.name, () => {
      const parsed = parseInput(c.input);
      const { output } = makeEngine().transform(parsed.data, null);

      it("no planted PII survives in the transformed data", () => {
        const serialized = JSON.stringify(output);
        for (const pii of c.pii) {
          expect(serialized).not.toContain(pii);
        }
      });

      it("no planted PII survives a serialize -> re-parse round-trip", () => {
        // Catches a serializer that re-introduces an original value (e.g. by
        // reading from the parsed input instead of the transformed output).
        const reparsed = parseInput(serialize(output, parsed));
        const serialized = JSON.stringify(reparsed.data);
        for (const pii of c.pii) {
          expect(serialized).not.toContain(pii);
        }
      });
    });
  }
});
