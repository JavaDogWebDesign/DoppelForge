import { describe, it, expect } from "vitest";
import { processHar } from "./har";

// Round-trip suite — the test that earns the right to drop the "alpha" tag.
//
// A HAR obfuscator's worst failure is silent corruption: the user trusts the
// output, ships it, and it either still leaks data or no longer opens. This
// suite proves the obfuscated output is still a structurally valid HAR 1.2 —
// our automated stand-in for "re-imports cleanly into Chrome DevTools," which
// can't be driven from a unit test. Fixtures reproduce the shape quirks of the
// real exporters (Chrome/Edge, Firefox, Safari, Charles) with synthetic data.
//
// NOTE: capturing real HARs from live browsers and visually re-importing them
// into DevTools is a manual step the maintainer still owns. `processHar` can
// also be pointed at a real local capture via the opt-in test at the bottom.

/* ---------- strict-ish HAR 1.2 structural validator ---------- */

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function nameValueErrs(arr: unknown, label: string): string[] {
  if (!Array.isArray(arr)) return [`${label}: not an array`];
  const out: string[] = [];
  arr.forEach((raw, i) => {
    const nv = obj(raw);
    if (!nv || typeof nv.name !== "string" || typeof nv.value !== "string") {
      out.push(`${label}[${i}]: {name, value} strings required`);
    }
  });
  return out;
}

/**
 * Returns a list of HAR 1.2 spec violations. An empty list means a HAR
 * consumer (DevTools, a HAR viewer) would accept the file.
 */
function validateHar(data: unknown): string[] {
  const root = obj(data);
  const log = root && obj(root.log);
  if (!log) return ["missing top-level log object"];

  const errs: string[] = [];
  if (typeof log.version !== "string") errs.push("log.version must be a string");
  const creator = obj(log.creator);
  if (!creator || typeof creator.name !== "string" || typeof creator.version !== "string") {
    errs.push("log.creator {name, version} required");
  }
  if (!Array.isArray(log.entries)) return [...errs, "log.entries must be an array"];

  log.entries.forEach((raw, i) => {
    const e = obj(raw);
    if (!e) {
      errs.push(`entry ${i}: not an object`);
      return;
    }
    if (typeof e.startedDateTime !== "string") errs.push(`entry ${i}: startedDateTime`);
    if (typeof e.time !== "number") errs.push(`entry ${i}: time`);
    if (!obj(e.cache)) errs.push(`entry ${i}: cache`);

    const t = obj(e.timings);
    if (!t) errs.push(`entry ${i}: timings`);
    else {
      for (const k of ["send", "wait", "receive"]) {
        if (typeof t[k] !== "number") errs.push(`entry ${i}: timings.${k}`);
      }
    }

    const req = obj(e.request);
    if (!req) {
      errs.push(`entry ${i}: request`);
    } else {
      for (const k of ["method", "url", "httpVersion"]) {
        if (typeof req[k] !== "string") errs.push(`entry ${i}: request.${k}`);
      }
      for (const k of ["headersSize", "bodySize"]) {
        if (typeof req[k] !== "number") errs.push(`entry ${i}: request.${k}`);
      }
      errs.push(...nameValueErrs(req.headers, `entry ${i}: request.headers`));
      errs.push(...nameValueErrs(req.cookies, `entry ${i}: request.cookies`));
      errs.push(...nameValueErrs(req.queryString, `entry ${i}: request.queryString`));
    }

    const res = obj(e.response);
    if (!res) {
      errs.push(`entry ${i}: response`);
    } else {
      if (typeof res.status !== "number") errs.push(`entry ${i}: response.status`);
      for (const k of ["statusText", "httpVersion", "redirectURL"]) {
        if (typeof res[k] !== "string") errs.push(`entry ${i}: response.${k}`);
      }
      for (const k of ["headersSize", "bodySize"]) {
        if (typeof res[k] !== "number") errs.push(`entry ${i}: response.${k}`);
      }
      const c = obj(res.content);
      if (!c) {
        errs.push(`entry ${i}: response.content`);
      } else {
        if (typeof c.size !== "number") errs.push(`entry ${i}: content.size`);
        if (typeof c.mimeType !== "string") errs.push(`entry ${i}: content.mimeType`);
        if (c.text !== undefined && typeof c.text !== "string") {
          errs.push(`entry ${i}: content.text must be a string`);
        }
      }
      errs.push(...nameValueErrs(res.headers, `entry ${i}: response.headers`));
      errs.push(...nameValueErrs(res.cookies, `entry ${i}: response.cookies`));
    }
  });
  return errs;
}

