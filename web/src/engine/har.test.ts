import { describe, it, expect } from "vitest";
import {
  processHar,
  isHarLike,
  bodyIsObfuscatable,
  targetId,
  type RedactionTarget,
} from "./har";
import { isSecretHeader, isSecretParam, redactUrl } from "./harRedact";
import { checkHarGate, HAR_GATE_SILENT, HAR_GATE_MAX } from "./harConstants";

// Minimal valid HAR 1.2 fixture builder. Keeps the test corpus tiny — no large
// fixtures committed to the repo; oversized-HAR behavior is exercised via
// checkHarGate, not real files.
function makeHar(entries: unknown[]): unknown {
  return {
    log: {
      version: "1.2",
      creator: { name: "test", version: "1.0" },
      entries,
    },
  };
}

interface NameValue {
  name: string;
  value: string;
}
interface HarEntryView {
  request: {
    url: string;
    headers: NameValue[];
    cookies: NameValue[];
    queryString: NameValue[];
  };
  response: {
    status: number;
    headers: NameValue[];
    cookies: NameValue[];
    content: { text: string; mimeType: string };
    redirectURL?: string;
  };
  serverIPAddress?: string;
  time?: number;
}
function entriesOf(har: unknown): HarEntryView[] {
  return (har as { log: { entries: HarEntryView[] } }).log.entries;
}

function jsonEntry(opts: {
  url?: string;
  reqHeaders?: NameValue[];
  reqCookies?: NameValue[];
  query?: NameValue[];
  respHeaders?: NameValue[];
  respBody?: string;
  respMime?: string;
  respEncoding?: string;
  respRedirect?: string;
  serverIP?: string;
}): unknown {
  return {
    request: {
      method: "GET",
      url: opts.url ?? "https://api.example.com/v1/users",
      headers: opts.reqHeaders ?? [],
      cookies: opts.reqCookies ?? [],
      queryString: opts.query ?? [],
    },
    response: {
      status: 200,
      headers: opts.respHeaders ?? [],
      cookies: [],
      content: {
        mimeType: opts.respMime ?? "application/json",
        ...(opts.respEncoding ? { encoding: opts.respEncoding } : {}),
        ...(opts.respBody !== undefined ? { text: opts.respBody } : {}),
      },
      ...(opts.respRedirect !== undefined ? { redirectURL: opts.respRedirect } : {}),
    },
    ...(opts.serverIP ? { serverIPAddress: opts.serverIP } : {}),
    time: 123,
    timings: { send: 1, wait: 100, receive: 22 },
  };
}

function findTarget(
  targets: RedactionTarget[],
  section: string,
  name: string,
): RedactionTarget | undefined {
  return targets.find((t) => t.section === section && t.name === name);
}

describe("isHarLike", () => {
  it("accepts a well-formed HAR", () => {
    expect(isHarLike(makeHar([]))).toBe(true);
  });
  it("rejects non-HAR shapes", () => {
    expect(isHarLike(null)).toBe(false);
    expect(isHarLike({})).toBe(false);
    expect(isHarLike({ log: {} })).toBe(false);
    expect(isHarLike({ log: { entries: "nope" } })).toBe(false);
    expect(isHarLike([])).toBe(false);
    expect(isHarLike({ user: { email: "a@b.com" } })).toBe(false);
  });
});

