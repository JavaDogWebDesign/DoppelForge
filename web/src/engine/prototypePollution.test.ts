import { describe, it, expect, afterEach } from "vitest";
import { parseJson, parseXml, parseForm, parseCsv, parseNdjson } from "./xml";
import { TransformEngine } from "./TransformEngine";
import { GeneratorRegistry } from "./GeneratorRegistry";
import { ConsistencyCache } from "./Cache";
import type { JsonValue } from "./types";

// Every parser builds objects from untrusted input keys. A `__proto__` /
// `constructor` / `prototype` key must never reach Object.prototype. The
// engine strips these while walking; these tests confirm that holds for all
// input formats, end to end (parse + transform), and that nothing leaks onto
// the global prototype along the way.

function makeEngine(): TransformEngine {
  return new TransformEngine(new GeneratorRegistry(7), new ConsistencyCache());
}

function probe(): unknown {
  return ({} as Record<string, unknown>).polluted;
}

afterEach(() => {
  // Defensive: if any test did pollute, don't let it cascade to the others.
  delete (Object.prototype as Record<string, unknown>).polluted;
});

function runThrough(data: JsonValue): void {
  makeEngine().transform(data, null);
}

describe("prototype pollution is neutralized for every input format", () => {
  it("JSON input cannot pollute Object.prototype", () => {
    // JSON.parse makes `__proto__` a harmless own data key, not a real
    // prototype write; the engine then strips it while walking.
    const parsed = parseJson('{"a":1,"__proto__":{"polluted":"yes"}}');
    runThrough(parsed.data);
    expect(probe()).toBeUndefined();
  });

  it("XML input cannot pollute Object.prototype", () => {
    // fast-xml-parser rejects a `__proto__` tag outright with a [SECURITY]
    // error. Whether the parser throws or sanitizes, the invariant is the
    // same: nothing reaches Object.prototype.
    try {
      const parsed = parseXml(
        "<root><safe>ok</safe><__proto__><polluted>yes</polluted></__proto__></root>",
      );
      runThrough(parsed.data);
    } catch {
      /* parser rejected the document — also a valid defense */
    }
    expect(probe()).toBeUndefined();
  });

  it("form-encoded input cannot pollute Object.prototype", () => {
    const parsed = parseForm("__proto__=yes&constructor=yes&safe=ok");
    runThrough(parsed.data);
    expect(probe()).toBeUndefined();
  });

  it("CSV input cannot pollute Object.prototype", () => {
    const parsed = parseCsv("__proto__,constructor,safe\nyes,yes,ok");
    runThrough(parsed.data);
    expect(probe()).toBeUndefined();
  });

  it("NDJSON input cannot pollute Object.prototype", () => {
    const parsed = parseNdjson(
      '{"__proto__":{"polluted":"yes"}}\n{"constructor":{"polluted":"yes"}}',
    );
    runThrough(parsed.data);
    expect(probe()).toBeUndefined();
  });

  it("the transformed output never carries the forbidden keys", () => {
    const parsed = parseJson('{"keep":1,"__proto__":{"x":1},"constructor":{"y":2}}');
    const { output } = makeEngine().transform(parsed.data, null);
    expect(Object.keys(output as object)).toEqual(["keep"]);
  });
});
