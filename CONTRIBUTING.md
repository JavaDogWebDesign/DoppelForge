# Contributing

Most contributions to this project will be **new field maps** for endpoints we don't cover yet. That's the durable, high-value work. This guide walks through adding one.

## Add a new provider

Say you want to add Stripe. Two files:

### 1. `providers/stripe/manifest.yaml`

```yaml
id: stripe
name: Stripe
category: payments
icon: credit-card        # lucide-react icon name
color: "#635BFF"
docs: https://stripe.com/docs/api
```

### 2. `providers/stripe/endpoints/customers.yaml`

```yaml
endpoint:
  method: GET
  path: /v1/customers
  description: List customers
  doc_url: https://stripe.com/docs/api/customers/list

# Signature for auto-detection: fields that, taken together,
# strongly imply this endpoint. The matcher scores against these.
signature:
  required_paths:
    - data[].id
    - data[].object
    - has_more
  optional_paths:
    - data[].invoice_settings

# The actual obfuscation rules.
fields:
  "data[].id":              { type: id, anchor: true }
  "data[].email":           { type: email, anchor: true }
  "data[].name":            { type: fullName }
  "data[].phone":           { type: phone }
  "data[].object":          { type: preserve }     # "customer"
  "data[].livemode":        { type: preserve }
  "data[].created":         { type: unixTimestamp }
  "data[].address.line1":   { type: street }
  "data[].address.city":    { type: city }
  "data[].address.country": { type: countryCode }
  # Catch-all — required. Anything not listed above
  # falls through to the generic pattern detector.
  "*": { type: auto }
```

That's it. Drop the files in, run `npm run dev`, and Stripe shows up in the sidebar. The matcher will auto-detect responses to `/v1/customers` from the signature paths.

## Type vocabulary

| Type              | Produces                                              |
|-------------------|-------------------------------------------------------|
| `email`           | `jane.doe@example.com`                                |
| `firstName`       | `Jane`                                                |
| `lastName`        | `Doe`                                                 |
| `fullName`        | `Jane Doe`                                            |
| `phone`           | `+1-555-0142`                                         |
| `street`          | `742 Evergreen Terrace`                               |
| `streetSecondary` | `Apt 3B`                                              |
| `city`            | `Springfield`                                         |
| `state`           | `Oregon`                                              |
| `stateOrProvince` | `OR` or full name depending on locale                 |
| `postalCode`      | `97403`                                               |
| `country`         | `United States`                                       |
| `countryCode`     | `US`                                                  |
| `company`         | `Acme Co`                                             |
| `id`              | Numeric ID (preserves type: int → int, str → str)     |
| `uuid`            | `f47ac10b-58cc-4372-a567-0e02b2c3d479`                |
| `ipv4`            | `192.0.2.42`                                          |
| `isoDate`         | `2024-03-14T09:30:00Z`                                |
| `unixTimestamp`   | Unix epoch integer                                    |
| `url`             | `https://example.com/some-path`                       |
| `sku`             | `SKU-9F3A2B`                                          |
| `productName`     | `Ergonomic Cotton Hat`                                |
| `shortText`       | One-line plausible text                               |
| `longText`        | Multi-sentence plausible text                         |
| `currency`        | Currency code (USD/EUR/...) — usually use `preserve`  |
| `priceAmount`     | Plausible price as number or string                   |
| `preserve`        | Keep original (use for enums, status codes, flags)    |
| `auto`            | Defer to generic pattern detector                     |
| `null`            | Emit `null`                                           |
| `redact`          | `"[REDACTED]"` sentinel                               |

## Modifiers

- `anchor: true` — Value enters the consistency cache. Subsequent occurrences of the same input value (anywhere in the payload) produce the same fake. Use for IDs, emails, anything referenced relationally.
- All other modifiers live in the type itself.

## Path syntax

A simplified JSONPath dialect:

- `customer.email` — nested object
- `data[].id` — every element of an array at `data`
- `data[0].id` — specific array index (rare; use `data[].id` instead)
- `*` — catch-all for unmatched paths

## Best practices

1. **Mark IDs and emails as `anchor: true`.** Cross-payload consistency is the killer feature.
2. **Use `preserve` aggressively.** Currency codes, status enums, country codes, flags — anything that's structural rather than personal.
3. **Always include `"*": { type: auto }` as the last rule.** This guarantees unknown fields still get pattern-detected.
4. **Test against a real response.** Save the response, run it through the dev build, and check the output by eye.
5. **One endpoint per file.** Don't bundle multiple endpoints into one YAML — the matcher operates per-endpoint.

