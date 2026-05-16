# DoppelForge

**Forge identical twins of your API responses.**

Drop in a response from Shopify, Stripe, BigCommerce, Square, PayPal, Mailchimp, Zendesk, or any of ten other platforms. DoppelForge returns a doppelgänger — identical structure, safe values — ready to paste into a blog post, support ticket, Stack Overflow answer, or your favorite LLM.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)
[![Deploys on Cloudflare Pages](https://img.shields.io/badge/deploys-Cloudflare%20Pages-F38020.svg)](https://pages.cloudflare.com/)

<!-- TODO: add a screenshot or short GIF (paste → forge → copy) using only synthetic input. Save under docs/ and reference here. -->

## Try it

**Live demo:** [doppelforge.com](https://doppelforge.com)

Or [run it locally](#run-locally) — it's a single static bundle, no backend.

## Why DoppelForge

Real API responses are leaky. They carry emails, prices, tokens, customer IDs — anything you'd never want in a public gist, a chat with Claude, or a Stack Overflow question. Hand-redacting every field is tedious, error-prone, and breaks the shape of the data. Find/replace with `"REDACTED"` destroys the structural signal that made the response worth sharing in the first place.

DoppelForge solves both at once. The output looks identical to the original. The values don't put anyone at risk.

Same shape. Safe values. Counterfeit, with consent.

## What you get

**Paste mode** — Paste a single response. Get a doppelgänger instantly. No upload, no signup, no servers.

**Batch mode** — Drop in a folder of JSON files. Pick which fields stay raw and which get transformed. Export the whole set as safe-to-share files, with a single seed reused across files so cross-file IDs stay consistent.

**HAR mode** _(beta)_ — Drop a full HAR capture — the network log your browser's DevTools exports. DoppelForge scans every request and response, flags what's sensitive (credential headers, session cookies, secret query/form params, server IPs, and PII inside JSON/XML bodies), and lays it out as one tree of _current value → realistic replacement_. Tick what to redact, set custom values, and drill into any value to see which entries carry it. Large captures are processed off the main thread in a Web Worker — still entirely in your browser, nothing uploaded.

**Platform-aware** — DoppelForge knows the shape of API responses from Shopify, Stripe, BigCommerce, Piano.io, HubSpot, Braintree, Recharge, Twilio, Auth0, SendGrid, Shippo, Mailchimp, PayPal, Square, Zendesk, Salesforce, and ShipperHQ. It transforms the right fields without breaking the structure.

**Runs in your browser** — Your responses never touch a server. DoppelForge is a static web app — every transformation happens locally, and a strict Content Security Policy stops any rogue dependency from changing that.

**Schema generators** — From the same payload, DoppelForge can also emit a TypeScript type, a Zod schema (with inferred types), or a JSON Schema (draft-07). Forge the doppelgänger, hand it to the LLM, then validate the LLM's parser against the schema.

**Open source** — MIT licensed. Audit the code, fork it, or contribute on GitHub.

## What makes the fakes good

- **Schema-aware.** Knows that BigCommerce's `customer_group_id` is a non-PII business field and shouldn't be touched, while `data[].email` is PII and should be faked. A regex can't make that distinction.
- **Referentially consistent.** The same `customer_id` appearing at `data[0].id` and again nested in `orders[5].customer_id` becomes the same fake ID everywhere — so the LLM (or downstream parser) can still reason about joins.
- **Realistic, not redacted.** Faker-generated names and emails pattern-match the way real values do. The string `"REDACTED"` doesn't.
- **JSON _and_ XML.** Both input formats are parsed, transformed, and re-serialized in their original shape. Webhooks, GraphQL, CSV exports, and form-encoded bodies are all supported.
- **Cross-provider auto-detect.** Paste a response from any supported provider and the matcher promotes the right field map — no need to pick from the sidebar first.

## Provider coverage

17 providers, 220 endpoints:

| Provider     | Endpoints | Category       |
|--------------|----------:|----------------|
| Shopify      |        32 | E-commerce     |
| Stripe       |        31 | Payments       |
| BigCommerce  |        28 | E-commerce     |
| Piano.io     |        19 | Subscription   |
| HubSpot      |        16 | CRM            |
| Braintree    |        14 | Payments       |
| Recharge     |        13 | Subscription   |
| Twilio       |        13 | Communications |
| Auth0        |         8 | Identity       |
| SendGrid     |         7 | Communications |
| Shippo       |         7 | Shipping       |
| Mailchimp    |         6 | Marketing      |
| PayPal       |         6 | Payments       |
| Square       |         6 | Payments       |
| Zendesk      |         6 | Support        |
| Salesforce   |         5 | CRM            |
| ShipperHQ    |         3 | Shipping       |

Unknown endpoints fall back to a generic pattern detector — still useful, just lower fidelity. Adding coverage for a new endpoint is a single YAML file. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Workspace features

- **Linked editors.** Input and output editors share scroll, cursor, and code-fold state by default; toggle the link when you want to compare independently.
- **Per-line diff strip.** A small left-edge indicator marks every line where the forged copy differs from the original.
- **Field controls.** Inspect every detected field, override its handling, or set a specific custom value. The override count is persisted with your session.
- **Input history.** Recent pastes are kept locally (with a configurable TTL — default 1 hour) so you can flip between fixtures while iterating.
- **URL hint.** Paste the request URL alongside the response when the path is needed to disambiguate the endpoint.
- **Settings drawer.** See the consistency-cache size, the current seed, regenerate fakes with a new seed, or clear the cache.

All persistent state lives in `localStorage`. Nothing leaves the tab.

## Repository layout

```
.
├── providers/        ← YAML field-map library (the community asset)
│   ├── auth0/
│   ├── bigcommerce/
│   └── …             (17 providers, 220 endpoints)
├── web/              ← React app that consumes providers/
│   ├── src/
│   ├── public/
│   └── scripts/
├── docs/             ← long-form documentation
└── package.json      ← root scripts that delegate into web/
```

`providers/` lives at the repo root because it's the contribution surface — most PRs add a single YAML file there, and no engine changes are required. `web/` is the static-bundle React app that reads providers at build time via Vite's `import.meta.glob`. The engine inside `web/src/engine/` is intentionally thin; the field-map library is what grows.

## Run locally

From the repo root (a thin `package.json` at the root delegates into `web/`):

```bash
npm install        # installs web/ dependencies via postinstall
npm run dev        # starts the Vite dev server
```

Build a static bundle (no server needed):

```bash
npm run build      # tsc -b && vite build
npm run preview    # serves dist/ locally to verify the production CSP
npm run test       # runs the Vitest unit + golden-test suite
npm run lint:yaml  # validates every providers/**/*.yaml parses cleanly
```

If you'd rather work directly in the app folder, the same scripts work from `web/` (e.g. `cd web && npm run dev`) — the root scripts just `npm --prefix web run` them. The production build self-applies its CSP via a `<meta>` tag, so `npm run preview` reflects the same policy you'd see on the deployed site.

### Smoke tests

Three Node scripts under [web/scripts/](web/scripts/) exercise the engine against fixture payloads — useful for catching field-map regressions when contributing:

```bash
node web/scripts/smoke.mjs
node web/scripts/smoke-transactions.mjs
node web/scripts/smoke-cross-provider.mjs
```

## Testing

A [Vitest](https://vitest.dev) suite (~360 checks) covers the transform engine, the matcher, the schema generators, and the provider field-map library. It runs in CI on every commit alongside the bundle audit — run it locally with `npm run test`. The suite is built around the guarantees that actually matter:

- **Privacy-invariant tests.** Synthetic responses are seeded with fake PII, run through the engine, and checked to confirm not one original value survives — verified for *every* input format the tool accepts (JSON, XML, form-encoded, base64-wrapped, CSV, NDJSON).
- **Golden tests over the provider library**, in two layers:
  - *Layer 1* derives a conforming input from every endpoint's own YAML, then asserts the matcher recognizes it, structure is preserved, and each mapped field behaves per its declared type. A typo'd semantic type or an unsatisfiable signature fails CI — no hand-written fixtures, so coverage scales for free as providers are added.
  - *Layer 2* checks selected endpoints against realistically-shaped responses, verifying a field map is correct for the real provider, not merely internally consistent.
- **Security tests.** Prototype-pollution attempts are pushed through every parser, and the custom-provider YAML validator is exercised against pollution keys, CSS-injection payloads, and oversized input.

## Add a new provider

It's a single YAML file per endpoint. No engine changes. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the manifest schema, the type vocabulary, and best practices for marking PII fields.

## Architecture

See [docs/architecture.md](./docs/architecture.md). Short version: YAML provider definitions are read at build time via Vite's `import.meta.glob`, parsed into a typed `Provider` model, and consumed by a transform engine that walks pasted JSON/XML and emits a structurally identical fake. No fetches happen at runtime.

## Privacy & security

Privacy is the product, so it's enforced by construction — not by promise:

- **No network code in the bundle.** Source contains zero `fetch()`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or `navigator.sendBeacon`. The build strips Vite's modulepreload polyfill so no `fetch()` survives in the production bundle.
- **Runtime egress monitor.** Before any app code runs, DoppelForge wraps the three browser APIs that can transmit data off-device — `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon` — and counts every call. The privacy badge in the footer reads "Data stays on this device" only while that count is zero; the moment anything is sent it flips to a red "outbound request detected" warning. The guarantee is verified live in your own browser, not just asserted here. (Dynamic `import()` and asset loads use the module/script loader, not these APIs, so legitimate same-origin chunk loading is never miscounted as egress.)
- **CSP at the browser.** The Cloudflare Pages deploy ships `connect-src 'none'`, `frame-ancestors 'none'`, `object-src 'none'` via [web/public/_headers](./web/public/_headers). Even a hypothetically compromised dependency couldn't open a network connection — the browser would refuse it.
- **CSP also in the HTML.** The same policy is injected as a `<meta>` tag at build time, so it applies even if the bundle is served from somewhere else.
- **CI-gated.** Every commit runs a bundle audit that fails the build if any of those network primitives ever sneak back in — plus the full test suite, including privacy-invariant tests that fail the build if an obfuscated response ever retains an original value. See [Testing](#testing).
- **No analytics, no telemetry, no error reporting.** None are dependencies.

### Reporting a vulnerability

Don't open a public GitHub issue for security reports. Email **`security@doppelforge.com`** with:

- A description of the issue and its impact
- Steps to reproduce, or a minimal proof-of-concept
- The version / commit hash you tested against, if known
- Whether you've shared this with anyone else

**In scope:**

- The hosted application at `doppelforge.com` and its build output
- The obfuscation engine and field-map logic
- Provider field maps that incorrectly classify a PII field as non-PII (e.g. a field map that leaves an email un-obfuscated)
- Any runtime that causes a real value to be transmitted off-device

**Out of scope:**

- Bugs in third-party hosting or browser sandboxes
- Issues that require physical access to the user's device
- Self-XSS via pasted hostile payloads where the user has loaded a known-malicious origin

### Coordinated disclosure

We prefer coordinated disclosure: a fix lands first, then a public advisory describing the issue and credit. Researchers acting in good faith under this policy will not be subject to legal action.

## Project model

Open source, MIT licensed. No paid tiers, no telemetry, no priority queue. The field-map library is the long-lived community asset; the engine is intentionally thin.

## Trademarks

Shopify, Stripe, BigCommerce, Piano.io, HubSpot, Recharge, Braintree, PayPal, Twilio, SendGrid, Salesforce, Auth0, Mailchimp, Square, Zendesk, Shippo, and ShipperHQ are trademarks of their respective owners. DoppelForge is independent and not affiliated with, endorsed by, or sponsored by any of them.

## License

MIT — see [LICENSE](./LICENSE).
