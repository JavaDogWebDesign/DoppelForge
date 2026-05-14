# Security Policy

## Our threat model

DoppelForge is a **browser-only** tool. Real API responses pasted into it stay inside your browser tab:

- No backend, no server, no API.
- No analytics, no telemetry, no error reporting beacons.
- No third-party network calls at runtime.

The deployed site is served as a static bundle with a strict Content Security Policy that disallows any outbound `connect-src` other than `'self'` (in fact, `'none'`).

If you can reproduce a case where real data leaves the tab — through the application code, a dependency, the build pipeline, or a host configuration — that's a critical bug. Please report it privately so we can fix it before disclosure.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Email: **`security@doppelforge.com`**

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a minimal proof-of-concept.
- The version / commit hash you tested against, if known.
- Whether you've shared this with anyone else.

We'll acknowledge receipt within **3 business days** and aim to provide a remediation plan within **14 days** for confirmed vulnerabilities.

## Scope

In scope:
- The hosted application at `doppelforge.com` and its build output.
- The obfuscation engine and field-map logic.
- Provider field maps that incorrectly classify a PII field as non-PII (e.g. a field map that leaves an email un-obfuscated).
- Any runtime that causes a real value to be transmitted off-device.

Out of scope:
- Bugs in third-party hosting or browser sandboxes.
- Issues that require physical access to the user's device.
- Self-XSS via pasted hostile payloads where the user has loaded a known-malicious origin.

## Coordinated disclosure

We prefer coordinated disclosure: a fix lands first, then a public advisory describing the issue and credit. Researchers acting in good faith under this policy will not be subject to legal action.
