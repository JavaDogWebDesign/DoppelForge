import type { SemanticType, JsonValue } from "./types";
import { pathTail } from "./paths";

// Regional / locale field types. The HAR tool preserves these by default — a
// country, currency, state or region is coarse, low-PII data that users often
// need kept intact for API research — while a per-value opt-in still lets any
// of them be obfuscated (the real generator then forges a like-shaped value).
export const LOCALE_TYPES: ReadonlySet<SemanticType> = new Set<SemanticType>([
  "country",
  "countryCode",
  "currency",
  "stateOrProvince",
]);

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const RE_URL = /^https?:\/\/[^\s]+$/i;
const RE_PHONE = /^\+?[\d\s\-().]{7,}$/;
const RE_PHONE_HAS_SEPARATOR = /[+\s\-().]/;
const RE_CREDIT_CARD_LIKE = /^\d{13,19}$/;
// A JSON Web Token — two or three base64url segments, the header starting with
// `eyJ` (base64 of `{"`). JWTs routinely carry name / email / id in the clear.
const RE_JWT = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?$/;
// A long unbroken hex run — a hash, opaque token, or tracking id. 32+ chars so
// shorter hex words ("beef", "decade") aren't swept up.
const RE_LONG_HEX = /^[0-9a-f]{32,}$/i;

// Non-values: a field literally holding a placeholder is never PII, so it is
// kept verbatim rather than replaced with a fake name / id.
const PLACEHOLDERS = new Set([
  "", "n/a", "na", "none", "null", "nil", "undefined", "unknown", "-", "—",
]);
function isPlaceholder(value: JsonValue): boolean {
  return typeof value === "string" && PLACEHOLDERS.has(value.trim().toLowerCase());
}

// Luhn checksum — every real credit-card number passes it, so requiring it cuts
// the false positives where an ordinary 13-19 digit id is mistaken for a card.
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Path-based hints take precedence over tail-only key hints, for cases where
// the parent context disambiguates an otherwise-generic key (e.g. "code"
// inside cvv_result vs an enum error code elsewhere).
const PATH_HINTS: Array<[RegExp, SemanticType]> = [
  [/cvv_result\.code$/i, "cvvCode"],
  [/cvv_result\.message$/i, "cvvMessage"],
  [/avs_result\.code$/i, "avsCode"],
  [/avs_result\.message$/i, "avsMessage"],
];

const KEY_HINTS: Array<[RegExp, SemanticType]> = [
  [/^(?:id|customer_id|order_id|user_id|account_id|product_id|variant_id|cart_id|subscription_id|invoice_id|charge_id|transaction_id|payment_id|external_id|merchant_id|tax_id|address_id|company_id|store_id|channel_id|gateway_transaction_id|payment_provider_id|reference_transaction_id|payment_instrument_token)$/i, "id"],
  // Any `*_id` / `*Id` / `*_ids` / `*_uid` field, plus bare uid/guid/gid — a
  // catch-all for the long tail of identifier keys the exact list above misses.
  [/^(?:uid|guid|gid)$|(?:_id|_ids|_uid)$/i, "id"],
  // Credential-bearing keys — a JWT, token, secret or API key. Obfuscated as
  // `id` (a shape-preserving scramble) so the value stays token-shaped.
  [/^(?:jwt|api_?key)$|(?:_token|_secret|_api_?key|_apikey)$/i, "id"],
  [/^(?:e_?mail|email_address)$/i, "email"],
  [/^(?:first_name|firstname|given_name)$/i, "firstName"],
  [/^(?:last_name|lastname|surname|family_name)$/i, "lastName"],
  [/^(?:full_name|fullname|customer_name)$/i, "fullName"],
  [/^(?:phone|phone_number|telephone|mobile|cell)$/i, "phone"],
  [/^(?:company|company_name|organization|organisation)$/i, "company"],
  [/^(?:street_?1|street|address_?1|address|line1|street_address)$/i, "street"],
  [/^(?:street_?2|address_?2|line2)$/i, "streetSecondary"],
  [/^(?:city|town|locality)$/i, "city"],
  [/^(?:state|province|region|state_or_province)$/i, "stateOrProvince"],
  [/^(?:zip|zipcode|zip_code|postal_code|postcode)$/i, "postalCode"],
  [/^(?:country|country_name)$/i, "country"],
  [/^(?:country_code|country_iso2|iso_country)$/i, "countryCode"],
  [/^(?:ip|ip_address|remote_addr)$/i, "ipv4"],
  [/^(?:sku|item_sku|product_sku)$/i, "sku"],
  [/^(?:currency|currency_code|default_currency_code|store_default_currency_code)$/i, "currency"],
  // `description` is intentionally absent — in an API response it is far more
  // often product / config copy than free-text PII, so flagging it on the key
  // alone over-obfuscates. A user opts a specific description in per value.
  [/^(?:notes?|comment|comments|message)$/i, "shortText"],
];

