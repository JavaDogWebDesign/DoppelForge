import { describe, it, expect } from "vitest";
import { loadProviders } from "./loader";
import { TransformEngine } from "../engine/TransformEngine";
import { GeneratorRegistry } from "../engine/GeneratorRegistry";
import { ConsistencyCache } from "../engine/Cache";
import { bestMatch } from "../engine/Matcher";
import type { EndpointSpec, JsonValue } from "../engine/types";

// Synthesized golden tests. Rather than hand-author 220 sample responses, the
// input for each endpoint is derived from its own YAML — every declared path
// gets a planted value. This catches: unloadable / malformed YAML, a typo'd
// semantic type (the generator silently no-ops), a field that doesn't
// transform, a signature whose paths can't be satisfied, and matcher/engine
// wiring regressions. It does NOT verify the field map is *correct* for the
// real provider — that needs real sample responses (a later layer).

function makeEngine(): TransformEngine {
  return new TransformEngine(new GeneratorRegistry(20260515), new ConsistencyCache());
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

let plantCounter = 0;
// A value whose JS type matches what the field's generator expects, so the
// output type is stable. Plain strings are high-entropy and unique so a
// generator can never coincidentally reproduce one.
function plantValue(type: string | undefined): JsonValue {
  if (type === "boolean") return true;
  if (type === "priceAmount") return 4242.42;
  if (type === "null") return null;
  plantCounter += 1;
  // A nestedJson field must hold a parseable JSON document with something
  // obfuscatable inside, so the engine's recursive walk actually changes it.
  if (type === "nestedJson") return `{"name":"GOLDENVALUE${plantCounter}Zqx"}`;
  return `GOLDENVALUE${plantCounter}Zqx`;
}

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Writes `value` at a normalized path (dotted, with `[]` for array segments),
// creating containers as needed. Never clobbers an already-built container.
function setPath(root: Record<string, JsonValue>, path: string, value: JsonValue): void {
  const segs = path.split(".");
  let cur: Record<string, JsonValue> = root;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const isArr = seg.endsWith("[]");
    const name = isArr ? seg.slice(0, -2) : seg;
    const last = i === segs.length - 1;
    if (last) {
      if (isArr) {
        if (!Array.isArray(cur[name])) cur[name] = [value];
      } else if (!isPlainObject(cur[name]) && !Array.isArray(cur[name])) {
        cur[name] = value;
      }
      return;
    }
    if (isArr) {
      if (!Array.isArray(cur[name])) cur[name] = [{}];
      const arr = cur[name] as JsonValue[];
      if (!isPlainObject(arr[0])) arr[0] = {};
      cur = arr[0] as Record<string, JsonValue>;
    } else {
      if (!isPlainObject(cur[name])) cur[name] = {};
      cur = cur[name] as Record<string, JsonValue>;
    }
  }
}

function synthesizeInput(ep: EndpointSpec): JsonValue {
  const root: Record<string, JsonValue> = {};
  const fieldPaths = Object.keys(ep.fields).filter((k) => k !== "*");
  const allPaths = new Set<string>([
    ...fieldPaths,
    ...ep.signature.required_paths,
    ...(ep.signature.optional_paths ?? []),
  ]);
  // Shortest paths first so a leaf set on a prefix is coerced to a container
  // when a deeper path needs to descend through it.
  const ordered = [...allPaths].sort(
    (a, b) => a.split(".").length - b.split(".").length,
  );
  for (const path of ordered) {
    setPath(root, path, plantValue(ep.fields[path]?.type));
  }
  return root;
}

const providers = loadProviders();
const totalEndpoints = providers.reduce((n, p) => n + p.endpoints.length, 0);

describe("provider library loads", () => {
  it("loads a substantial set of providers and endpoints", () => {
    expect(providers.length).toBeGreaterThanOrEqual(10);
    expect(totalEndpoints).toBeGreaterThanOrEqual(150);
  });
});

describe("provider golden tests (synthesized inputs)", () => {
  for (const provider of providers) {
    describe(provider.manifest.name, () => {
      for (const ep of provider.endpoints) {
        it(ep.id, () => {
          const input = synthesizeInput(ep);

          // 1. Transform runs without throwing.
          const result = makeEngine().transform(input, ep);
          const { output, fields } = result;

          // 2. The endpoint actually mapped something.
          expect(fields.length).toBeGreaterThan(0);

          // 3. Structure is preserved exactly.
          expect(shapeOf(output)).toEqual(shapeOf(input));

          // 4. The synthesized input satisfies the endpoint's own signature.
          if (ep.signature.required_paths.length > 0) {
            const match = bestMatch(input, [ep]);
            expect(match?.endpoint.id).toBe(ep.id);
          }

          // 5. Every mapped field behaves per its semantic type: `preserve`
          //    keeps the value, `null` nulls it, everything else changes it.
          //    A typo'd type silently no-ops and fails the `else` branch.
          for (const f of fields) {
            if (f.effectiveType === "preserve") {
              expect(f.sampleFake).toEqual(f.sampleOriginal);
            } else if (f.effectiveType === "custom") {
              continue;
            } else if (f.effectiveType === "null") {
              expect(f.sampleFake).toBeNull();
            } else {
              expect(f.sampleFake).not.toEqual(f.sampleOriginal);
            }
          }
        });
      }
    });
  }
});
