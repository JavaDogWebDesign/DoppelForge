# Architecture

A short tour of how DoppelForge is wired together. For a higher-level pitch, see the [README](../README.md). For how to add a new provider, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Shape of the system

```
                  ┌───────────────────────────────┐
   YAML files ──► │  providers/<id>/manifest.yaml │
   (no code)      │  providers/<id>/endpoints/*   │ ──► loader.ts ──► engine ──► UI
                  └───────────────────────────────┘
```

There is no backend. The entire app is a static React bundle served from a CDN. A pasted response is parsed, transformed, and serialized in the same browser tab; nothing crosses the network.

## Three layers

**1. Provider definitions (`providers/`)**

Pure data. Each provider is a directory:

- `manifest.yaml` — id, name, category, Lucide icon name, brand color, docs URL.
- `endpoints/<slug>.yaml` — one file per endpoint, with:
  - `endpoint` — HTTP method, path pattern, optional description and doc URL.
  - `signature` — JSON paths used to detect "is this response from this endpoint?" without the user telling us.
  - `fields` — a map from JSON path → semantic type (`email`, `fullName`, `id`, `preserve`, `auto`, …).

Adding a new provider is a pure-YAML contribution; no engine changes are required.

**2. Engine (`web/src/engine/`)**

- Type vocabulary (`types.ts`) — the closed set of semantic types a field map can declare.
- Detection — matches a pasted response against known endpoint signatures.
- Transform — walks the JSON, applies the field map, and emits a structurally identical fake response. Maintains referential consistency: the same input ID maps to the same fake ID everywhere it appears.
- Fallback — for responses that don't match any known endpoint, a generic pattern detector applies heuristic obfuscation.

**3. UI (`web/src/`)**

- `providers/loader.ts` — `import.meta.glob`s the `providers/` tree at build time, parses YAML, and produces a list of `Provider` objects.
- `components/` — sidebar (provider list), workspace (paste/output editors), field controls panel.
- CodeMirror for the JSON/XML editor surfaces; Faker for synthetic data generation.

## Build-time vs runtime

YAML is read **at build time** via Vite's `import.meta.glob`. The deployed bundle contains the parsed provider data inline; no fetches happen at runtime.

This is deliberate. Two consequences:

- Adding a provider requires a redeploy. That's acceptable: the contribution model is PR → CI → deploy, not user-supplied configs.
- The build can verify field maps statically (smoke tests in `web/scripts/`), so a malformed YAML never reaches the live site.

## Privacy invariants

These are enforced by construction, not by policy:

- No code in the bundle issues a `fetch`, `XMLHttpRequest`, or `WebSocket` — Vite's modulepreload polyfill is deliberately stripped from the production build so there is no `fetch()` left to grep for.
- The deployed site sets a strict `Content-Security-Policy` (`connect-src 'none'`, `frame-ancestors 'none'`, `object-src 'none'`) so even an accidentally-introduced outbound call would be blocked by the browser. The same policy is also injected as a `<meta>` tag into the built HTML, so it applies even if the bundle is re-hosted.
- No analytics, error reporting, or telemetry libraries are dependencies.

If any of these change, it's a release-blocking issue. See [SECURITY.md](../SECURITY.md) to report a regression.