## Webhook field maps

Webhooks are modeled as endpoints with `kind: webhook` in the `endpoint:` block:

```yaml
endpoint:
  method: POST
  path: charge.succeeded         # literal event type / topic / scope
  kind: webhook                  # opt-in marker
  description: Stripe webhook — charge succeeded
  doc_url: https://docs.stripe.com/api/events/types#event_types-charge.succeeded
```

Conventions:

- Filename: `providers/<id>/endpoints/webhook-<slug>.yaml`. Slug uses dashes for separators (`charge.succeeded` → `webhook-charge-succeeded`).
- `method` is always `POST`.
- `path` is the *literal* event identifier — Stripe's `type` value, Shopify's topic, BigCommerce's scope, HubSpot's `subscriptionType`, Recharge's topic. Not a URL.
- `kind: webhook` is required. Two engine behaviors flip on it: URL-hint matching skips webhook endpoints (a real URL can't refer to an inbound webhook), and the endpoint badge renders a `WEBHOOK` pill.

Signature rules:

- Many providers' webhook bodies share the same envelope shape across events (BigCommerce's `{scope, store_id, data: {type, id}}` is identical regardless of which event). When signature detection can't tell them apart, ship a single consolidated entry with a wildcard `path` like `store/*` rather than indistinguishable per-event YAMLs.
- For providers where bodies *do* differ per event (Stripe: `data.object.amount_captured` vs `data.object.amount_received`), include the differentiating fields in `required_paths`.
- If your webhook body is byte-identical to an existing REST resource shape (Recharge's webhook subscription body matches its single-resource REST response), beef up `optional_paths` with fields that are commonly present in webhook payloads. Otherwise the REST endpoint wins the tiebreaker and the body gets the wrong label (the obfuscation is still correct, just mislabeled).

## Form-encoded webhooks (Twilio, Braintree)

The engine accepts `application/x-www-form-urlencoded` bodies in addition to JSON and XML. Two shapes are auto-detected:

- **Twilio**: flat `Key1=value1&Key2=value2&...` body. Parsed to a single-level JS object preserving the original key order; field maps target the keys directly (`MessageSid`, `From`, `Body`, …).
- **Braintree**: outer `bt_signature=…&bt_payload=<base64 XML>` body. The engine extracts `bt_payload`, base64-decodes (UTF-8-safe), and parses the inner XML notification document. Field maps target the parsed XML tree using fast-xml-parser's verbatim tag names (kebab-case: `source-merchant-id`, `created-at.#text`, etc.).

For Braintree, the engine remembers which wrapper the user pasted (form body / decoded XML / bare base64) and serializes back to the same shape so the round-trip diff stays clean. Note that the obfuscated `bt_signature` is replaced with a placeholder string — obfuscation invalidates the SHA1-HMAC the original was computed over.

If you're adding a Braintree YAML, two quirks to watch:
- Tags with an XML attribute (`<timestamp type="datetime">…</timestamp>`) parse to `{ "@_type": "datetime", "#text": "…" }`. The text value lives under `#text`, so your field-map path is `timestamp.#text` (and `timestamp.@_type` should be `preserve`).
- `<transactions type="array"><transaction>…</transaction></transactions>` with a single child collapses to a single object, not an array. Real Braintree subscription/transaction notifications nearly always have exactly one child, so `subject.subscription.transactions.transaction.id` is the canonical path. Multi-transaction arrays fall through to the `*: auto` catch-all.

## GraphQL field maps

GraphQL responses are JSON-wrapped under a `data` envelope, so the engine handles them with no parser changes. Conventions for adding a GraphQL YAML:

- **Filename**: `providers/<id>/endpoints/graphql-<operation-slug>.yaml`. Example: `graphql-admin-orders.yaml`.
- **`endpoint.path`**: include the actual GraphQL endpoint URL plus a parenthetical operation name, e.g. `/admin/api/2024-10/graphql.json (query orders)`. The path is for human readability — auto-detection runs via signature, not URL match.
- **Signature paths** use `data.<rootField>.<characteristic>` notation. For paginated connections, use `data.<root>.edges[].node.<field>` and `data.<root>.pageInfo.hasNextPage` to lock in the connection shape.
- **`extensions.cost.*`** (Shopify) is always `preserve` — quota metadata, not PII.
- **GIDs** (`gid://shopify/Order/123…`) are `{ type: id, anchor: true }`.
- **MoneyBag fields** have both `shopMoney` and `presentmentMoney` branches; spec both. The `.amount` field is `priceAmount`; `.currencyCode` is `preserve`.
- **`userErrors[].message`** (mutation responses) can echo back submitted PII (e.g. `"Email user@example.com is already taken"`). Type as `shortText`, not `preserve`.
- **`customAttributes[].value`** is free-form input — type as `shortText`.
- **`tags`** is an array of merchant-defined strings — `preserve` (rare to be PII).

### Salesforce GraphQL — the `{ value }` wrapper convention

Every scalar in a Salesforce GraphQL response is returned as `{ value: T }`, not as a bare value. Foreign-key fields add a `displayValue` sibling (the related record's `Name`). Field-map paths must reflect this:

```yaml
# Bare scalar (Salesforce's `Id`, `CreatedDate`, `LastModifiedDate`, `SystemModstamp`)
"data.uiapi.query.Contact.edges[].node.Id":            { type: id, anchor: true }
"data.uiapi.query.Contact.edges[].node.CreatedDate":   { type: isoDate }

# Wrapped scalar (everything else)
"data.uiapi.query.Contact.edges[].node.Email.value":   { type: email, anchor: true }

# FK with displayValue
"data.uiapi.query.Contact.edges[].node.AccountId.value":        { type: id, anchor: true }
"data.uiapi.query.Contact.edges[].node.AccountId.displayValue": { type: company }

# Compound address — children also `{ value }`-wrapped
"data.uiapi.query.Contact.edges[].node.MailingAddress.City.value": { type: city }
```

Address compound field names vary by SObject: Account uses `BillingAddress`/`ShippingAddress`, Contact uses `MailingAddress`/`OtherAddress`, Lead uses bare `Address`, Case has no address (uses `Supplied{Name,Email,Phone,Company}` instead). Always end the field map with `"*": { type: auto }` because field-level permission denials cause silent field absence.

### Known limitation: GraphQL aliases

GraphQL clients can rename response fields with aliases (`myOrder: order(id: ...) { ... }` returns `data.myOrder.*` instead of `data.order.*`). The current matcher uses literal path names and won't recognize aliased responses. Workaround: paste responses from canonical (unaliased) queries. Document this in any user-facing GraphQL guidance.

## CSV field maps

CSV exports parse to an array of row-objects keyed by the header column names. Field-map paths use `[].Column Name` notation, quoted in YAML because of spaces and parentheses:

```yaml
endpoint:
  method: GET
  path: /dashboard/customers.csv     # human-readable label; no URL match
  description: <Tool> → <Export name>

signature:
  required_paths:
    - "[].id"
    - "[].Email"
    - "[].Created (UTC)"             # spaces/parens require quoting

fields:
  "[].id":            { type: id, anchor: true }
  "[].Email":         { type: email, anchor: true }
  "[].Created (UTC)": { type: isoDate }
  "*": { type: auto }
```

Conventions:

- Capture column names from a **real export** at a specific date; note that date in the `description` so future contributors know what to diff against. Stripe, Shopify, and others change column sets without warning.
- CSV is detected by a heuristic: first two non-empty lines share a comma/tab/semicolon count (RFC 4180 quoting respected, so `"Smith, John"` doesn't inflate the count). Tab and semicolon delimiters are auto-detected too.
- The serializer preserves your original delimiter, line ending (LF/CRLF), and column order so the obfuscated output round-trips back to the same shape.
- Use `priceAmount` for numeric money columns (`Total Spend`), `sku` for short stable identifiers (`Card Last 4`), and `id` + `anchor: true` for primary keys.

## NDJSON field maps

NDJSON parses to an array of JSON objects (one per line). The matcher treats it as a bare array; signature paths use `[].field` notation:

```yaml
signature:
  required_paths:
    - "[].id"
    - "[].object"
    - "[].created"

fields:
  "[].id":      { type: id, anchor: true }
  "[].object":  { type: preserve }
  "*": { type: auto }
```

Most NDJSON pastes will route through whichever YAML already matches the per-line shape (a Stripe `customer` line lands on the Sigma export YAML, a SendGrid event line on the SendGrid webhook event YAML, etc.). You typically only need a new NDJSON-specific YAML when:

- The per-line shape doesn't match any existing endpoint (e.g. a custom export from your warehouse), or
- The provider has an export-specific shape that differs from its API (e.g. Stripe Sigma is bare-array; the REST list endpoint wraps in `{ data: [...], has_more }`).

The serializer emits one JSON object per line, no trailing newline.

## Reporting a bug in an existing field map

If a real response from a supported endpoint comes back with PII leaked or shape broken, open a [field map bug](./.github/ISSUE_TEMPLATE/field-map-bug.md). Include a sanitized example of the input and the unexpected output.
