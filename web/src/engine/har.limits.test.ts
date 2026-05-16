import { describe, it, expect } from "vitest";
import { processHar } from "./har";
import {
  checkHarGate,
  HAR_GATE_SILENT,
  HAR_GATE_MAX,
  HAR_GATE_MOBILE,
} from "./harConstants";

// Memory / size-limit suite.
//
// The point: prove the size gates fail *cleanly* — refuse before processing,
// or surface an error — rather than ever producing a corrupt, half-redacted
// download. A real 250MB+ OOM can't be triggered in a unit test, so this
// covers the two things that can: the gate decision (a pure function), and the
// all-or-nothing guarantee of `processHar` at a genuinely non-trivial size.

const FILLER = "x".repeat(1800);

function makeEntry(i: number): Record<string, unknown> {
  return {
    startedDateTime: "2026-05-15T10:00:00.000Z",
    time: 100,
    request: {
      method: "GET",
      url: `https://api.example.com/r/${i}`,
      httpVersion: "HTTP/2",
      cookies: [],
      headers: [{ name: "Authorization", value: `Bearer tok-${i}` }],
      queryString: [],
      headersSize: 120,
      bodySize: 0,
    },
    response: {
      status: 200,
      statusText: "OK",
      httpVersion: "HTTP/2",
      cookies: [],
      headers: [{ name: "Content-Type", value: "application/json" }],
      content: {
        size: 0,
        mimeType: "application/json",
        text: JSON.stringify({ id: i, email: `user${i}@example.com`, note: FILLER }),
      },
      redirectURL: "",
      headersSize: 90,
      bodySize: 0,
    },
    cache: {},
    timings: { send: 1, wait: 90, receive: 9 },
  };
}

/** Build a HAR whose JSON serialization is at least `targetBytes` big. */
function makeHarOfSize(targetBytes: number): { har: unknown; bytes: number } {
  const perEntry = JSON.stringify(makeEntry(0)).length + 1;
  const count = Math.max(1, Math.ceil(targetBytes / perEntry));
  const entries: unknown[] = [];
  for (let i = 0; i < count; i++) entries.push(makeEntry(i));
  const har = {
    log: { version: "1.2", creator: { name: "test", version: "1" }, entries },
  };
  return { har, bytes: JSON.stringify(har).length };
}

describe("HAR size gates", () => {
  it("passes files at or under the silent threshold", () => {
    expect(checkHarGate(1, false).kind).toBe("ok");
    expect(checkHarGate(HAR_GATE_SILENT, false).kind).toBe("ok");
  });

  it("warns between the silent threshold and the hard ceiling", () => {
    expect(checkHarGate(HAR_GATE_SILENT + 1, false).kind).toBe("warn");
    expect(checkHarGate(HAR_GATE_MAX, false).kind).toBe("warn");
  });

  it("refuses above the hard ceiling, with an explanatory message", () => {
    const gate = checkHarGate(HAR_GATE_MAX + 1, false);
    expect(gate.kind).toBe("refuse");
    if (gate.kind === "refuse") expect(gate.message.length).toBeGreaterThan(20);
  });

  it("applies the tighter mobile cap", () => {
    // A size that's a desktop warning is a hard refusal on mobile.
    expect(checkHarGate(HAR_GATE_MOBILE + 1, false).kind).toBe("warn");
    expect(checkHarGate(HAR_GATE_MOBILE + 1, true).kind).toBe("refuse");
  });

  it("never silently truncates — refusal is explicit, not a smaller result", () => {
    // The gate returns a refusal the UI must surface; it never returns "ok"
    // for an oversized file.
    for (const size of [HAR_GATE_MAX + 1, 500 * 1024 * 1024, 2 * 1024 * 1024 * 1024]) {
      expect(checkHarGate(size, false).kind).toBe("refuse");
    }
  });
});

describe("HAR processing scales without corrupting output", () => {
  it("processes a multi-megabyte HAR into valid, re-parseable JSON", () => {
    const { har, bytes } = makeHarOfSize(2 * 1024 * 1024);
    expect(bytes).toBeGreaterThan(1.5 * 1024 * 1024);

    const { stats } = processHar(har);
    expect(stats.entries).toBeGreaterThan(100);
    expect(stats.entryErrors).toEqual([]);

    // The downloaded blob is exactly JSON.stringify(har) — it must re-parse.
    const dump = JSON.stringify(har);
    expect(() => JSON.parse(dump)).not.toThrow();
    expect(JSON.parse(dump).log.entries.length).toBe(stats.entries);
  });

  it("is all-or-nothing — a bad input throws, never a partial file", () => {
    // Non-HAR input throws; the worker turns this into an error message and
    // builds no download blob — there is no half-processed output path.
    expect(() => processHar({ not: "a har" })).toThrow(/valid HAR/);

    // A valid HAR yields a complete result with every entry accounted for.
    const { har } = makeHarOfSize(256 * 1024);
    const result = processHar(har);
    expect(result.har).toBeDefined();
    expect(result.stats.entries).toBeGreaterThan(0);
    expect(result.targets.length).toBeGreaterThan(0);
  });

  it("redacts consistently across every entry of a large HAR", () => {
    const { har } = makeHarOfSize(1024 * 1024);
    processHar(har);
    const dump = JSON.stringify(har);
    // No original credential or PII value survives anywhere in the output.
    expect(dump).not.toMatch(/Bearer tok-\d/);
    expect(dump).not.toMatch(/user\d+@example\.com/);
  });
});