describe("bodyIsObfuscatable", () => {
  it("accepts structured text mime types", () => {
    expect(bodyIsObfuscatable("application/json", undefined)).toBe(true);
    expect(bodyIsObfuscatable("application/json; charset=utf-8", undefined)).toBe(true);
    expect(bodyIsObfuscatable("application/vnd.api+json", undefined)).toBe(true);
    expect(bodyIsObfuscatable("text/xml", undefined)).toBe(true);
    expect(bodyIsObfuscatable("application/x-www-form-urlencoded", undefined)).toBe(true);
    expect(bodyIsObfuscatable("text/csv", undefined)).toBe(true);
  });
  it("rejects binary and non-structured bodies", () => {
    expect(bodyIsObfuscatable("image/png", undefined)).toBe(false);
    expect(bodyIsObfuscatable("font/woff2", undefined)).toBe(false);
    expect(bodyIsObfuscatable("text/html", undefined)).toBe(false);
    expect(bodyIsObfuscatable("application/javascript", undefined)).toBe(false);
    expect(bodyIsObfuscatable("text/plain", undefined)).toBe(false);
    expect(bodyIsObfuscatable("", undefined)).toBe(false);
  });
  it("rejects media types even when the subtype carries +xml / +json", () => {
    // image/svg+xml is an image, not an obfuscatable document.
    expect(bodyIsObfuscatable("image/svg+xml", undefined)).toBe(false);
    expect(bodyIsObfuscatable("video/vnd.mpeg.dash.mpd+xml", undefined)).toBe(false);
  });
  it("rejects base64-encoded bodies regardless of mime", () => {
    expect(bodyIsObfuscatable("application/json", "base64")).toBe(false);
    expect(bodyIsObfuscatable("text/xml", "BASE64")).toBe(false);
  });
});

describe("harRedact name rules", () => {
  it("flags credential headers, leaves benign ones", () => {
    expect(isSecretHeader("Authorization")).toBe(true);
    expect(isSecretHeader("cookie")).toBe(true);
    expect(isSecretHeader("Set-Cookie")).toBe(true);
    expect(isSecretHeader("X-Api-Key")).toBe(true);
    expect(isSecretHeader("X-Acme-Auth-Token")).toBe(true);
    expect(isSecretHeader("Content-Type")).toBe(false);
    expect(isSecretHeader("Accept")).toBe(false);
    expect(isSecretHeader("User-Agent")).toBe(false);
  });
  it("flags credential params, leaves benign ones", () => {
    expect(isSecretParam("access_token")).toBe(true);
    expect(isSecretParam("api_key")).toBe(true);
    expect(isSecretParam("signature")).toBe(true);
    expect(isSecretParam("password")).toBe(true);
    expect(isSecretParam("page")).toBe(false);
    expect(isSecretParam("limit")).toBe(false);
    expect(isSecretParam("country_code")).toBe(false);
  });
  it("flags an exact `code` param (OAuth) without sweeping up *_code names", () => {
    expect(isSecretParam("code")).toBe(true);
    expect(isSecretParam("country_code")).toBe(false);
    expect(isSecretParam("zip_code")).toBe(false);
  });
  it("catches camelCase secret param names, not just snake/kebab", () => {
    expect(isSecretParam("connectionToken")).toBe(true);
    expect(isSecretParam("accessToken")).toBe(true);
    expect(isSecretParam("apiKey")).toBe(true);
    expect(isSecretParam("pageSize")).toBe(false);
  });
});

describe("redactUrl", () => {
  // Shape-preserving stand-in for the engine's fake generator.
  const fake = (v: string) => v.replace(/[A-Za-z0-9]/g, "x");

  it("replaces userinfo and secret query params, keeps the rest", () => {
    const out = redactUrl(
      "https://user:pass@api.example.com/v1/orders?page=2&api_key=sk_live_abc123",
      fake,
    );
    const url = new URL(out);
    expect(url.username).not.toBe("user");
    expect(url.password).not.toBe("pass");
    expect(url.searchParams.get("api_key")).not.toBe("sk_live_abc123");
    expect(url.searchParams.get("api_key")).toBe("xx_xxxx_xxxxxx");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.hostname).toBe("api.example.com");
  });
  it("returns non-URL input unchanged", () => {
    expect(redactUrl("not a url", fake)).toBe("not a url");
  });
});

describe("targetId", () => {
  it("folds header names case-insensitively", () => {
    expect(targetId("header", "Accept", "x")).toBe(targetId("header", "accept", "x"));
  });
  it("keeps cookie and param names exact", () => {
    expect(targetId("cookie", "SID", "x")).not.toBe(targetId("cookie", "sid", "x"));
  });
  it("differs per value", () => {
    expect(targetId("header", "Authorization", "a")).not.toBe(
      targetId("header", "Authorization", "b"),
    );
  });
});

