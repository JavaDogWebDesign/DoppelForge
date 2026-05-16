# HAR file support — feasibility, scope, and cost analysis

**Status**: ✅ **Built — shipped as "HAR mode," beta release (2026-05-15).** See the [Decision record](#decision-record) at the end for what was built and how it diverged from this research. The analysis below is preserved as written; it remains the rationale for the architecture that shipped.

This doc captures the research from 2026-05 into what it would actually take to add HAR (HTTP Archive 1.2) file support to doppelforge. It exists so we can revisit the decision with full information rather than re-litigating from scratch each time the topic comes up.

The headline question — *can a browser-only static-bundle obfuscator handle a 200MB HAR?* — has a precise answer: **yes up to ~250MB with a Worker; no above that without committing to streaming JSON parsing**. That technical answer is fine. The harder question is whether the multi-week engineering cost is the best use of time relative to the alternatives.

---

## Executive summary

| Question | Answer |
|---|---|
| Is it technically possible in a browser-only tool? | Yes, with hard size gates |
| What's the practical ceiling? | ~75MB silent, ~250MB with warnings, refuse above |
| Engineering cost (dev only) | 10-17 working days |
| Testing cost (end-to-end) | 5-10 working days |
| Total calendar time, single person | **3-6 weeks** |
| Hardest single risk | OOM handling across Chrome/Firefox/Safari/mobile |
| Best alternative if we don't build it | None — every existing browser-only tool fails above 50MB |

**Recommendation**: build it as the 1.0 launch feature, **but only if 3-6 weeks of focused time is available and there isn't a higher-ROI feature competing for that window**. Otherwise defer. The market is open and there's no good substitute today, so the feature's value won't evaporate if we wait.

---

## HAR 1.2 schema (the parts we touch)

Top-level: `{ log: { version, creator, browser?, pages?[], entries[] } }`.

Per-entry PII surface (lives entirely under `entries[]`):

- `request.url` — full URL with query string in plain text
- `request.queryString[].{name, value}` — split form of the URL params
- `request.headers[].{name, value}` — Authorization, Cookie, X-CSRF, custom auth, basically anything named in the wild
- `request.cookies[].{name, value, path, domain, expires}` — parsed cookies
- `request.postData.text` or `.params[]` — request body (forms, JSON, multipart)
- `response.status`, `response.statusText` — generally safe to preserve
- `response.headers[]` — Set-Cookie is the big one; CSP/CORS headers are not PII
- `response.cookies[]` — same shape as request
- `response.content.text` — **the heavy hitter**. Body of the response. Can be:
  - Plain text (JSON, XML, HTML, CSV, form-encoded) — feed through existing doppelforge engine
  - Base64 binary (`content.encoding === "base64"`, `mimeType: image/*` or `font/*` or `application/wasm`) — skip entirely
- `entries[]._initiator.stack.callFrames[].url` — Chrome extension, can contain hashed app URLs
- `serverIPAddress` — sometimes present, IPv4 PII

Non-PII per-entry: `time`, `timings.*`, `cache`, `connection`, `pageref`, `_resourceType`, `_priority`, `_fromCache`. Leave untouched.

---

## Real-world size distribution

No published "HAR size dataset" exists, but converging evidence from HTTP Archive Almanac, DebugBear, Monito, Zendesk, and chrome-har-capturer issues:

- **Median single page load**: 3-15MB. Multiplier of 2-4× the rendered page weight because HAR uncompresses response bodies and inlines them with per-entry overhead.
- **Heavy SPA (Slack, Figma, Gmail, Notion) single session**: 20-50MB.
- **10-minute DevTools recording on a chatty app**: **100-300MB**. This is the typical "support engineer captured a bug" scenario.
- **1GB+**: reachable but rare. Long-running tab pulling video manifests or blob storage.

**What dominates HAR bytes**: `response.content.text` is **80-95% of bytes** in HARs over 50MB. Of that, a large fraction is base64 binaries (images, fonts, wasm) and JS bundle source code — neither has PII value. The high-PII surface (cookies + auth headers + query strings + JSON response bodies) is **<20% of total bytes** even on huge HARs.

This is the leverage point: filter to "interesting" entries *before* doing heavy obfuscation work.

---

## Browser performance ceilings

The hard limit isn't memory, it's the **V8 max string length** (~512MiB on 64-bit V8, ~256MiB practical on Safari). Above that the browser can't even hold the file as a string to call `JSON.parse` on, regardless of available RAM.

Numbers from community benchmarks, 2026 Chrome 64-bit, 16GB desktop, clean tab:

| HAR size | `JSON.parse` time | Peak RAM during parse | Outcome |
|---|---|---|---|
| 50MB | 0.5-1.5s | ~300-500MB | Smooth |
| 200MB | 3-8s | 1.5-3GB | Works on desktop Chrome; **unreliable on Safari** |
| 400MB | 8-20s if no OOM | 3-6GB | Hostile — frequent OOM, OS swap |
| 500MB+ | — | — | V8 string-length ceiling; can't parse at all |

**Mobile Safari is the constraint**: ~384MB practical heap. A 100MB HAR can OOM-kill the WebContent process. Desktop Safari: ~1.5-2GB practical heap.

`JSON.parse` *cost scaling* is super-linear due to allocator pressure. Peak RAM during parse is roughly 5-8× the source string size because V8 holds the source string + a parser working set + the parsed tree + transient closure allocations simultaneously.

---

## Architecture options

### Option A — in-memory + Web Worker (recommended for v1)

```
User picks file
  → File.arrayBuffer() → transfer to Worker (zero-copy)
  → Worker: TextDecoder → JSON.parse → walk entries → obfuscate per-entry
  → Worker: serialize parsed tree → Blob → postMessage Blob to main
  → Main: createObjectURL → trigger download
```

- **Pros**: reuses existing engine per-entry, UI stays responsive, no new parser to write.
- **Cons**: hits V8 string ceiling above ~500MB. Peak memory is ~5-8× file size.
- **Realistic ceiling**: 250MB with warnings, hard refuse above 250MB.
- **Effort**: 10-17 dev days (see breakdown below).

### Option B — streaming JSON parser (v2 or never)

```
File.stream().getReader() → clarinet tokenizer → state machine
  → emit JSON tokens to a Blob writer
  → on each headers[]/cookies[]/content.text value: run redaction
  → never materialize the full tree
```

- **Pros**: raises ceiling to 1-2GB before disk-spill becomes the issue.
- **Cons**: 2-4 weeks of careful engineering. Hand-rolling JSON tokenizer state machine. Hard to test exhaustively (escape handling, surrogate pairs, deeply nested base64). One bug = silent corruption of the user's HAR.
- **Effort**: +15-20 dev days on top of Option A.
- **When to do**: only if real users hit the 250MB gate often. Hard to predict before launch (no telemetry, by design).

### Option C — defer entirely

Stay at 220 endpoints across REST/webhooks/GraphQL/CSV/NDJSON/form. Focus on adding endpoints to existing providers or new providers in adjacent categories. Skip HAR.

- **Pros**: no engineering cost, no testing burden, no new failure modes.
- **Cons**: lose the "headline launch feature" story. Every other tool in the space also fails at HAR, so the market opportunity stays open — but a competitor might fill it first.

---

## Existing tools landscape

Why we can't just point users elsewhere:

- **google/har-sanitizer** — Python backend + thin JS frontend. **Archived April 2026.** Not maintained.
- **har-sanitizer.pages.dev** (Cloudflare) — runs on a Cloudflare Worker. Server-side. **Kills the "browser-only, your data never leaves your tab" privacy story.** 100MB body cap on free plan.
- **SanitizHAR Chrome extension** — in-DevTools, `JSON.parse`, no Worker, **anecdotally struggles past 50MB**. Small project.
- **mitmproxy / Charles / Proxyman / Fiddler** — none have turnkey HAR redactors. All require manual rule configuration.

**No browser-only tool reliably handles 200MB+ HARs**. The market is open.

---

## What to obfuscate (PII surface)

Per-entry rules:

| Path | Rule |
|---|---|
| `request.url` | Parse, redact PII in path + query string, re-serialize |
| `request.queryString[].value` | Redact if name is in known-secret list (token, key, password, signature) |
| `request.headers[].value` where name in `["Authorization", "Cookie", "X-Api-Key", "X-Auth-Token", "X-CSRF-Token", ...]` | Redact (replace with placeholder) |
| `request.cookies[].value` | Redact |
| `request.postData.text` when mimeType is JSON/XML/form-encoded | Run through existing doppelforge `parseInput` + transform pipeline |
| `response.headers[].value` where name is `Set-Cookie`, `X-...-Auth`, etc. | Redact |
| `response.cookies[].value` | Redact |
| `response.content.text` when text-like (JSON, XML, HTML, CSV, form) | Run through existing engine |
| `response.content.text` when binary (base64) | Skip — replace with placeholder if mimeType suggests image of PII (e.g. PDF, profile pic) |
| `serverIPAddress` | Redact to a synthetic IPv4 |
| `_initiator.stack.callFrames[].url` | Domain-redact |

**Mime-type fast-path**: walk all entries once, tag each as `obfuscate-text` / `redact-headers-only` / `skip`. Heavy work only runs on the `obfuscate-text` tag. Drops effective workload 5-20× on real HARs.

---

## Engineering cost breakdown

Per-task estimates, single-developer, assuming familiarity with the existing engine:

| Task | Days |
|---|---|
| HAR 1.2 TypeScript types + Zod-style validator | 1-2 |
| File upload UI (drag-drop + button) | 0.5-1 |
| Web Worker scaffolding + message protocol | 2-3 |
| Per-entry transform integration with existing engine | 1-2 |
| Header / cookie / query-string redaction rules (known-secret list, allowlist for safe headers) | 1-2 |
| Mime-type fast-path + entry tagging | 0.5-1 |
| Progress UI (parse spinner, per-entry counter, transform bar) | 1-2 |
| Blob assembly + download trigger | 0.5 |
| Hard size gates + warning + error UI | 0.5 |
| Memory leak audit + Worker lifecycle cleanup | 1-2 |
| **Subtotal: dev** | **10-17 days** |

---

## Testing cost breakdown

This is where the user's "very costly development including testing end to end" concern lands hardest. HAR is high-stakes because **silent corruption of a user's HAR is the worst possible failure** — they trust the obfuscator, paste the output, and ship leaked data.

| Test surface | Days |
|---|---|
| Unit tests: HAR parser, mime-type classifier, header redactor | 1-2 |
| Fixture tests: 8-12 real HAR captures across Chrome / Firefox / Safari from popular apps (Slack, Stripe Dashboard, Gmail, GitHub, etc.) | 2-3 |
| Round-trip tests: HAR in → obfuscated HAR out → re-imports cleanly into DevTools / har-viewer | 1 |
| Memory tests: deliberately oversized HARs (50MB, 150MB, 250MB, 300MB) on Chrome / Firefox / Safari | 1-2 |
| OOM handling: confirm graceful failure (not silent corruption) above the gates | 0.5-1 |
| Browser compat: Chrome / Firefox / Safari desktop; Mobile Safari hard-gate at ~100MB | 0.5-1 |
| Worker lifecycle: cleanup on cancel, on tab close, on second file picked mid-process | 0.5-1 |
| Header allowlist coverage: real-world Authorization variants, custom auth schemes, CSRF tokens | 0.5 |
| **Subtotal: testing** | **5-10 days** |

Plus docs/launch overhead: 2-3 days. **Total calendar: 17-30 working days, or 3-6 weeks for one developer.**

---

## Risks

1. **Silent corruption of user data** is the headline risk. If a regex misfires, a JSON parser bug eats a quote, or a Worker boundary loses bytes, the user pastes a "redacted" HAR that still has real customer data. Mitigation: round-trip tests against real HARs from real apps, and a "diff vs original" sanity-check UI before download.

2. **Browser compat tail** — Mobile Safari heap limits, older Firefox quirks, unknown Worker behavior in Brave/Arc/Vivaldi. Mitigation: hard size gates that are conservative on mobile, explicit refusal with a clear message.

3. **Regression risk on the existing engine** — every HAR entry uses the same pipeline as paste-mode obfuscation. Subtle bugs in the per-entry path (e.g. error handling that aborts the whole HAR on one bad entry) become visible only at scale. Mitigation: each entry's transform is wrapped in try/catch; failures are reported per-entry, not whole-file.

4. **OOM is hard to test deterministically** — depends on tab state, machine RAM, browser version, OS pressure. Mitigation: synthetic test HARs at exact byte sizes, run on a memory-constrained VM to force the failure mode.

5. **The "I understand, try anyway" escape hatch** above the 250MB gate could become a footgun. Users will click through warnings. Mitigation: in v1 don't ship an escape hatch — just refuse. Add later if users complain.

6. **HAR spec divergence between exporters** — Chrome adds `_initiator` / `_resourceType`; Firefox adds different underscore extensions; Safari emits its own quirks; charles/proxyman emit non-spec fields. Mitigation: types are forgiving (extra keys allowed); unknown fields pass through untouched.

---

## Hard product gates (recommended)

- **≤ 75MB**: process silently. No warning.
- **75-250MB**: show "large file, this may take a moment and use significant memory" with a progress bar.
- **\> 250MB**: refuse with a clear message: *"Files over 250MB exceed what browser tabs can reliably handle. Try recording in shorter bursts, or split the HAR before uploading."* No "try anyway" escape hatch in v1.
- **Mobile (any iOS or Android browser)**: hard gate at 75MB — mobile Safari can OOM-kill the tab on a 100MB HAR.

These gates are the **honest user-facing story**: doppelforge handles the 90-99th percentile of real HARs and refuses cleanly above that. Consistent with what every tool in the space actually delivers.

---

## Go / no-go decision criteria

Build HAR support if **all** of these are true:

1. ✅ 3-6 weeks of focused engineering time is genuinely available
2. ✅ No higher-ROI feature competes for that window (see below)
3. ✅ The doppelforge launch positioning needs a headline differentiator
4. ✅ We're willing to commit to round-trip testing against 8-12 real HARs from real apps
5. ✅ We accept the silent-corruption risk and the testing burden it implies

Defer if **any** of these are true:

- ⛔ Less than 3 weeks of focused time available
- ⛔ Endpoint-coverage additions to existing providers are still moving the SEO needle
- ⛔ Engine improvements (literal-value matching, GraphQL alias support) are still unblocked and high-leverage
- ⛔ User demand signal hasn't materialized (no real Twitter/HN/issue mentions asking for HAR support)
- ⛔ A competitor ships a credible browser-only HAR redactor first — then HAR becomes parity work, not a differentiator

---

## Alternatives that are NOT building HAR support

1. **Endpoint expansion**: 25-30 new YAMLs across Stripe / Shopify / HubSpot / Auth0 / Zendesk / SendGrid is 2-3 days of work and bumps coverage 220 → 250. Lower ceiling on excitement, higher floor on shipping.

2. **Literal-value signature matching** (engine work): 0.5-1 day. Unlocks ~30+ per-event YAMLs across Stripe, BigCommerce, Braintree, PayPal that currently collide. Quiet but high-leverage.

3. **GraphQL alias support** (engine work): 1-2 days. Shape-based matching fallback. Niche but unblocks aliased Shopify Admin GraphQL responses.

4. **CLI companion in Node** (~3-5 days): handles HARs of any size via Node streams. Kills the "browser-only" story for HAR specifically, but solves the actual user problem (support engineers shipping 500MB HARs). Reasonable middle ground if browser-only HAR proves too costly.

5. **Browser extension** (multi-week): "Obfuscate this" button injected into Chrome DevTools. Bigger lift than HAR but opens an entirely new distribution channel.

---

## Decision record

- **Date**: 2026-05-15
- **Decision**: **Build.** Shipped as **HAR mode** — a third workspace tab alongside Single and Batch — at beta quality.
- **Reasoning**: Option A (in-memory + Web Worker) was chosen as designed. The market gap held: no browser-only tool reliably redacts large HARs, and HAR is a genuine headline differentiator for the launch.
- **Time committed**: a single focused implementation pass.
- **What we gave up**: nothing material — endpoint-coverage expansion continues in parallel.

### What shipped (and how it diverged from this research)

The architecture matches Option A: file → `ArrayBuffer` transferred zero-copy to a Web Worker → `JSON.parse` → per-entry walk reusing the existing `TransformEngine` for bodies → re-serialize → `Blob` download. Size gates are as recommended (≤75MB silent · 75-250MB warn · >250MB refuse · 75MB mobile cap). Per-entry `try/catch` isolates malformed bodies.

Deliberate departures from the research, all driven by hands-on testing against real HARs:

- **Realistic fakes, not `[REDACTED]`.** The research table said "replace with placeholder." In practice that contradicts doppelforge's whole premise and produced malformed output (`Cookie: [REDACTED]` is not a valid cookie header). Headers, cookies, params, and IPs now get realistic, shape-preserving fakes — a JWT stays JWT-shaped, a `k=v; k=v` cookie stays parseable — deterministic per value so an identical real value forges the same fake everywhere.
- **One unified value tree.** Rather than a per-entry change list, every changeable value (header / cookie / param / body field / server IP) is surfaced as a `RedactionTarget`, deduplicated by value across the whole HAR, grouped into a collapsible tree of `current value → replacement`.
- **Per-value control with full body-field parity.** Each value can be opted in or out and given a custom replacement. JSON/XML body fields are individually controllable, routed through the same engine override mechanism as paste mode.
- **Location tracing.** Each value records which entries carry it (method + URL), so a flagged value can be traced back to its requests.
- **Heuristic refinements.** Cookies are no longer blanket-redacted — benign preference cookies (`color_mode=dark`, `logged_in=yes`) are left alone; only session/identity/tracking cookies or token-shaped values are flagged. URL-typed body fields get userinfo/secret-param redaction instead of whole-link faking, so clean links (`avatar_url`, doc links) pass through untouched.

### Deferred (not in beta)

Streaming JSON parser (Option B) — the 250MB ceiling stands. A "diff vs original" full-document view — the value tree covers review instead. Decoding base64-encoded text bodies. `_initiator.stack` URL handling.

The doc lives so the next person to think about HAR — including future-you — starts with the full picture instead of the optimistic version.