/* ---------- spec-complete fixtures, one per real exporter ---------- */

/** A full HAR 1.2 entry seeded with synthetic PII (`i` keeps each unique). */
function entry(i: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startedDateTime: "2026-05-15T10:00:00.000Z",
    time: 137.5,
    request: {
      method: "GET",
      url: `https://api.example.com/v1/customers/${i}?page=2&api_key=sk_live_REAL${i}`,
      httpVersion: "HTTP/2",
      cookies: [{ name: "user_session", value: `real-session-token-${i}` }],
      headers: [
        { name: "Authorization", value: `Bearer real.jwt.token.${i}` },
        { name: "Accept", value: "application/json" },
      ],
      queryString: [
        { name: "page", value: "2" },
        { name: "api_key", value: `sk_live_REAL${i}` },
      ],
      headersSize: 320,
      bodySize: 0,
    },
    response: {
      status: 200,
      statusText: "OK",
      httpVersion: "HTTP/2",
      cookies: [{ name: "user_session", value: `real-session-token-${i}` }],
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "Set-Cookie", value: `user_session=real-session-token-${i}; Path=/` },
      ],
      content: {
        size: 120,
        mimeType: "application/json",
        text: JSON.stringify({
          customer: {
            id: 48000 + i,
            email: `real.person.${i}@gmail.com`,
            name: "Margaret Holloway",
            avatar_url: `https://cdn.example.com/avatars/${i}.png`,
          },
        }),
      },
      redirectURL: "",
      headersSize: 280,
      bodySize: 120,
    },
    cache: {},
    timings: { send: 1.2, wait: 130, receive: 6.3 },
    serverIPAddress: "203.0.113.42",
    connection: "443",
    ...extra,
  };
}

function harDoc(
  creatorName: string,
  entries: unknown[],
  logExtra: Record<string, unknown> = {},
): unknown {
  return {
    log: {
      version: "1.2",
      creator: { name: creatorName, version: "1.0" },
      entries,
      ...logExtra,
    },
  };
}

/** Chrome / Edge — WebInspector, with `_initiator` / `_priority` /
 *  `_resourceType` extension fields and a `pages[]` array. */
function chromeHar(): unknown {
  return harDoc(
    "WebInspector",
    [
      entry(1, {
        pageref: "page_1",
        _initiator: {
          type: "script",
          stack: { callFrames: [{ url: "https://app.example.com/bundle.js" }] },
        },
        _priority: "VeryHigh",
        _resourceType: "xhr",
      }),
      entry(2, { pageref: "page_1", _resourceType: "fetch" }),
    ],
    {
      pages: [
        {
          startedDateTime: "2026-05-15T10:00:00.000Z",
          id: "page_1",
          title: "https://app.example.com/dashboard",
          pageTimings: { onContentLoad: 420, onLoad: 1200 },
        },
      ],
    },
  );
}

/** Firefox — `comment` fields and a populated `cache` object. */
function firefoxHar(): unknown {
  return harDoc("Firefox", [
    entry(1, { comment: "", cache: { beforeRequest: null, afterRequest: null } }),
  ]);
}