describe("processHar — default redaction", () => {
  it("redacts secret headers, preserves benign ones", () => {
    const har = makeHar([
      jsonEntry({
        reqHeaders: [
          { name: "Authorization", value: "Bearer sk_live_secret" },
          { name: "Content-Type", value: "application/json" },
        ],
        respHeaders: [{ name: "Set-Cookie", value: "session=abc; Path=/" }],
      }),
    ]);
    const { stats } = processHar(har);
    const entry = entriesOf(har)[0];
    // Secret headers get a realistic, shape-preserving fake — not the original,
    // not a flat placeholder, and the same length so structure is kept.
    const auth = entry.request.headers[0].value;
    expect(auth).not.toBe("Bearer sk_live_secret");
    expect(auth.length).toBe("Bearer sk_live_secret".length);
    expect(auth).toContain(" "); // separators preserved
    expect(entry.request.headers[1].value).toBe("application/json"); // benign kept
    expect(entry.response.headers[0].value).not.toBe("session=abc; Path=/");
    expect(stats.headersRedacted).toBe(2);
  });

  it("redacts session cookies but leaves benign preference cookies alone", () => {
    const har = makeHar([
      jsonEntry({
        reqCookies: [
          { name: "user_session", value: "a1b2c3d4e5f6g7h8" },
          { name: "color_mode", value: "dark" },
          { name: "logged_in", value: "yes" },
        ],
      }),
    ]);
    const { stats } = processHar(har);
    const cookies = entriesOf(har)[0].request.cookies;
    // Session cookie redacted with a shape-preserving fake.
    expect(cookies[0].value).not.toBe("a1b2c3d4e5f6g7h8");
    expect(cookies[0].value.length).toBe("a1b2c3d4e5f6g7h8".length);
    // Preference cookies left exactly as-is — no `dark` -> `dnwd` noise.
    expect(cookies[1].value).toBe("dark");
    expect(cookies[2].value).toBe("yes");
    expect(stats.cookiesRedacted).toBe(1);
  });

  it("forges the same fake for an identical value seen twice", () => {
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Authorization", value: "Bearer tok-XYZ" }] }),
      jsonEntry({ reqHeaders: [{ name: "Authorization", value: "Bearer tok-XYZ" }] }),
    ]);
    processHar(har);
    const a = entriesOf(har)[0].request.headers[0].value;
    const b = entriesOf(har)[1].request.headers[0].value;
    expect(a).not.toBe("Bearer tok-XYZ");
    expect(a).toBe(b);
  });

  it("redacts secret query params, preserves benign ones", () => {
    const har = makeHar([
      jsonEntry({
        query: [
          { name: "access_token", value: "ya29.real" },
          { name: "page", value: "3" },
        ],
      }),
    ]);
    const { stats } = processHar(har);
    const qs = entriesOf(har)[0].request.queryString;
    expect(qs[0].value).not.toBe("ya29.real");
    expect(qs[1].value).toBe("3");
    expect(stats.paramsRedacted).toBe(1);
  });

  it("redacts a token-shaped param value under a cryptic name, not URLs", () => {
    const har = makeHar([
      jsonEntry({
        query: [
          { name: "k", value: "client-iOZ831TxVwJNrNCWSUAwsQgfvuZ" },
          { name: "loc", value: "https://www.example.com/some/article" },
          { name: "size", value: "1265x1201" },
        ],
      }),
    ]);
    const { stats } = processHar(har);
    const qs = entriesOf(har)[0].request.queryString;
    // Cryptic name, token-shaped value → redacted.
    expect(qs[0].value).not.toBe("client-iOZ831TxVwJNrNCWSUAwsQgfvuZ");
    // A URL value is not a token — left as-is.
    expect(qs[1].value).toBe("https://www.example.com/some/article");
    // Benign short value — left as-is.
    expect(qs[2].value).toBe("1265x1201");
    expect(stats.paramsRedacted).toBe(1);
  });

  it("leaves structured telemetry/config param values alone", () => {
    // Punctuated into short pieces — a token has a long unbroken run, these
    // don't, so they must not be mistaken for secrets.
    const har = makeHar([
      jsonEntry({
        query: [
          { name: "vps", value: "0.000:N,0.012:B,0.146:N,0.615:N" },
          { name: "family", value: "Roboto:wght@300;400;500;700" },
          { name: "fexp", value: "v1,23848211,156433,15321210,11737789" },
        ],
      }),
    ]);
    const { stats } = processHar(har);
    const qs = entriesOf(har)[0].request.queryString;
    expect(qs[0].value).toBe("0.000:N,0.012:B,0.146:N,0.615:N");
    expect(qs[1].value).toBe("Roboto:wght@300;400;500;700");
    expect(qs[2].value).toBe("v1,23848211,156433,15321210,11737789");
    expect(stats.paramsRedacted).toBe(0);
  });

  it("keeps the auth scheme word in an Authorization header, fakes only the credential", () => {
    const real = "Bearer eyJhbGci.cGF5bG9hZA.c2lnbmF0dXJl";
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Authorization", value: real }] }),
    ]);
    processHar(har);
    const auth = entriesOf(har)[0].request.headers[0].value;
    // `Bearer ` is protocol, not a secret — kept verbatim.
    expect(auth.startsWith("Bearer ")).toBe(true);
    // The credential after it is faked, but the value as a whole stays shaped.
    expect(auth).not.toBe(real);
    expect(auth.slice("Bearer ".length)).not.toBe(real.slice("Bearer ".length));
    expect(auth.length).toBe(real.length);
  });

  it("preserves the keys of a JSON-valued param, faking only the values", () => {
    // A config blob like WSJ's `custom_variables` — flagged by the token-shaped
    // `vxid` value; the user wants field names readable, real values gone.
    const blob = JSON.stringify({
      articleHeadline: "The Messy Courtroom Drama",
      corp: ["harvarduniversity"],
      vxid: "3ced34ac47e2f9c6a53b26566c5d2406",
      isLoggedIn: true,
      bucket: 6,
    });
    const har = makeHar([
      jsonEntry({ query: [{ name: "custom_variables", value: blob }] }),
    ]);
    const { stats } = processHar(har);
    const out = entriesOf(har)[0].request.queryString[0].value;
    const parsed = JSON.parse(out); // output is still valid JSON
    // Keys and structure intact.
    expect(Object.keys(parsed)).toEqual([
      "articleHeadline",
      "corp",
      "vxid",
      "isLoggedIn",
      "bucket",
    ]);
    // String leaves are faked.
    expect(parsed.articleHeadline).not.toBe("The Messy Courtroom Drama");
    expect(parsed.corp[0]).not.toBe("harvarduniversity");
    expect(parsed.vxid).not.toBe("3ced34ac47e2f9c6a53b26566c5d2406");
    // Non-string leaves are left exactly as-is.
    expect(parsed.isLoggedIn).toBe(true);
    expect(parsed.bucket).toBe(6);
    expect(stats.paramsRedacted).toBe(1);
  });

  it("redacts secrets in redirect URLs — Location header and redirectURL", () => {
    const dirty = "https://app.example.com/cb?code=AUTH_SECRET_9";
    const har = makeHar([
      jsonEntry({
        respHeaders: [{ name: "Location", value: dirty }],
        respRedirect: dirty,
      }),
    ]);
    const { stats } = processHar(har);
    const resp = entriesOf(har)[0].response;
    expect(resp.headers[0].value).not.toContain("AUTH_SECRET_9");
    expect(resp.headers[0].value).toContain("app.example.com/cb");
    expect(resp.redirectURL).not.toContain("AUTH_SECRET_9");
    expect(stats.headersRedacted).toBe(1);
  });

  it("leaves a clean Location header and redirect untouched", () => {
    const har = makeHar([
      jsonEntry({
        respHeaders: [{ name: "Location", value: "https://example.com/home" }],
        respRedirect: "https://example.com/home",
      }),
    ]);
    const { stats } = processHar(har);
    const resp = entriesOf(har)[0].response;
    expect(resp.headers[0].value).toBe("https://example.com/home");
    expect(resp.redirectURL).toBe("https://example.com/home");
    expect(stats.headersRedacted).toBe(0);
  });

  it("redacts an internal serverIPAddress, leaves a public one alone", () => {
    const har = makeHar([
      jsonEntry({ serverIP: "10.0.4.17" }), // internal — reveals topology
      jsonEntry({ serverIP: "142.251.45.20" }), // public CDN/ad server — not PII
    ]);
    const { stats } = processHar(har);
    const e = entriesOf(har);
    expect(e[0].serverIPAddress).not.toBe("10.0.4.17");
    expect(e[0].serverIPAddress).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    expect(e[1].serverIPAddress).toBe("142.251.45.20");
    expect(stats.ipsRedacted).toBe(1);
  });

  it("obfuscates a JSON response body field through the engine", () => {
    const body = JSON.stringify({ email: "real.person@gmail.com" });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const { stats } = processHar(har);
    const parsed = JSON.parse(entriesOf(har)[0].response.content.text);
    expect(parsed.email).not.toBe("real.person@gmail.com");
    expect(parsed.email).toContain("@");
    expect(stats.bodiesObfuscated).toBe(1);
  });

  it("leaves clean body URLs alone, redacts only URLs carrying secrets", () => {
    const body = JSON.stringify({
      avatar_url: "https://cdn.example.com/avatars/12345.png",
      docsUrl: "https://docs.github.com",
      reset_url: "https://app.example.com/reset?token=SECRET123456",
    });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const { targets } = processHar(har);
    const out = JSON.parse(entriesOf(har)[0].response.content.text);
    // Clean links — including a bare-domain one — kept byte-for-byte, with no
    // trailing-slash normalization sneaking in.
    expect(out.avatar_url).toBe("https://cdn.example.com/avatars/12345.png");
    expect(out.docsUrl).toBe("https://docs.github.com");
    // A clean URL is not flagged.
    const docs = targets.find((t) => t.section === "body" && t.name === "docsUrl");
    expect(docs?.redact).toBe(false);
    expect(docs?.redactedByDefault).toBe(false);
    // A URL carrying a secret query param keeps its shape but loses the token.
    expect(out.reset_url).not.toContain("SECRET123456");
    expect(out.reset_url).toContain("app.example.com/reset");
  });

  it("keeps regional body fields, still obfuscates address PII", () => {
    const body = JSON.stringify({
      country: "us",
      currency: "USD",
      region: "ny",
      city: "Boston",
      email: "real@example.com",
    });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const { targets } = processHar(har);
    const out = JSON.parse(entriesOf(har)[0].response.content.text);
    // Regional data is kept verbatim — coarse, often needed for research.
    expect(out.country).toBe("us");
    expect(out.currency).toBe("USD");
    expect(out.region).toBe("ny");
    // City and email are still obfuscated.
    expect(out.city).not.toBe("Boston");
    expect(out.email).not.toBe("real@example.com");
    // A regional field is listed so it can be opted in, but isn't flagged.
    const country = findTarget(targets, "body", "country");
    expect(country?.redactedByDefault).toBe(false);
    expect(country?.redact).toBe(false);
    expect(country?.reason).toBe("regional data");
  });

  it("keeps plain date body fields but obfuscates a birthdate", () => {
    const body = JSON.stringify({
      publishedAt: "2026-05-16T07:51:00.000Z",
      renewDate: "2026-09-01",
      dob: "1990-05-12",
    });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const { targets } = processHar(har);
    const out = JSON.parse(entriesOf(har)[0].response.content.text);
    // Plain dates are coarse, research-relevant — kept verbatim.
    expect(out.publishedAt).toBe("2026-05-16T07:51:00.000Z");
    expect(out.renewDate).toBe("2026-09-01");
    // A birthdate is real PII — still obfuscated, keeping the date shape.
    expect(out.dob).not.toBe("1990-05-12");
    expect(out.dob).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const renew = findTarget(targets, "body", "renewDate");
    expect(renew?.redactedByDefault).toBe(false);
    expect(renew?.reason).toBe("date");
    const dob = findTarget(targets, "body", "dob");
    expect(dob?.redactedByDefault).toBe(true);
    expect(dob?.reason).toBe("date of birth");
  });

  it("obfuscates a regional field when opted in, with a like-shaped fake", () => {
    const body = JSON.stringify({ country: "us" });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const id = targetId("body", "country", "us");
    processHar(har, { overrides: { [id]: { redact: true } } });
    const out = JSON.parse(entriesOf(har)[0].response.content.text);
    expect(out.country).not.toBe("us");
    expect(out.country).toMatch(/^[a-z]{2}$/); // still a 2-letter code
  });

  it("skips a base64 binary body", () => {
    const har = makeHar([
      jsonEntry({
        respBody: "iVBORw0KGgoAAAANSUhEUg==",
        respMime: "image/png",
        respEncoding: "base64",
      }),
    ]);
    const { stats } = processHar(har);
    expect(entriesOf(har)[0].response.content.text).toBe("iVBORw0KGgoAAAANSUhEUg==");
    expect(stats.bodiesObfuscated).toBe(0);
    expect(stats.bodiesSkipped).toBe(1);
  });

  it("reports a body that claims a text mime but is gzip or base64-encoded", () => {
    // application/json mime, but the bytes are gzip (entry 0) / a bare base64
    // blob with no encoding field (entry 1) — can't be parsed and obfuscated.
    const gzip = "" + "compressedgarbage".repeat(4);
    const base64 = "eyJ" + "A".repeat(80);
    const har = makeHar([
      jsonEntry({ respBody: gzip }),
      jsonEntry({ respBody: base64 }),
    ]);
    const { stats } = processHar(har);
    expect(stats.bodiesObfuscated).toBe(0);
    expect(stats.entryErrors.length).toBe(2);
    expect(stats.entryErrors[0].message).toMatch(/compressed or base64-encoded/);
    // The bodies are left exactly as-is — never silently corrupted.
    expect(entriesOf(har)[0].response.content.text).toBe(gzip);
    expect(entriesOf(har)[1].response.content.text).toBe(base64);
  });

  it("obfuscates a body behind an anti-hijacking prefix, keeping the prefix", () => {
    const body = `)]}'\n${JSON.stringify({ email: "real@example.com" })}`;
    const har = makeHar([jsonEntry({ respBody: body })]);
    const { stats } = processHar(har);
    const out = entriesOf(har)[0].response.content.text;
    expect(out.startsWith(")]}'\n")).toBe(true);
    const parsed = JSON.parse(out.slice(5));
    expect(parsed.email).not.toBe("real@example.com");
    expect(parsed.email).toContain("@");
    expect(stats.bodiesObfuscated).toBe(1);
  });

  it("de-chunks an HTTP chunked-transfer body, then obfuscates it", () => {
    const json = JSON.stringify({ email: "real@example.com" });
    const chunked = `${json.length.toString(16)}\r\n${json}\r\n0\r\n\r\n`;
    const har = makeHar([jsonEntry({ respBody: chunked })]);
    const { stats } = processHar(har);
    const out = entriesOf(har)[0].response.content.text;
    // Output is the clean de-chunked body — no hex-size framing left.
    expect(out).not.toContain("\r\n");
    const parsed = JSON.parse(out);
    expect(parsed.email).not.toBe("real@example.com");
    expect(parsed.email).toContain("@");
    expect(stats.bodiesObfuscated).toBe(1);
  });

  it("isolates a malformed body — other entries still process", () => {
    const har = makeHar([
      jsonEntry({ respBody: "not valid json {{{", respMime: "application/json" }),
      jsonEntry({ respBody: JSON.stringify({ email: "good@example.com" }) }),
    ]);
    const { stats } = processHar(har);
    expect(stats.entryErrors.length).toBe(1);
    expect(stats.entryErrors[0].entry).toBe(0);
    expect(stats.bodiesObfuscated).toBe(1);
    expect(entriesOf(har)[0].response.content.text).toBe("not valid json {{{");
  });

  it("round-trips to a valid HAR with metadata intact", () => {
    const har = makeHar([
      jsonEntry({ respBody: JSON.stringify({ email: "a@b.com" }) }),
      jsonEntry({ respBody: JSON.stringify({ email: "c@d.com" }) }),
    ]);
    processHar(har);
    const round = JSON.parse(JSON.stringify(har));
    expect(isHarLike(round)).toBe(true);
    expect(round.log.entries.length).toBe(2);
    expect(round.log.entries[0].time).toBe(123);
    expect(round.log.entries[0].response.status).toBe(200);
  });

  it("throws on non-HAR input", () => {
    expect(() => processHar({ not: "a har" })).toThrow(/valid HAR/);
  });

  it("handles an empty entries array", () => {
    const { stats, targets } = processHar(makeHar([]));
    expect(stats.entries).toBe(0);
    expect(targets).toEqual([]);
  });

  it("reports progress for every entry", () => {
    const har = makeHar([jsonEntry({}), jsonEntry({}), jsonEntry({})]);
    const seen: Array<[number, number]> = [];
    processHar(har, {}, (done, total) => seen.push([done, total]));
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

describe("processHar — target list", () => {
  it("emits a target per distinct value with original and replacement", () => {
    const har = makeHar([
      jsonEntry({
        reqHeaders: [{ name: "Authorization", value: "Bearer real-token" }],
        serverIP: "10.0.4.9",
      }),
    ]);
    const { targets } = processHar(har);
    const auth = findTarget(targets, "header", "Authorization");
    expect(auth?.original).toBe("Bearer real-token");
    expect(auth?.replacement).not.toBe("Bearer real-token");
    expect(auth?.replacement).toBeTruthy();
    expect(auth?.redact).toBe(true);
    expect(auth?.redactedByDefault).toBe(true);

    const ip = findTarget(targets, "ip", "serverIPAddress");
    expect(ip?.original).toBe("10.0.4.9");
    expect(ip?.redact).toBe(true);
  });

  it("records which entries each value appears in", () => {
    const har = makeHar([
      jsonEntry({
        url: "https://api.example.com/a",
        reqHeaders: [{ name: "Authorization", value: "Bearer SHARED" }],
      }),
      jsonEntry({
        url: "https://api.example.com/b",
        reqHeaders: [{ name: "Authorization", value: "Bearer SHARED" }],
      }),
    ]);
    const { targets } = processHar(har);
    const auth = findTarget(targets, "header", "Authorization");
    expect(auth?.occurrences).toBe(2);
    expect(auth?.locations.map((l) => l.entry)).toEqual([0, 1]);
    expect(auth?.locations[0].method).toBe("GET");
    expect(auth?.locations[0].url).toBe("api.example.com/a");
  });

  it("deduplicates an identical value across entries and counts occurrences", () => {
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Accept", value: "application/json" }] }),
      jsonEntry({ reqHeaders: [{ name: "Accept", value: "application/json" }] }),
      jsonEntry({ reqHeaders: [{ name: "Accept", value: "text/html" }] }),
    ]);
    const { targets } = processHar(har);
    const accepts = targets.filter((t) => t.section === "header" && t.name === "Accept");
    expect(accepts.length).toBe(2); // two distinct values
    const json = accepts.find((t) => t.original === "application/json");
    expect(json?.occurrences).toBe(2);
  });

  it("lists benign names as non-default targets so they can be opted in", () => {
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Referer", value: "https://real/x" }] }),
    ]);
    const { targets } = processHar(har);
    const ref = findTarget(targets, "header", "Referer");
    expect(ref?.redactedByDefault).toBe(false);
    expect(ref?.redact).toBe(false);
    expect(ref?.replacement).toBe("https://real/x"); // unchanged
  });

  it("emits a target per JSON body field", () => {
    const body = JSON.stringify({ email: "real@example.com" });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const { targets } = processHar(har);
    const field = findTarget(targets, "body", "email");
    expect(field).toBeDefined();
    expect(field?.original).toBe("real@example.com");
    expect(field?.redactedByDefault).toBe(true);
  });

  it("explains why each value was flagged", () => {
    const har = makeHar([
      jsonEntry({
        reqHeaders: [
          { name: "Authorization", value: "Bearer x" },
          { name: "Accept", value: "application/json" },
        ],
        respBody: JSON.stringify({ email: "real@example.com" }),
      }),
    ]);
    const { targets } = processHar(har);
    expect(findTarget(targets, "header", "Authorization")?.reason).toBe(
      "credential header",
    );
    expect(findTarget(targets, "header", "Accept")?.reason).toBe("standard header");
    expect(findTarget(targets, "body", "email")?.reason).toBe("email address");
  });
});