function looksLikeId(value: JsonValue): boolean {
  if (typeof value === "number") return value >= 1000;
  if (typeof value !== "string") return false;
  if (value.length < 4) return false;
  // A lowercase word, or hyphen/underscore-joined slug ("frequent-contributor",
  // "active"), is an enum or label — not an opaque identifier. An opaque id
  // carries digits, mixed case, or a token prefix and falls through to `true`.
  if (/^[a-z]+(?:[-_][a-z]+)*$/.test(value)) return false;
  return true;
}

// User-handle keys — a username / display name always identifies a person, so
// it's redacted whatever the value shape (unlike a bare `name`, which is too
// generic to flag unconditionally). Obfuscated as `id` — a shape-preserving
// scramble — since a handle is not a person's name.
const HANDLE_KEY_RE =
  /^(?:username|user_name|screen_?name|display_?name|handle|login|nick(?:name)?|prefixed_?name)$/i;

// A person-name shape: two to four capitalized words.
const RE_NAME_SHAPE = /^\p{Lu}[\p{L}'.-]*(?: \p{Lu}[\p{L}'.-]*){1,3}$/u;

function looksLikeName(value: JsonValue): boolean {
  return typeof value === "string" && RE_NAME_SHAPE.test(value.trim());
}

// A single token carrying an underscore or digit — a handle, not a plain
// label or dictionary word. Catches a username sitting in a generic `name`
// field ("ur_mamas_krama") without flagging labels ("50", "Widget").
function looksLikeHandle(value: JsonValue): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return v.length >= 5 && !/\s/.test(v) && /[_\d]/.test(v);
}

function matchHint(
  hints: Array<[RegExp, SemanticType]>,
  candidate: string,
): SemanticType | null {
  for (const [re, type] of hints) {
    if (re.test(candidate)) return type;
  }
  return null;
}

export function detectGeneric(path: string, value: JsonValue): SemanticType {
  // A placeholder value ("N/A", "", "unknown") is never PII whatever the key.
  if (isPlaceholder(value)) return "preserve";

  const pathHit = matchHint(PATH_HINTS, path);
  if (pathHit) return pathHit;

  const tail = pathTail(path);
  // Snake-case the tail so a camelCase / PascalCase key matches the snake_case
  // hints — `countryCode` and `CountryCode` resolve like `country_code`.
  const snakeTail = tail.replace(/([a-z0-9])([A-Z])/g, "$1_$2");

  // A username / display-name field always identifies a person.
  if (HANDLE_KEY_RE.test(tail) || HANDLE_KEY_RE.test(snakeTail)) return "id";

  const keyHit = matchHint(KEY_HINTS, tail) ?? matchHint(KEY_HINTS, snakeTail);
  if (keyHit) {
    if (keyHit === "id" && !looksLikeId(value)) return "preserve";
    return keyHit;
  }

  // A bare `name` is too generic to flag on the key alone (room name, product
  // name…). Flag it only when the value is a person-name shape, or a handle.
  if (/^name$/i.test(tail)) {
    if (looksLikeName(value)) return "fullName";
    if (looksLikeHandle(value)) return "id";
  }

  if (typeof value === "string") {
    if (RE_EMAIL.test(value)) return "email";
    if (RE_JWT.test(value)) return "id";
    if (RE_UUID.test(value)) return "uuid";
    if (RE_LONG_HEX.test(value)) return "id";
    if (RE_IPV4.test(value)) return "ipv4";
    if (RE_URL.test(value)) return "url";
    if (RE_ISO_DATE.test(value)) return "isoDate";
    if (RE_CREDIT_CARD_LIKE.test(value) && luhnValid(value)) return "redact";
    if (RE_PHONE.test(value) && RE_PHONE_HAS_SEPARATOR.test(value)) {
      const digitCount = (value.match(/\d/g) || []).length;
      if (digitCount >= 7 && digitCount <= 15) return "phone";
    }
  }

  return "preserve";
}
