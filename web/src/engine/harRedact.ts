// Header / cookie / query-string / URL redaction for HAR entries.
//
// This is genuinely new logic: the TransformEngine matches values inside a
// parsed JSON tree by path and semantic type, but HAR headers and cookies are
// `{ name, value }` pairs in arrays — a different shape that needs name-based
// rules instead. Bodies still go through the existing engine (see har.ts);
// only the name/value metadata is handled here.

// Header names (lowercased) that always carry credentials. `set-cookie` and
// `cookie` are here too — cookie *values* are session tokens.
const SECRET_HEADER_EXACT = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "apikey",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-session-token",
  "x-amz-security-token",
  "x-goog-api-key",
  "x-functions-key",
  "x-shopify-access-token",
]);

// Catch-all for the long tail of custom auth headers (`X-Acme-Auth-Token`,
// `X-Company-Session`, etc.). Deliberately broad on the name only — a false
// positive redacts a non-secret header, which is safe; a false negative leaks.
const SECRET_HEADER_RE =
  /(authorization|auth[_-]?token|access[_-]?token|secret|cookie|session|csrf|xsrf|password|credential|api[_-]?key|bearer)/i;

// Query-string / form-field names whose value is a credential. Tighter than
// the header rule: query strings legitimately carry many non-secret params, so
// matching is anchored to whole word-ish segments.
const SECRET_PARAM_RE =
  /(^|[_-])(token|key|secret|password|passwd|pwd|signature|sig|auth|session|sid|apikey|otp|nonce|credential|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token)([_-]|$)/i;

/** True if a header with this name should have its value redacted. */
export function isSecretHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return SECRET_HEADER_EXACT.has(lower) || SECRET_HEADER_RE.test(lower);
}

/** True if a query-string or form param with this name carries a secret. */
export function isSecretParam(name: string): boolean {
  const n = name.trim();
  // Exact `code` is the OAuth authorization code — matched on its own so the
  // likes of `country_code` / `zip_code` aren't swept up by a broader rule.
  if (n.toLowerCase() === "code") return true;
  return SECRET_PARAM_RE.test(n);
}

// Cookie names that signal a session / identity / tracking cookie. Cookies that
// don't match this and carry a short, simple value (a flag like `yes`, a
// preference like `dark`) are left alone — redacting them is just noise.
const SENSITIVE_COOKIE_NAME_RE =
  /(session|sess|token|auth|csrf|xsrf|secret|credential|sid|jwt|bearer|_octo|telemetry|device|account|login|user|^id$)/i;

/** A cookie value long and random enough to look like a credential/token. */
function valueLooksLikeToken(value: string): boolean {
  const v = value.trim();
  if (v.length < 16) return false; // yes / no / dark / light / small ints
  if (/\s/.test(v)) return false; // human phrases aren't tokens
  const hasLetter = /[A-Za-z]/.test(v);
  const hasDigit = /\d/.test(v);
  return hasLetter && hasDigit && new Set(v).size >= 10;
}

/**
 * Whether a cookie is worth redacting. True when the name looks
 * session/identity/tracking-related, or the value looks like a token. Benign
 * preference cookies (`color_mode=dark`, `logged_in=yes`, `tz=…`) return false,
 * so they aren't scrambled into meaningless noise.
 */
export function isSensitiveCookie(name: string, value: string): boolean {
  return SENSITIVE_COOKIE_NAME_RE.test(name.trim()) || valueLooksLikeToken(value);
}

/**
 * True if a URL actually carries something secret — userinfo or a secret-named
 * query parameter. A plain link like `https://docs.example.com` returns false,
 * so clean links can be left exactly as-is rather than touched and re-encoded.
 */
export function urlHasSecrets(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return true;
  for (const key of parsed.searchParams.keys()) {
    if (isSecretParam(key)) return true;
  }
  return false;
}

/**
 * Redact a request/response URL: replace userinfo (`user:pass@`) and the value
 * of any secret-named query parameter with a realistic fake produced by `fake`.
 * Host and path are preserved so the HAR stays diff-readable. Returns the input
 * unchanged if it can't be parsed as an absolute URL.
 */
export function redactUrl(url: string, fake: (value: string) => string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.username) parsed.username = fake(parsed.username);
  if (parsed.password) parsed.password = fake(parsed.password);
  for (const key of [...parsed.searchParams.keys()]) {
    if (isSecretParam(key)) {
      const current = parsed.searchParams.get(key) ?? "";
      if (current) parsed.searchParams.set(key, fake(current));
    }
  }
  return parsed.toString();
}