describe("processHar — redaction policy", () => {
  it("skips header redaction when policy.headers is off", () => {
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Authorization", value: "Bearer x" }] }),
    ]);
    const { stats } = processHar(har, {
      policy: { headers: false, params: true, bodies: true, ips: true },
    });
    expect(stats.headersRedacted).toBe(0);
    expect(entriesOf(har)[0].request.headers[0].value).toBe("Bearer x");
  });

  it("skips body obfuscation when policy.bodies is off", () => {
    const body = JSON.stringify({ email: "real@example.com" });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const { stats } = processHar(har, {
      policy: { headers: true, params: true, bodies: false, ips: true },
    });
    expect(stats.bodiesObfuscated).toBe(0);
    expect(entriesOf(har)[0].response.content.text).toBe(body);
  });
});

describe("processHar — per-target overrides", () => {
  it("keeps a default-secret header when opted out by id", () => {
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Authorization", value: "Bearer real" }] }),
    ]);
    const id = targetId("header", "Authorization", "Bearer real");
    const { stats } = processHar(har, { overrides: { [id]: { redact: false } } });
    expect(stats.headersRedacted).toBe(0);
    expect(entriesOf(har)[0].request.headers[0].value).toBe("Bearer real");
  });

  it("redacts a benign header when opted in by id", () => {
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Referer", value: "https://real/secret" }] }),
    ]);
    const id = targetId("header", "Referer", "https://real/secret");
    const { stats } = processHar(har, { overrides: { [id]: { redact: true } } });
    expect(stats.headersRedacted).toBe(1);
    expect(entriesOf(har)[0].request.headers[0].value).not.toBe(
      "https://real/secret",
    );
  });

  it("applies a custom replacement value to a header", () => {
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Authorization", value: "Bearer real" }] }),
    ]);
    const id = targetId("header", "Authorization", "Bearer real");
    const { targets } = processHar(har, {
      overrides: { [id]: { redact: true, value: "Bearer test-token" } },
    });
    expect(entriesOf(har)[0].request.headers[0].value).toBe("Bearer test-token");
    expect(findTarget(targets, "header", "Authorization")?.replacement).toBe(
      "Bearer test-token",
    );
  });

  it("keeps a body field when opted out by id", () => {
    const body = JSON.stringify({ email: "real@example.com" });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const id = targetId("body", "email", "real@example.com");
    processHar(har, { overrides: { [id]: { redact: false } } });
    const parsed = JSON.parse(entriesOf(har)[0].response.content.text);
    expect(parsed.email).toBe("real@example.com");
  });

  it("applies a custom value to a body field", () => {
    const body = JSON.stringify({ email: "real@example.com" });
    const har = makeHar([jsonEntry({ respBody: body })]);
    const id = targetId("body", "email", "real@example.com");
    processHar(har, {
      overrides: { [id]: { redact: true, value: "anon@example.test" } },
    });
    const parsed = JSON.parse(entriesOf(har)[0].response.content.text);
    expect(parsed.email).toBe("anon@example.test");
  });

  it("override is ignored when its category is turned off", () => {
    const har = makeHar([
      jsonEntry({ reqHeaders: [{ name: "Referer", value: "https://real/x" }] }),
    ]);
    const id = targetId("header", "Referer", "https://real/x");
    const { stats } = processHar(har, {
      policy: { headers: false, params: true, bodies: true, ips: true },
      overrides: { [id]: { redact: true } },
    });
    expect(stats.headersRedacted).toBe(0);
    expect(entriesOf(har)[0].request.headers[0].value).toBe("https://real/x");
  });
});

describe("checkHarGate", () => {
  it("passes small files silently", () => {
    expect(checkHarGate(10 * 1024 * 1024, false).kind).toBe("ok");
  });
  it("warns in the large-but-allowed band", () => {
    expect(checkHarGate(HAR_GATE_SILENT + 1, false).kind).toBe("warn");
  });
  it("refuses above the hard ceiling", () => {
    expect(checkHarGate(HAR_GATE_MAX + 1, false).kind).toBe("refuse");
  });
  it("applies the tighter mobile ceiling", () => {
    expect(checkHarGate(100 * 1024 * 1024, false).kind).toBe("warn");
    expect(checkHarGate(100 * 1024 * 1024, true).kind).toBe("refuse");
  });
});
