import type { SemanticType, JsonValue } from "./types";
import { pathTail } from "./paths";

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const RE_URL = /^https?:\/\/[^\s]+$/i;
const RE_PHONE = /^\+?[\d\s\-().]{7,}$/;
const RE_PHONE_HAS_SEPARATOR = /[+\s\-().]/;
const RE_CREDIT_CARD_LIKE = /^\d{13,19}$/;

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
  [/^(?:e_?mail|email_address)$/i, "email"],
  [/^(?:first_name|firstname|given_name)$/i, "firstName"],
  [/^(?:last_name|lastname|surname|family_name)$/i, "lastName"],
  [/^(?:full_name|fullname|name|customer_name|display_name)$/i, "fullName"],
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
  [/^(?:notes?|comment|comments|message|description)$/i, "shortText"],
];

function looksLikeId(value: JsonValue): boolean {
  if (typeof value === "number") return value >= 1000;
  if (typeof value === "string") return value.length >= 4;
  return false;
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
  const pathHit = matchHint(PATH_HINTS, path);
  if (pathHit) return pathHit;

  const keyHit = matchHint(KEY_HINTS, pathTail(path));
  if (keyHit) {
    if (keyHit === "id" && !looksLikeId(value)) return "preserve";
    return keyHit;
  }

  if (typeof value === "string") {
    if (RE_EMAIL.test(value)) return "email";
    if (RE_UUID.test(value)) return "uuid";
    if (RE_IPV4.test(value)) return "ipv4";
    if (RE_URL.test(value)) return "url";
    if (RE_ISO_DATE.test(value)) return "isoDate";
    if (RE_CREDIT_CARD_LIKE.test(value)) return "redact";
    if (RE_PHONE.test(value) && RE_PHONE_HAS_SEPARATOR.test(value)) {
      const digitCount = (value.match(/\d/g) || []).length;
      if (digitCount >= 7 && digitCount <= 15) return "phone";
    }
  }

  return "preserve";
}