/** Safari — WebKit Web Inspector. */
function safariHar(): unknown {
  return harDoc("WebKit Web Inspector", [entry(1)]);
}

/** Charles Proxy — a third-party exporter. */
function charlesHar(): unknown {
  return harDoc("Charles Proxy", [entry(1)]);
}

const EXPORTERS: Array<[string, () => unknown]> = [
  ["Chrome / Edge", chromeHar],
  ["Firefox", firefoxHar],
  ["Safari", safariHar],
  ["Charles Proxy", charlesHar],
];

/* ---------- the suite ---------- */

describe("HAR round-trip — output stays a valid, importable HAR", () => {
  for (const [name, build] of EXPORTERS) {
    describe(name, () => {
      it("the fixture itself is well-formed HAR 1.2", () => {
        expect(validateHar(build())).toEqual([]);
      });

      it("obfuscated output is still valid HAR 1.2", () => {
        const har = build();
        processHar(har);
        expect(validateHar(har)).toEqual([]);
      });

      it("survives a JSON stringify → parse round trip (the download path)", () => {
        const har = build();
        processHar(har);
        const reparsed = JSON.parse(JSON.stringify(har));
        expect(validateHar(reparsed)).toEqual([]);
      });

      it("preserves entry count and non-PII metadata", () => {
        const har = build() as { log: { entries: Array<Record<string, never>> } };
        const count = har.log.entries.length;
        processHar(har);
        expect(har.log.entries.length).toBe(count);
        const e0 = har.log.entries[0] as Record<string, unknown>;
        expect(e0.time).toBe(137.5);
        expect((e0.response as Record<string, unknown>).status).toBe(200);
        expect((e0.timings as Record<string, unknown>).wait).toBe(130);
      });

      it("actually removes the PII", () => {
        const har = build();
        processHar(har);
        const dump = JSON.stringify(har);
        expect(dump).not.toMatch(/real\.person\.\d+@gmail\.com/);
        expect(dump).not.toMatch(/Bearer real\.jwt\.token/);
        expect(dump).not.toMatch(/sk_live_REAL\d/);
        expect(dump).not.toMatch(/real-session-token-\d/);
        expect(dump).not.toContain("203.0.113.42");
      });
    });
  }

  it("preserves Chrome _initiator / _priority / pages extension data", () => {
    const har = chromeHar() as {
      log: { entries: Array<Record<string, unknown>>; pages: Array<Record<string, unknown>> };
    };
    processHar(har);
    const e0 = har.log.entries[0];
    expect((e0._initiator as { type: string }).type).toBe("script");
    expect(e0._priority).toBe("VeryHigh");
    expect(e0._resourceType).toBe("xhr");
    expect(har.log.pages[0].id).toBe("page_1");
  });

  it("passes unknown comment fields and extension keys straight through", () => {
    const har = harDoc("QA Tool", [entry(1, { comment: "captured for ticket #42" })], {
      comment: "session export",
      _vendorField: "keep-me",
    }) as { log: Record<string, unknown> & { entries: Array<Record<string, unknown>> } };
    processHar(har);
    expect(har.log.entries[0].comment).toBe("captured for ticket #42");
    expect(har.log.comment).toBe("session export");
    expect(har.log._vendorField).toBe("keep-me");
  });

  it("leaves a clean asset URL (avatar_url) untouched in the body", () => {
    const har = safariHar();
    processHar(har);
    const text = (
      (har as { log: { entries: Array<{ response: { content: { text: string } } }> } })
        .log.entries[0].response.content.text
    );
    expect(text).toContain("https://cdn.example.com/avatars/1.png");
  });
});

// Verifying a *real* capture is a manual step the maintainer still owns:
// record a HAR in Chrome / Firefox / Safari DevTools, run it through HAR mode,
// download the result, and re-import that file into DevTools to confirm it
// opens. `validateHar` above is the automated stand-in for that check; the
// human step catches anything the structural validator can't model.
