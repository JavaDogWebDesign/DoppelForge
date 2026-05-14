import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import yaml from "js-yaml";
import { bestMatch } from "../src/engine/Matcher.ts";
import { parseInput } from "../src/engine/xml.ts";

const here = dirname(fileURLToPath(import.meta.url));
const providersRoot = resolve(here, "../../providers");
const files = readdirSync(providersRoot)
  .map((p) => join(providersRoot, p, "endpoints"))
  .filter((d) => {
    try { return readdirSync(d).length > 0; } catch { return false; }
  })
  .flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".yaml")).map((f) => join(d, f)));

const endpoints = files.map((f) => {
  const text = readFileSync(f, "utf8");
  const d = yaml.load(text);
  const m = f.match(/providers\/([^/]+)\/endpoints\/([^/]+)\.yaml$/);
  return {
    id: `${m[1]}/${m[2]}`,
    providerId: m[1],
    endpoint: d.endpoint,
    signature: d.signature ?? { required_paths: [] },
    fields: d.fields ?? {},
  };
});

console.log(`Loaded ${endpoints.length} endpoints across ${new Set(endpoints.map((e) => e.providerId)).size} providers\n`);

function show(label, resp) {
  // Accept either pre-parsed JSON objects (legacy fixtures) or raw strings
  // (Phase 2 form-encoded / XML wire bodies that need parseInput to exercise
  // the detection + parsing pipeline the live app uses).
  const data = typeof resp === "string" ? parseInput(resp).data : resp;
  const m = bestMatch(data, endpoints);
  if (!m) console.log(`${label} → no match`);
  else console.log(`${label} → ${m.endpoint.providerId}/${m.endpoint.endpoint.path}  (score=${m.score.toFixed(2)})`);
}

show("Stripe customer list", {
  object: "list", url: "/v1/customers", has_more: false,
  data: [{ id: "cus_x", object: "customer", email: "j@x.com", created: 1721000000 }],
});

show("Shopify customer list", {
  customers: [{ id: 1, email: "a@b.com", admin_graphql_api_id: "gid://shopify/Customer/1", first_name: "A" }],
});

show("Twilio messages", {
  messages: [{ sid: "SM1", account_sid: "AC1", from: "+15555550000", to: "+15555550001", body: "hi" }],
  page: 0,
});

show("HubSpot contacts", {
  results: [{ id: "551", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-02T00:00:00Z",
    properties: { email: "t@h.com", firstname: "J", hs_object_id: "551" } }],
  paging: { next: { after: "552", link: "..." } },
});

show("Braintree transaction", {
  id: "fake123", type: "sale", status: "settled",
  amount: "10.00", currency_iso_code: "USD", merchant_account_id: "m1",
});

show("Recharge customers", {
  customers: [{ id: 1, email: "a@b.com", created_at: "2024-01-01", subscriptions_active_count: 2 }],
});

show("Piano user list", {
  code: 0, ts: 1721000000, total: 1, users: [
    { uid: "uXyZ", email: "p@p.com", first_name: "Pi" },
  ],
});

show("BigCommerce customers", {
  data: [{ id: 1, email: "x@y.com", first_name: "X" }],
  meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } },
});

// --- Webhook fixtures ---

show("Stripe webhook charge.succeeded", {
  id: "evt_1", object: "event", api_version: "2024-04-10", created: 1721000000,
  livemode: false, pending_webhooks: 1, type: "charge.succeeded",
  request: { id: "req_1", idempotency_key: null },
  data: { object: {
    id: "ch_1", object: "charge", amount: 2000, amount_captured: 2000, amount_refunded: 0,
    currency: "usd", customer: "cus_1", payment_intent: "pi_1", status: "succeeded",
    billing_details: { email: "buyer@example.com", name: "Jane Buyer", phone: "+15555555555",
      address: { city: "Portland", country: "US", line1: "1 Main St", postal_code: "97201", state: "OR" } },
    receipt_url: "https://pay.stripe.com/receipts/abc",
  } },
});

show("Stripe webhook payment_intent.succeeded", {
  id: "evt_2", object: "event", api_version: "2024-04-10", created: 1721000000,
  livemode: false, pending_webhooks: 1, type: "payment_intent.succeeded",
  request: { id: "req_2", idempotency_key: null },
  data: { object: {
    id: "pi_2", object: "payment_intent", amount: 2000, amount_capturable: 0, amount_received: 2000,
    capture_method: "automatic", client_secret: "pi_2_secret_x", currency: "usd",
    customer: "cus_2", latest_charge: "ch_2", status: "succeeded",
    receipt_email: "buyer@example.com",
  } },
});

show("Stripe webhook customer.subscription.created", {
  id: "evt_3a", object: "event", api_version: "2024-04-10", created: 1721000000,
  livemode: false, pending_webhooks: 1, type: "customer.subscription.created",
  request: { id: "req_3a", idempotency_key: null },
  data: {
    object: {
      id: "sub_new", object: "subscription", customer: "cus_3", status: "active",
      created: 1721000000, start_date: 1721000000,
      current_period_start: 1721000000, current_period_end: 1723678400,
      billing_cycle_anchor: 1721000000, collection_method: "charge_automatically",
      cancel_at_period_end: false, default_payment_method: "pm_3",
      items: { object: "list", has_more: false, url: "/v1/subscription_items",
        data: [{ id: "si_new", object: "subscription_item",
          price: { id: "price_1", object: "price", active: true, currency: "usd", product: "prod_1", unit_amount: 2000 },
          quantity: 1, subscription: "sub_new" }] },
    },
    // .created has NO previous_attributes — Stripe wire format
  },
});

show("Stripe webhook customer.subscription.updated", {
  id: "evt_3", object: "event", api_version: "2024-04-10", created: 1721000000,
  livemode: false, pending_webhooks: 1, type: "customer.subscription.updated",
  request: { id: "req_3", idempotency_key: null },
  data: {
    object: {
      id: "sub_3", object: "subscription", customer: "cus_3", status: "active",
      current_period_start: 1720000000, current_period_end: 1722000000,
      cancel_at_period_end: false, latest_invoice: "in_3",
      items: { object: "list", has_more: false, url: "/v1/subscription_items",
        data: [{ id: "si_1", object: "subscription_item",
          price: { id: "price_1", object: "price", active: true, currency: "usd", product: "prod_1", unit_amount: 2000 },
          quantity: 1, subscription: "sub_3" }] },
    },
    previous_attributes: { status: "past_due" },
  },
});

show("Stripe webhook customer.subscription.deleted", {
  id: "evt_3b", object: "event", api_version: "2024-04-10", created: 1722000100,
  livemode: false, pending_webhooks: 1, type: "customer.subscription.deleted",
  request: { id: "req_3b", idempotency_key: null },
  data: {
    object: {
      id: "sub_3", object: "subscription", customer: "cus_3", status: "canceled",
      created: 1720000000, start_date: 1720000000,
      current_period_start: 1720000000, current_period_end: 1722000000,
      cancel_at_period_end: false, canceled_at: 1722000100, ended_at: 1722000100,
      cancellation_details: { reason: "cancellation_requested", feedback: "too_expensive", comment: "Saving money" },
      items: { object: "list", has_more: false, url: "/v1/subscription_items",
        data: [{ id: "si_1", object: "subscription_item",
          price: { id: "price_1", object: "price", active: true, currency: "usd", product: "prod_1", unit_amount: 2000 },
          quantity: 1, subscription: "sub_3" }] },
    },
    previous_attributes: { status: "active", ended_at: null, canceled_at: null },
  },
});

show("Stripe webhook invoice.payment_succeeded", {
  id: "evt_4", object: "event", api_version: "2024-04-10", created: 1721000000,
  livemode: false, pending_webhooks: 1, type: "invoice.payment_succeeded",
  request: { id: "req_4", idempotency_key: null },
  data: { object: {
    id: "in_4", object: "invoice", amount_due: 2000, amount_paid: 2000, amount_remaining: 0,
    billing_reason: "subscription_cycle", currency: "usd", customer: "cus_4",
    customer_email: "buyer@example.com", customer_name: "Jane Buyer", number: "ABCD-0001",
    status: "paid", subscription: "sub_4", total: 2000,
    hosted_invoice_url: "https://invoice.stripe.com/i/abc", invoice_pdf: "https://pay.stripe.com/invoice/abc/pdf",
  } },
});

show("Stripe webhook checkout.session.completed", {
  id: "evt_6", object: "event", api_version: "2024-10-28.acacia", created: 1731510245,
  livemode: false, pending_webhooks: 1, type: "checkout.session.completed",
  request: { id: "req_6", idempotency_key: null },
  data: { object: {
    id: "cs_test_a1b2c3", object: "checkout.session",
    amount_subtotal: 2000, amount_total: 2000, currency: "usd",
    customer: "cus_X", customer_email: "buyer@example.com",
    customer_details: {
      email: "buyer@example.com", name: "Jane Buyer", phone: "+15555555555",
      tax_exempt: "none", tax_ids: [],
      address: { city: "Portland", country: "US", line1: "1 Main St", postal_code: "97201", state: "OR" },
    },
    expires_at: 1731600000, mode: "payment", payment_intent: "pi_X",
    payment_method_types: ["card"], payment_status: "paid", status: "complete",
    success_url: "https://example.com/success", url: null, client_reference_id: "order_42",
  } },
});

show("Stripe webhook charge.dispute.created", {
  id: "evt_7", object: "event", api_version: "2024-10-28.acacia", created: 1731510245,
  livemode: false, pending_webhooks: 1, type: "charge.dispute.created",
  request: { id: "req_7", idempotency_key: null },
  data: { object: {
    id: "dp_1", object: "dispute", amount: 2000, charge: "ch_1", currency: "usd",
    is_charge_refundable: true, reason: "fraudulent", status: "warning_needs_response",
    payment_intent: "pi_1", created: 1731510244,
    balance_transactions: [{ id: "txn_d1", object: "balance_transaction",
      amount: -2000, fee: 1500, net: -3500, currency: "usd", available_on: 1731600000,
      created: 1731510244, status: "available", type: "adjustment" }],
    evidence: {
      customer_email_address: "buyer@example.com",
      customer_name: "Jane Buyer",
      customer_purchase_ip: "203.0.113.42",
      product_description: "Widget — premium edition",
      shipping_address: "1 Main St, Portland OR 97201",
      shipping_carrier: "USPS",
      shipping_tracking_number: "9400111899223197428490",
    },
    evidence_details: { due_by: 1732000000, has_evidence: false, past_due: false, submission_count: 0 },
  } },
});

show("Stripe webhook payment_method.attached", {
  id: "evt_8", object: "event", api_version: "2024-10-28.acacia", created: 1731510245,
  livemode: false, pending_webhooks: 1, type: "payment_method.attached",
  request: { id: "req_8", idempotency_key: null },
  data: { object: {
    id: "pm_1", object: "payment_method", type: "card", allow_redisplay: "unspecified",
    customer: "cus_X", created: 1731510244, livemode: false,
    billing_details: {
      email: "buyer@example.com", name: "Jane Buyer", phone: "+15555555555",
      address: { city: "Portland", country: "US", line1: "1 Main St", postal_code: "97201", state: "OR" },
    },
    card: { brand: "visa", country: "US", exp_month: 12, exp_year: 2030,
      fingerprint: "fp_abc", funding: "credit", last4: "4242", display_brand: "visa",
      checks: { address_line1_check: "pass", address_postal_code_check: "pass", cvc_check: "pass" },
      networks: { available: ["visa"], preferred: null },
      three_d_secure_usage: { supported: true } },
  } },
});

show("Stripe webhook refund.created", {
  id: "evt_9", object: "event", api_version: "2024-10-28.acacia", created: 1731510245,
  livemode: false, pending_webhooks: 1, type: "refund.created",
  request: { id: "req_9", idempotency_key: null },
  data: { object: {
    id: "re_1", object: "refund", amount: 2000, balance_transaction: "txn_r1",
    charge: "ch_1", created: 1731510244, currency: "usd",
    payment_intent: "pi_1", reason: "requested_by_customer",
    receipt_number: "1234-5678", status: "succeeded",
    destination_details: { type: "card", card: { reference: "abc123", reference_status: "available", reference_type: "acquirer_reference_number" } },
  } },
});

show("Stripe webhook setup_intent.succeeded", {
  id: "evt_10", object: "event", api_version: "2024-10-28.acacia", created: 1731510245,
  livemode: false, pending_webhooks: 1, type: "setup_intent.succeeded",
  request: { id: "req_10", idempotency_key: null },
  data: { object: {
    id: "seti_1", object: "setup_intent",
    client_secret: "seti_1_secret_abc", customer: "cus_X", payment_method: "pm_1",
    usage: "off_session", status: "succeeded", flow_directions: ["inbound"],
    attach_to_self: false, created: 1731510244, livemode: false,
    payment_method_types: ["card"], automatic_payment_methods: { enabled: true, allow_redirects: "always" },
  } },
});

show("Stripe webhook payout.paid", {
  id: "evt_11", object: "event", api_version: "2024-10-28.acacia", created: 1731510245,
  livemode: false, pending_webhooks: 1, type: "payout.paid",
  request: { id: "req_11", idempotency_key: null },
  data: { object: {
    id: "po_1", object: "payout", amount: 12000, currency: "usd",
    arrival_date: 1731600000, automatic: true, balance_transaction: "txn_p1",
    created: 1731510244, description: "STRIPE PAYOUT", destination: "ba_1",
    method: "standard", reconciliation_status: "completed",
    source_type: "card", statement_descriptor: "EXAMPLE CO", status: "paid",
    type: "bank_account", livemode: false,
  } },
});

show("Stripe webhook customer.created", {
  id: "evt_5", object: "event", api_version: "2024-04-10", created: 1721000000,
  livemode: false, pending_webhooks: 1, type: "customer.created",
  request: { id: "req_5", idempotency_key: null },
  data: { object: {
    id: "cus_5", object: "customer", email: "new@example.com", name: "New Customer",
    phone: "+15555555555", balance: 0, currency: "usd", delinquent: false,
    invoice_prefix: "ABC123", tax_exempt: "none",
    address: { city: "Portland", country: "US", line1: "1 Main St", postal_code: "97201", state: "OR" },
  } },
});

// --- Phase 2: form-encoded Twilio + Braintree XML pipelines ---

show(
  "Twilio webhook incoming-sms (raw form)",
  "MessageSid=SM1234567890abcdef1234567890abcd01&SmsSid=SM1234567890abcdef1234567890abcd01&AccountSid=XX1234567890abcdef1234567890abcd01&From=%2B14017122661&To=%2B15558675310&Body=Ahoy%21+Let%27s+build+something+amazing.&NumMedia=0&NumSegments=1&FromCity=SAN+FRANCISCO&FromState=CA&FromZip=94103&FromCountry=US&ToCity=SAUSALITO&ToState=CA&ToZip=94965&ToCountry=US",
);

show(
  "Twilio webhook sms-status-callback (raw form)",
  "MessageSid=SM1234567890abcdef1234567890abcd02&SmsSid=SM1234567890abcdef1234567890abcd02&MessageStatus=delivered&SmsStatus=delivered&AccountSid=XX1234567890abcdef1234567890abcd01&From=%2B15558675310&To=%2B14017122661&ApiVersion=2010-04-01&RawDlrDoneDate=2511131245",
);

show(
  "Twilio webhook incoming-voice (raw form)",
  "CallSid=CA1234567890abcdef1234567890abcd03&AccountSid=XX1234567890abcdef1234567890abcd01&From=%2B16175551212&To=%2B15558675310&CallStatus=ringing&ApiVersion=2010-04-01&Direction=inbound&Caller=%2B16175551212&Called=%2B15558675310&FromCity=BOSTON&FromState=MA&FromZip=02101&FromCountry=US&ToCity=SAUSALITO&ToState=CA&ToZip=94965&ToCountry=US",
);

show(
  "Twilio webhook voice-status-callback (raw form)",
  "CallSid=CA1234567890abcdef1234567890abcd03&AccountSid=XX1234567890abcdef1234567890abcd01&From=%2B16175551212&To=%2B15558675310&CallStatus=completed&ApiVersion=2010-04-01&Direction=inbound&CallDuration=37&Timestamp=Wed%2C+13+May+2026+12%3A34%3A56+%2B0000&CallbackSource=call-progress-events&SequenceNumber=0",
);

show(
  "Twilio webhook recording-status-callback (raw form)",
  "AccountSid=XX1234567890abcdef1234567890abcd01&CallSid=CA1234567890abcdef1234567890abcd03&RecordingSid=RE1234567890abcdef1234567890abcd04&RecordingUrl=https%3A%2F%2Fapi.twilio.com%2F2010-04-01%2FAccounts%2FXX1234567890abcdef1234567890abcd01%2FRecordings%2FRE1234567890abcdef1234567890abcd04&RecordingStatus=completed&RecordingDuration=37&RecordingChannels=1&RecordingStartTime=2026-05-13T12%3A34%3A19Z&RecordingSource=RecordingStatusCallback&RecordingTrack=both",
);

show(
  "Braintree webhook subscription_charged_successfully (decoded XML)",
  `<?xml version="1.0" encoding="UTF-8"?>
<notification>
  <timestamp type="datetime">2026-05-13T12:34:56Z</timestamp>
  <kind>subscription_charged_successfully</kind>
  <source-merchant-id>msrc_abc123</source-merchant-id>
  <subject>
    <subscription>
      <id>sub_test_001</id>
      <plan-id>monthly_plan</plan-id>
      <status>Active</status>
      <price>49.99</price>
      <balance>0.00</balance>
      <next-billing-date>2026-06-13</next-billing-date>
      <payment-method-token>tok_abc123</payment-method-token>
      <transactions type="array">
        <transaction>
          <id>txn_001</id>
          <status>submitted_for_settlement</status>
          <amount>49.99</amount>
          <currency-iso-code>USD</currency-iso-code>
          <merchant-account-id>macct_001</merchant-account-id>
          <payment-instrument-type>credit_card</payment-instrument-type>
        </transaction>
      </transactions>
      <add_ons type="array"></add_ons>
      <discounts type="array"></discounts>
    </subscription>
  </subject>
</notification>`,
);

show(
  "Braintree webhook transaction_settled (decoded XML)",
  `<?xml version="1.0" encoding="UTF-8"?>
<notification>
  <timestamp type="datetime">2026-05-13T12:34:56Z</timestamp>
  <kind>transaction_settled</kind>
  <subject>
    <transaction>
      <id>txn_002</id>
      <type>sale</type>
      <status>settled</status>
      <amount>129.50</amount>
      <currency-iso-code>USD</currency-iso-code>
      <merchant-account-id>macct_001</merchant-account-id>
      <order-id>order_42</order-id>
      <payment-instrument-type>credit_card</payment-instrument-type>
      <processor-response-code>1000</processor-response-code>
      <processor-response-text>Approved</processor-response-text>
      <customer>
        <id>cust_001</id>
        <first-name>Jane</first-name>
        <last-name>Buyer</last-name>
        <email>jane.buyer@example.com</email>
        <phone>+15555550100</phone>
      </customer>
      <billing>
        <first-name>Jane</first-name>
        <last-name>Buyer</last-name>
        <street-address>1 Main St</street-address>
        <locality>Portland</locality>
        <region>OR</region>
        <postal-code>97201</postal-code>
        <country-code-alpha2>US</country-code-alpha2>
      </billing>
      <credit-card>
        <token>cc_tok_001</token>
        <bin>411111</bin>
        <last-4>1111</last-4>
        <cardholder-name>Jane Buyer</cardholder-name>
        <card-type>Visa</card-type>
        <expiration-month>12</expiration-month>
        <expiration-year>2030</expiration-year>
        <masked-number>411111******1111</masked-number>
      </credit-card>
    </transaction>
  </subject>
</notification>`,
);

show(
  "Braintree webhook subscription_charged_successfully (bare base64)",
  "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPG5vdGlmaWNhdGlvbj4KICA8dGltZXN0YW1wIHR5cGU9ImRhdGV0aW1lIj4yMDI2LTA1LTEzVDEyOjM0OjU2WjwvdGltZXN0YW1wPgogIDxraW5kPnN1YnNjcmlwdGlvbl9jaGFyZ2VkX3N1Y2Nlc3NmdWxseTwva2luZD4KICA8c291cmNlLW1lcmNoYW50LWlkPm1zcmNfYmFyZTY0PC9zb3VyY2UtbWVyY2hhbnQtaWQ+CiAgPHN1YmplY3Q+CiAgICA8c3Vic2NyaXB0aW9uPgogICAgICA8aWQ+c3ViX2JhcmU2NF8wMDE8L2lkPgogICAgICA8cGxhbi1pZD5tb250aGx5X3BsYW48L3BsYW4taWQ+CiAgICAgIDxzdGF0dXM+QWN0aXZlPC9zdGF0dXM+CiAgICAgIDxwcmljZT40OS45OTwvcHJpY2U+CiAgICAgIDxiYWxhbmNlPjAuMDA8L2JhbGFuY2U+CiAgICAgIDxuZXh0LWJpbGxpbmctZGF0ZT4yMDI2LTA2LTEzPC9uZXh0LWJpbGxpbmctZGF0ZT4KICAgICAgPHBheW1lbnQtbWV0aG9kLXRva2VuPnRva19iYXJlNjQ8L3BheW1lbnQtbWV0aG9kLXRva2VuPgogICAgICA8dHJhbnNhY3Rpb25zIHR5cGU9ImFycmF5Ij48dHJhbnNhY3Rpb24+PGlkPnR4bl9iYXJlNjQ8L2lkPjxzdGF0dXM+c3VibWl0dGVkX2Zvcl9zZXR0bGVtZW50PC9zdGF0dXM+PGFtb3VudD40OS45OTwvYW1vdW50PjxjdXJyZW5jeS1pc28tY29kZT5VU0Q8L2N1cnJlbmN5LWlzby1jb2RlPjxtZXJjaGFudC1hY2NvdW50LWlkPm1hY2N0XzAwMTwvbWVyY2hhbnQtYWNjb3VudC1pZD48cGF5bWVudC1pbnN0cnVtZW50LXR5cGU+Y3JlZGl0X2NhcmQ8L3BheW1lbnQtaW5zdHJ1bWVudC10eXBlPjwvdHJhbnNhY3Rpb24+PC90cmFuc2FjdGlvbnM+CiAgICAgIDxhZGRfb25zIHR5cGU9ImFycmF5Ij48L2FkZF9vbnM+CiAgICAgIDxkaXNjb3VudHMgdHlwZT0iYXJyYXkiPjwvZGlzY291bnRzPgogICAgPC9zdWJzY3JpcHRpb24+CiAgPC9zdWJqZWN0Pgo8L25vdGlmaWNhdGlvbj4=",
);

show(
  "Braintree webhook dispute_opened (decoded XML)",
  `<?xml version="1.0" encoding="UTF-8"?>
<notification>
  <timestamp type="datetime">2026-05-13T12:34:56Z</timestamp>
  <kind>dispute_opened</kind>
  <subject>
    <dispute>
      <id>dispute_001</id>
      <case-number>CASE-12345</case-number>
      <reason>fraud</reason>
      <status>Open</status>
      <kind>chargeback</kind>
      <amount-disputed>129.50</amount-disputed>
      <currency-iso-code>USD</currency-iso-code>
      <merchant-account-id>macct_001</merchant-account-id>
      <received-date>2026-05-13</received-date>
      <reply-by-date>2026-05-27</reply-by-date>
      <transaction>
        <id>txn_002</id>
        <amount>129.50</amount>
        <order-id>order_42</order-id>
        <payment-instrument-subtype>Visa</payment-instrument-subtype>
      </transaction>
      <evidence type="array"></evidence>
    </dispute>
  </subject>
</notification>`,
);

show("Shopify webhook orders/create", {
  id: 5001, admin_graphql_api_id: "gid://shopify/Order/5001", name: "#1001",
  financial_status: "paid", total_price: "25.00", email: "buyer@example.com",
  contact_email: "buyer@example.com", currency: "USD", created_at: "2025-01-01T00:00:00Z",
  line_items: [{ id: 9001, product_id: 8001, variant_id: 8002, title: "Widget",
    name: "Widget", sku: "WID-1", quantity: 1, price: "25.00" }],
  customer: { id: 6001, email: "buyer@example.com", first_name: "Jane", last_name: "Buyer" },
  billing_address: { first_name: "Jane", last_name: "Buyer", address1: "1 Main St",
    city: "Portland", province: "OR", country: "United States", zip: "97201" },
});

show("Shopify webhook customers/create", {
  id: 6001, admin_graphql_api_id: "gid://shopify/Customer/6001",
  email: "new@example.com", first_name: "New", last_name: "Customer",
  state: "enabled", verified_email: true, orders_count: 0, total_spent: "0.00",
  created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
  default_address: { id: 1, customer_id: 6001, address1: "1 Main St", city: "Portland",
    province: "OR", country: "United States", zip: "97201", default: true },
});

show("Shopify webhook products/update", {
  id: 7001, admin_graphql_api_id: "gid://shopify/Product/7001",
  title: "Widget", handle: "widget", vendor: "Acme", product_type: "Gadgets",
  status: "active", tags: "new",
  variants: [{ id: 7002, product_id: 7001, sku: "WID-1", price: "25.00",
    inventory_item_id: 7003, inventory_quantity: 10 }],
});

show("Shopify webhook app/uninstalled", {
  id: 8001, name: "Acme Shop", myshopify_domain: "acme.myshopify.com",
  shop_owner: "Jane Owner", email: "owner@example.com",
  domain: "acme.com", plan_name: "basic", plan_display_name: "Basic Shopify",
  iana_timezone: "America/Los_Angeles", currency: "USD", country_code: "US",
});

show("BigCommerce webhook store/order/created", {
  scope: "store/order/created", store_id: "1025646",
  data: { type: "order", id: 250 },
  hash: "a4a2885d6abc", created_at: 1561480838, producer: "stores/abc123",
});

show("BigCommerce webhook store/customer/created", {
  scope: "store/customer/created", store_id: "1025646",
  data: { type: "customer", id: 12345 },
  hash: "b5b3996e7def", created_at: 1561480838, producer: "stores/abc123",
});

show("HubSpot webhook contact.creation", [
  { eventId: 100, subscriptionId: 1, portalId: 99, appId: 1000,
    occurredAt: 1721000000000, subscriptionType: "contact.creation",
    attemptNumber: 0, objectId: 551, changeSource: "CRM_UI" },
]);

show("HubSpot webhook contact.propertyChange", [
  { eventId: 101, subscriptionId: 2, portalId: 99, appId: 1000,
    occurredAt: 1721000000000, subscriptionType: "contact.propertyChange",
    attemptNumber: 0, objectId: 551, changeSource: "CRM_UI", changeFlag: "NEW",
    propertyName: "email", propertyValue: "j@x.com" },
]);

show("Recharge webhook subscription/created", {
  subscription: {
    id: 4001, customer_id: 9001, address_id: 3001, status: "active",
    sku: "WID-MONTHLY", product_title: "Widget Monthly", price: "25.00",
    next_charge_scheduled_at: "2025-02-01T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
  },
});

show("Recharge webhook order/created", {
  order: {
    id: 5001, customer_id: 9001, charge_id: 6001, address_id: 3001,
    status: "success", total_price: "25.00", currency: "USD",
    email: "buyer@example.com",
    billing_address: { first_name: "Jane", last_name: "Buyer", address1: "1 Main St", city: "Portland", zip: "97201" },
    shipping_address: { first_name: "Jane", last_name: "Buyer", address1: "1 Main St", city: "Portland", zip: "97201" },
    line_items: [{ purchase_item_id: 7001, title: "Widget", sku: "WID-1", quantity: 1, total_price: "25.00", unit_price: "25.00" }],
  },
});

show("Recharge webhook charge/created", {
  charge: {
    id: 6001, customer_id: 9001, address_id: 3001, status: "queued",
    total_price: "25.00", payment_processor: "stripe", currency: "USD",
    email: "buyer@example.com",
    billing_address: { first_name: "Jane", last_name: "Buyer", address1: "1 Main St", city: "Portland", zip: "97201" },
    line_items: [{ purchase_item_id: 7001, title: "Widget", sku: "WID-1", quantity: 1, total_price: "25.00", unit_price: "25.00" }],
  },
});

// --- Shopify Admin GraphQL ---

show("Shopify GraphQL orders", {
  data: {
    orders: {
      edges: [{
        cursor: "eyJsYXN0X2lkIjogMTIzfQ==",
        node: {
          id: "gid://shopify/Order/5001",
          name: "#1001",
          email: "buyer@example.com",
          phone: "+15555555555",
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-01T00:00:00Z",
          displayFinancialStatus: "PAID",
          displayFulfillmentStatus: "FULFILLED",
          currencyCode: "USD",
          totalPriceSet: { shopMoney: { amount: "29.95", currencyCode: "USD" }, presentmentMoney: { amount: "29.95", currencyCode: "USD" } },
          customer: { id: "gid://shopify/Customer/6001", email: "buyer@example.com", firstName: "Jane", lastName: "Buyer", displayName: "Jane Buyer" },
          lineItems: { edges: [{ node: { id: "gid://shopify/LineItem/9001", title: "Widget", sku: "WID-1", quantity: 1, vendor: "Acme", originalUnitPriceSet: { shopMoney: { amount: "29.95", currencyCode: "USD" } } } }] },
        },
      }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "eyJsYXN0X2lkIjogMTIzfQ==", endCursor: "eyJsYXN0X2lkIjogMTIzfQ==" },
    },
  },
  extensions: { cost: { requestedQueryCost: 12, actualQueryCost: 5, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 995, restoreRate: 50 } } },
});

show("Shopify GraphQL order", {
  data: {
    order: {
      id: "gid://shopify/Order/5002",
      name: "#1002",
      email: "buyer2@example.com",
      phone: "+15555555556",
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "UNFULFILLED",
      currencyCode: "USD",
      totalPriceSet: { shopMoney: { amount: "49.95", currencyCode: "USD" } },
      customer: { id: "gid://shopify/Customer/6002", email: "buyer2@example.com", firstName: "John", lastName: "Doe", displayName: "John Doe" },
      billingAddress: { firstName: "John", lastName: "Doe", address1: "1 Main St", city: "Portland", province: "Oregon", provinceCode: "OR", zip: "97201", country: "United States", countryCode: "US" },
    },
  },
  extensions: { cost: { requestedQueryCost: 8, actualQueryCost: 3, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 997, restoreRate: 50 } } },
});

show("Shopify GraphQL customer", {
  data: {
    customer: {
      id: "gid://shopify/Customer/6003",
      firstName: "Maria",
      lastName: "Garcia",
      displayName: "Maria Garcia",
      email: "maria@example.com",
      phone: "+15555555557",
      numberOfOrders: 3,
      amountSpent: { amount: "150.00", currencyCode: "USD" },
      verifiedEmail: true,
      taxExempt: false,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
      defaultAddress: { firstName: "Maria", lastName: "Garcia", address1: "1 Main St", city: "Portland", zip: "97201", country: "United States", countryCode: "US" },
    },
  },
  extensions: { cost: { requestedQueryCost: 6, actualQueryCost: 2, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 998, restoreRate: 50 } } },
});

show("Shopify GraphQL customers", {
  data: {
    customers: {
      edges: [{
        cursor: "eyJsYXN0X2lkIjogNjAwMX0=",
        node: {
          id: "gid://shopify/Customer/6004",
          firstName: "Alex",
          lastName: "Smith",
          displayName: "Alex Smith",
          email: "alex@example.com",
          phone: "+15555555558",
          numberOfOrders: 1,
          amountSpent: { amount: "29.95", currencyCode: "USD" },
          verifiedEmail: true,
          taxExempt: false,
        },
      }],
      pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: "eyJsYXN0X2lkIjogNjAwMX0=", endCursor: "eyJsYXN0X2lkIjogNjAwMX0=" },
    },
  },
  extensions: { cost: { requestedQueryCost: 12, actualQueryCost: 5, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 993, restoreRate: 50 } } },
});

show("Shopify GraphQL draftOrders", {
  data: {
    draftOrders: {
      edges: [{
        cursor: "eyJsYXN0X2lkIjogRDF9",
        node: {
          id: "gid://shopify/DraftOrder/7001",
          name: "#D1",
          status: "OPEN",
          email: "lead@example.com",
          phone: "+15555555559",
          note2: "Wholesale inquiry",
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-01T00:00:00Z",
          currencyCode: "USD",
          invoiceUrl: "https://example.myshopify.com/invoices/abc123",
          totalPriceSet: { shopMoney: { amount: "499.00", currencyCode: "USD" } },
          customer: { id: "gid://shopify/Customer/6005", email: "lead@example.com", firstName: "Pat", lastName: "Lead", displayName: "Pat Lead" },
        },
      }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "eyJsYXN0X2lkIjogRDF9", endCursor: "eyJsYXN0X2lkIjogRDF9" },
    },
  },
  extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 4, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 996, restoreRate: 50 } } },
});

show("HubSpot GraphQL contact_collection", {
  data: {
    CRM: {
      contact_collection: {
        total: 1, offset: 0, limit: 100,
        items: [{
          id: "501", hs_object_id: "501",
          createdate: "2025-06-01T00:00:00Z", lastmodifieddate: "2026-04-01T00:00:00Z",
          email: "lead@example.com", firstname: "Lead", lastname: "Person",
          company: "Lead Co", jobtitle: "Buyer", phone: "+15555550001",
          website: "https://lead.example.com", address: "1 Main St",
          city: "Brooklyn", state: "NY", zip: "11211", country: "United States",
          industry: "Software", lifecyclestage: "lead", hs_lead_status: "NEW",
          hubspot_owner_id: "owner_1",
        }],
      },
    },
  },
  extensions: { query_complexity: { used_points: 5, remaining_points: 995 } },
});

show("HubSpot GraphQL company_collection", {
  data: {
    CRM: {
      company_collection: {
        total: 1, offset: 0, limit: 100,
        items: [{
          id: "1001", hs_object_id: "1001",
          createdate: "2025-06-01T00:00:00Z", lastmodifieddate: "2026-04-01T00:00:00Z",
          name: "Acme Inc", domain: "acme.example.com",
          website: "https://acme.example.com", phone: "+15555551000",
          address: "100 Industrial Way", city: "Portland", state: "OR",
          zip: "97201", country: "United States",
          industry: "Manufacturing", numberofemployees: 250,
          annualrevenue: "5000000", lifecyclestage: "customer",
          hubspot_owner_id: "owner_1",
        }],
      },
    },
  },
  extensions: { query_complexity: { used_points: 4, remaining_points: 996 } },
});

show("HubSpot GraphQL deal_collection", {
  data: {
    CRM: {
      deal_collection: {
        total: 1, offset: 0, limit: 100,
        items: [{
          id: "2001", hs_object_id: "2001",
          createdate: "2025-06-01T00:00:00Z", lastmodifieddate: "2026-04-01T00:00:00Z",
          closedate: "2026-06-01T00:00:00Z",
          dealname: "Q2 enterprise deal", dealstage: "qualifiedtobuy",
          pipeline: "default", dealtype: "newbusiness",
          amount: "50000", deal_currency_code: "USD",
          description: "Annual contract for enterprise tier",
          hubspot_owner_id: "owner_1", hs_priority: "high",
        }],
      },
    },
  },
  extensions: { query_complexity: { used_points: 3, remaining_points: 997 } },
});

show("BigCommerce GraphQL customer", {
  data: {
    customer: {
      entityId: 12345, id: "bWNAbWFyaWE6MTIzNDU=",
      email: "maria@example.com", firstName: "Maria", lastName: "Garcia",
      company: "Garcia LLC", phone: "+15555552000", notes: "VIP",
      taxExemptCategory: "", customerGroupId: 2, storeCredit: 0, attributeCount: 0,
      addresses: {
        collectionInfo: { totalItems: 1 },
        pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "Y3Vyc29yOjA=", endCursor: "Y3Vyc29yOjA=" },
        edges: [{
          cursor: "Y3Vyc29yOjA=",
          node: { entityId: 1, firstName: "Maria", lastName: "Garcia",
            company: "Garcia LLC", address1: "1 Main St",
            city: "Portland", stateOrProvince: "OR", postalCode: "97201",
            country: "United States", countryCode: "US", phone: "+15555552000",
            addressType: "residential" },
        }],
      },
      orders: {
        collectionInfo: { totalItems: 1 },
        pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "Y3Vyc29yOjE=", endCursor: "Y3Vyc29yOjE=" },
        edges: [{
          cursor: "Y3Vyc29yOjE=",
          node: { entityId: 250, orderedAt: { utc: "2026-04-01T00:00:00Z" },
            status: { label: "Shipped", value: "Shipped" },
            subtotal: { value: 49.95, currencyCode: "USD" },
            totalIncTax: { value: 54.95, currencyCode: "USD" },
            billingAddress: { firstName: "Maria", lastName: "Garcia",
              address1: "1 Main St", city: "Portland", stateOrProvince: "OR",
              postalCode: "97201", country: "United States", countryCode: "US",
              phone: "+15555552000" } },
        }],
      },
    },
  },
  extensions: { complexity: 12 },
});

show("BigCommerce GraphQL site.cart", {
  data: {
    site: {
      cart: {
        entityId: "cart_abc123", currencyCode: "USD", isTaxIncluded: false,
        locale: "en", createdAt: { utc: "2026-05-13T00:00:00Z" }, updatedAt: { utc: "2026-05-13T00:01:00Z" },
        baseAmount: { value: 49.95, currencyCode: "USD" },
        amount: { value: 49.95, currencyCode: "USD" },
        discountedAmount: { value: 0, currencyCode: "USD" },
        lineItems: {
          totalQuantity: 1,
          physicalItems: [{
            entityId: "li_001", productEntityId: 250, variantEntityId: 350,
            sku: "WID-1", name: "Widget", url: "https://shop.example.com/widget",
            imageUrl: "https://shop.example.com/img/widget.jpg",
            brand: "Acme", quantity: 1, isTaxable: true,
            listPrice: { value: 49.95, currencyCode: "USD" },
            salePrice: { value: 49.95, currencyCode: "USD" },
            extendedListPrice: { value: 49.95, currencyCode: "USD" },
            extendedSalePrice: { value: 49.95, currencyCode: "USD" },
            selectedOptions: [],
          }],
          digitalItems: [], giftCertificates: [],
        },
        discounts: [],
      },
    },
  },
  extensions: { complexity: 8 },
});

show("BigCommerce GraphQL site.products", {
  data: {
    site: {
      products: {
        collectionInfo: { totalItems: 1 },
        pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "Y3Vyc29yOjEwMA==", endCursor: "Y3Vyc29yOjEwMA==" },
        edges: [{
          cursor: "Y3Vyc29yOjEwMA==",
          node: { entityId: 100, id: "cHJvZHVjdDoxMDA=",
            name: "Widget", path: "/widget/", sku: "WID-1",
            brand: { name: "Acme", entityId: 50 },
            description: "<p>A widget.</p>",
            availability: "available",
            availabilityV2: { status: "Available", description: "In stock" },
            inventory: { isInStock: true, aggregated: { availableToSell: 100 } },
            prices: {
              price: { value: 49.95, currencyCode: "USD" },
              basePrice: { value: 49.95, currencyCode: "USD" },
            },
            defaultImage: { url: "https://shop.example.com/img/widget.jpg", altText: "Widget" },
          },
        }],
      },
    },
  },
  extensions: { complexity: 6 },
});

show("Shopify GraphQL customerCreate mutation", {
  data: {
    customerCreate: {
      customer: {
        id: "gid://shopify/Customer/6006",
        firstName: "New",
        lastName: "Customer",
        displayName: "New Customer",
        email: "new.customer@example.com",
        phone: null,
        verifiedEmail: false,
        taxExempt: false,
        tags: [],
        createdAt: "2026-05-13T00:00:00Z",
        updatedAt: "2026-05-13T00:00:00Z",
      },
      userErrors: [],
    },
  },
  extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 10, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 } } },
});

// --- CSV / NDJSON ---

show(
  "Stripe customers CSV export",
  `id,Email,Name,Phone,Description,Created (UTC),Default Card,Card Number,Card Last 4,Card Type,Card Country,Currency,Delinquent,Total Spend
cus_R8xKpLmN3qWvTb,elena.vasquez@gmail.com,Elena Vasquez,+12125551847,Signed up via marketing landing page,2026-04-22T17:34:18Z,card_1Q,4242424242424242,4242,Visa,US,usd,false,49.95
cus_R8xKpLmN3qWvTc,john.doe@example.com,John Doe,+14155553200,Repeat customer,2026-04-23T10:11:12Z,card_2R,5555555555554444,4444,Mastercard,US,usd,false,124.50`,
);

show(
  "Shopify customers CSV export",
  `Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Default Address Company,Default Address Address1,Default Address City,Default Address Province Code,Default Address Country Code,Default Address Zip,Default Address Phone,Phone,Total Spent,Total Orders,Tags
6001,Maria,Garcia,maria@example.com,yes,Garcia LLC,1 Main St,Portland,OR,US,97201,+15555552000,+15555552000,150.00,3,VIP
6002,John,Doe,john@example.com,no,,287 Bedford Avenue,Brooklyn,NY,US,11211,+12125551847,+12125551847,29.95,1,`,
);

show(
  "Stripe customers NDJSON export",
  `{"id":"cus_NDJSON1","object":"customer","email":"a@example.com","name":"Customer A","created":1731000000,"livemode":false}
{"id":"cus_NDJSON2","object":"customer","email":"b@example.com","name":"Customer B","created":1731000001,"livemode":false}
{"id":"cus_NDJSON3","object":"customer","email":"c@example.com","name":"Customer C","created":1731000002,"livemode":false}`,
);

// --- Auth0 ---

show("Auth0 user retrieve", {
  user_id: "auth0|6500abc123def456",
  email: "user@example.com",
  email_verified: true,
  username: "alice",
  name: "Alice Liddell",
  given_name: "Alice",
  family_name: "Liddell",
  nickname: "alice",
  picture: "https://s.gravatar.com/avatar/abc",
  phone_number: "+15555550100",
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
  last_login: "2026-05-10T12:00:00.000Z",
  last_ip: "203.0.113.42",
  logins_count: 42,
  blocked: false,
  identities: [{
    user_id: "6500abc123def456",
    provider: "auth0",
    connection: "Username-Password-Authentication",
    isSocial: false,
  }],
  user_metadata: { plan: "pro" },
  app_metadata: { roles: ["admin"] },
});

show("Auth0 users list", {
  start: 0, limit: 50, length: 2, total: 2,
  users: [
    { user_id: "auth0|u1", email: "u1@example.com", email_verified: true,
      name: "User One", created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
      identities: [{ user_id: "u1", provider: "auth0", connection: "DB", isSocial: false }] },
    { user_id: "auth0|u2", email: "u2@example.com", email_verified: false,
      name: "User Two", created_at: "2025-02-01T00:00:00Z", updated_at: "2025-02-01T00:00:00Z",
      identities: [{ user_id: "u2", provider: "google-oauth2", connection: "google", isSocial: true }] },
  ],
});

show("Auth0 users-by-email", [
  { user_id: "auth0|ube1", email: "search@example.com", email_verified: true,
    name: "Searched User", created_at: "2025-03-01T00:00:00Z", updated_at: "2025-03-01T00:00:00Z",
    identities: [{ user_id: "ube1", provider: "auth0", connection: "DB", isSocial: false }] },
]);

show("Auth0 user logs", [
  { log_id: "log_001", _id: "log_001", date: "2026-05-13T12:00:00Z", type: "s",
    description: "Success Login", user_id: "auth0|u1", user_name: "alice",
    user_agent: "Mozilla/5.0", ip: "203.0.113.42",
    client_id: "client_abc", client_name: "My App",
    connection: "DB", connection_id: "con_001",
    location_info: { country_code: "US", country_name: "United States", city_name: "San Francisco" } },
]);

show("Auth0 password-change ticket", {
  ticket: "https://example.auth0.com/lo/reset?ticket=SECRET_ABC123",
});

show("Auth0 oauth/token", {
  access_token: "eyJhbGciOiJSUzI1NiIs...",
  id_token: "eyJhbGciOiJSUzI1NiIs...",
  refresh_token: "v1.MDjkLA...",
  token_type: "Bearer",
  expires_in: 86400,
  scope: "openid profile email",
});

show("Auth0 userinfo", {
  sub: "auth0|u1",
  email: "user@example.com",
  email_verified: true,
  name: "Alice Liddell",
  given_name: "Alice",
  family_name: "Liddell",
  nickname: "alice",
  picture: "https://s.gravatar.com/avatar/abc",
  locale: "en",
  updated_at: "2026-05-01T00:00:00.000Z",
});

show("Auth0 webhook log-stream", {
  log_id: "log_stream_001",
  data: {
    date: "2026-05-13T12:00:00Z",
    type: "s",
    description: "Success Login",
    tenant_name: "my-tenant",
    user_id: "auth0|u1",
    user_name: "alice",
    user_email: "user@example.com",
    client_id: "client_abc",
    client_name: "My App",
    connection: "DB",
    connection_id: "con_001",
    ip: "203.0.113.42",
    user_agent: "Mozilla/5.0",
    location_info: { country_code: "US", country_name: "United States", city_name: "San Francisco" },
  },
});

// --- SendGrid ---

show("SendGrid contact retrieve", {
  id: "sg_contact_001",
  contact_id: "sg_contact_001",
  email: "marketing@example.com",
  alternate_emails: [],
  first_name: "Marketing",
  last_name: "Person",
  address_line_1: "1 Main St",
  city: "Portland",
  state_province_region: "OR",
  postal_code: "97201",
  country: "United States",
  phone_number_id: "+15555555000",
  list_ids: ["list_001"],
  segment_ids: [],
  created_at: "2025-09-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
  custom_fields: {},
  _metadata: { self: "https://api.sendgrid.com/v3/marketing/contacts/sg_contact_001" },
});

show("SendGrid contacts list", {
  contact_count: 2,
  _metadata: { self: "https://api.sendgrid.com/v3/marketing/contacts" },
  result: [
    { id: "sg_c1", email: "a@example.com", first_name: "A", last_name: "One",
      list_ids: ["list_001"], created_at: "2025-09-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z" },
    { id: "sg_c2", email: "b@example.com", first_name: "B", last_name: "Two",
      list_ids: ["list_001"], created_at: "2025-10-01T00:00:00Z", updated_at: "2026-04-15T00:00:00Z" },
  ],
});

show("SendGrid bounces", [
  { email: "bounce1@example.com", created: 1731000000, reason: "550 5.1.1 User unknown", status: "5.1.1" },
  { email: "bounce2@example.com", created: 1731000100, reason: "550 5.1.1 User unknown", status: "5.1.1" },
]);

show("SendGrid spam reports", [
  { email: "spam1@example.com", created: 1731000000, ip: "203.0.113.50" },
  { email: "spam2@example.com", created: 1731000100, ip: "203.0.113.51" },
]);

show("SendGrid messages search", {
  messages: [{
    msg_id: "sg_msg_abc",
    from_email: "sender@example.com",
    subject: "Your order confirmation",
    to_email: "buyer@example.com",
    status: "delivered",
    opens_count: 1,
    clicks_count: 0,
    last_event_time: "2026-05-13T12:00:00Z",
    api_key_id: "apikey_001",
  }],
});

show("SendGrid mail/send request body", {
  personalizations: [{
    to: [{ email: "buyer@example.com", name: "Jane Buyer" }],
    subject: "Welcome",
    dynamic_template_data: { firstname: "Jane" },
  }],
  from: { email: "noreply@example.com", name: "Example" },
  reply_to: { email: "support@example.com", name: "Support" },
  subject: "Welcome",
  content: [{ type: "text/html", value: "<p>Hello Jane</p>" }],
  template_id: "d-abc123",
  categories: ["welcome"],
});

show("SendGrid webhook event", [
  { email: "buyer@example.com", timestamp: 1731000000, "smtp-id": "<abc.123@sendgrid>",
    event: "delivered", sg_event_id: "sg_evt_001", sg_message_id: "sg_msg_abc",
    category: ["welcome"], ip: "203.0.113.42", useragent: "Mozilla/5.0",
    response: "250 OK", status: "2xx", tls: 1, attempt: "1" },
  { email: "buyer@example.com", timestamp: 1731000060, "smtp-id": "<abc.123@sendgrid>",
    event: "open", sg_event_id: "sg_evt_002", sg_message_id: "sg_msg_abc",
    category: ["welcome"], ip: "203.0.113.42", useragent: "Mozilla/5.0" },
]);

// --- Zendesk ---

show("Zendesk ticket retrieve", {
  ticket: {
    id: 35436,
    url: "https://example.zendesk.com/api/v2/tickets/35436.json",
    external_id: "ahg35h3jh",
    type: "incident", subject: "Help, I can't log in!", raw_subject: "Help, I can't log in!",
    description: "Tried to log in three times and keep getting password reset emails that never arrive.",
    priority: "urgent", status: "open",
    recipient: "support@example.com",
    requester_id: 20978392, submitter_id: 20978392, assignee_id: 18764726,
    organization_id: 509974, group_id: 360002956171,
    collaborator_ids: [], follower_ids: [], email_cc_ids: [],
    is_public: true, has_incidents: false,
    due_at: null, created_at: "2026-05-13T08:30:00Z", updated_at: "2026-05-13T09:15:00Z",
    tags: ["login", "password-reset"], brand_id: 360001846211,
    via: { channel: "email",
      source: { from: { address: "priya@example.com", name: "Priya Ramachandran" },
                to: { address: "support@example.com", name: "Support" }, rel: null } },
    custom_fields: [],
  },
});

show("Zendesk tickets list", {
  tickets: [
    { id: 35436, url: "https://example.zendesk.com/api/v2/tickets/35436.json",
      subject: "Help, I can't log in!", status: "open", priority: "urgent",
      requester_id: 20978392, assignee_id: 18764726, organization_id: 509974,
      created_at: "2026-05-13T08:30:00Z", updated_at: "2026-05-13T09:15:00Z",
      tags: ["login"], brand_id: 360001846211,
      via: { channel: "email", source: { from: { address: "priya@example.com", name: "Priya R" } } } },
  ],
  count: 1, next_page: null, previous_page: null,
});

show("Zendesk user retrieve", {
  user: {
    id: 20978392, url: "https://example.zendesk.com/api/v2/users/20978392.json",
    email: "priya@example.com", name: "Priya Ramachandran", alias: "Priya R",
    phone: "+14155550142", role: "end-user", role_type: 0,
    organization_id: 509974, default_group_id: null,
    locale: "en-US", locale_id: 1, time_zone: "Pacific Time (US & Canada)",
    notes: "VIP customer", details: "",
    photo: null, created_at: "2025-09-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z",
    last_login_at: "2026-05-12T17:34:18Z",
    tags: ["vip"], suspended: false, verified: true, active: true, moderator: false,
    identities: [{ id: 1, user_id: 20978392, type: "email", value: "priya@example.com",
      verified: true, primary: true }],
    user_fields: {},
  },
});

show("Zendesk users list", {
  users: [
    { id: 20978392, url: "https://example.zendesk.com/api/v2/users/20978392.json",
      email: "priya@example.com", name: "Priya Ramachandran", role: "end-user",
      organization_id: 509974, locale: "en-US", time_zone: "Pacific Time (US & Canada)",
      created_at: "2025-09-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z",
      tags: ["vip"], suspended: false, verified: true, active: true, moderator: false },
  ],
  count: 1, next_page: null, previous_page: null,
});

show("Zendesk ticket comments", {
  comments: [
    { id: 1276511668, type: "Comment", author_id: 20978392,
      body: "Tried to log in three times. Help!",
      html_body: "<p>Tried to log in three times. Help!</p>",
      plain_body: "Tried to log in three times. Help!",
      public: true, created_at: "2026-05-13T08:30:00Z",
      audit_id: 5650305007,
      metadata: { system: { client: "Mozilla/5.0", ip_address: "203.0.113.42",
        location: "San Francisco, CA, United States", latitude: 37.7749, longitude: -122.4194 },
        custom: {}, flags: [], flags_options: {} },
      via: { channel: "email", source: { from: { address: "priya@example.com", name: "Priya R" } } },
      attachments: [] },
  ],
  count: 1, next_page: null, previous_page: null,
});

show("Zendesk webhook ticket event", {
  type: "zen:event-type:ticket.created",
  id: "01HK6E2W1T5G3X4Y5Z6A7B8C9D",
  time: "2026-05-13T12:00:00Z",
  subject: "ticket.created",
  account_id: 12345,
  zendesk_event_version: "2022-11-06",
  detail: {
    ticket: {
      id: 35436, url: "https://example.zendesk.com/api/v2/tickets/35436.json",
      subject: "Help, I can't log in!", status: "open", priority: "urgent",
      requester_id: 20978392, assignee_id: null, organization_id: 509974,
      brand_id: 360001846211, tags: [],
      created_at: "2026-05-13T08:30:00Z", updated_at: "2026-05-13T08:30:00Z",
      via: { channel: "email", source: { from: { address: "priya@example.com", name: "Priya R" } } },
    },
  },
  event: {},
});

// --- Square ---

show("Square customer retrieve", {
  customer: {
    id: "JDKYHBWT1D4F8MFH63DBMEN8Y4",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    version: 1,
    email_address: "amelia@example.com",
    given_name: "Amelia", family_name: "Earhart",
    company_name: "Aviation Pioneers Inc",
    phone_number: "+14155553211",
    reference_id: "YOUR_REFERENCE_ID",
    note: "VIP customer",
    creation_source: "DIRECTORY",
    address: { address_line_1: "500 Electric Ave", locality: "San Francisco",
      administrative_district_level_1: "CA", postal_code: "94103", country: "US",
      first_name: "Amelia", last_name: "Earhart" },
    preferences: { email_unsubscribed: false },
  },
});

show("Square customers list", {
  customers: [
    { id: "JDKYHBWT1D4F8MFH63DBMEN8Y4",
      created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z", version: 1,
      email_address: "amelia@example.com", given_name: "Amelia", family_name: "Earhart",
      phone_number: "+14155553211", creation_source: "DIRECTORY" },
  ],
  cursor: "MJUyMTYyMjAxMTI1MzgyMTM2OTI0",
});

show("Square payment retrieve", {
  payment: {
    id: "GQTFp1ZlXdpoOFOetCXKLgdCdkQ7Y",
    created_at: "2026-05-13T16:14:25.069Z",
    updated_at: "2026-05-13T16:14:26.293Z",
    amount_money: { amount: 9000, currency: "USD" },
    total_money: { amount: 9000, currency: "USD" },
    tip_money: { amount: 0, currency: "USD" },
    refunded_money: { amount: 0, currency: "USD" },
    status: "COMPLETED", source_type: "CARD",
    card_details: { status: "CAPTURED", entry_method: "KEYED",
      cvv_status: "CVV_ACCEPTED", avs_status: "AVS_ACCEPTED",
      card: { card_brand: "VISA", last_4: "1111", exp_month: 11, exp_year: 2028,
        fingerprint: "sq-1-Y8tDxQ", card_type: "CREDIT", prepaid_type: "NOT_PREPAID",
        bin: "411111", cardholder_name: "John Doe",
        billing_address: { address_line_1: "500 Electric Ave", locality: "Brooklyn",
          administrative_district_level_1: "NY", postal_code: "11211", country: "US" } } },
    location_id: "L88917AVBK2S5",
    order_id: "y8sLNwsxptIlWvWcXkEFNpVjbHrZY",
    customer_id: "JDKYHBWT1D4F8MFH63DBMEN8Y4",
    receipt_number: "GQTF", receipt_url: "https://squareup.com/receipt/preview/GQTF",
    buyer_email_address: "amelia@example.com",
    version_token: "FfQhQJh9r3VSQIgyWBk1chsPdbbsgRBnXuhPF2Y5tRY6o",
  },
});

show("Square payments list", {
  payments: [{
    id: "GQTFp1ZlXdpoOFOetCXKLgdCdkQ7Y",
    created_at: "2026-05-13T16:14:25Z", updated_at: "2026-05-13T16:14:26Z",
    amount_money: { amount: 9000, currency: "USD" },
    total_money: { amount: 9000, currency: "USD" },
    status: "COMPLETED", source_type: "CARD",
    card_details: { status: "CAPTURED", entry_method: "KEYED",
      card: { card_brand: "VISA", last_4: "1111", exp_month: 11, exp_year: 2028,
        fingerprint: "sq-1-Y8tDxQ", bin: "411111", cardholder_name: "John Doe" } },
    location_id: "L88917AVBK2S5",
    order_id: "y8sLNwsxptIlWvWcXkEFNpVjbHrZY",
    customer_id: "JDKYHBWT1D4F8MFH63DBMEN8Y4",
    receipt_number: "GQTF",
    buyer_email_address: "amelia@example.com",
    version_token: "FfQhQJh9r3VSQIgyWBk1chsPdbbsgRBnXuhPF2Y5tRY6o",
  }],
  cursor: "MJUyMTYyMjAxMTI1MzgyMTM2OTI0",
});

show("Square orders search", {
  orders: [{
    id: "y8sLNwsxptIlWvWcXkEFNpVjbHrZY",
    location_id: "L88917AVBK2S5",
    reference_id: "REF-001",
    customer_id: "JDKYHBWT1D4F8MFH63DBMEN8Y4",
    source: { name: "Square Online", id: "online-store" },
    state: "COMPLETED", version: 4,
    created_at: "2026-05-13T16:00:00Z", updated_at: "2026-05-13T16:14:26Z",
    closed_at: "2026-05-13T16:14:26Z",
    total_money: { amount: 9000, currency: "USD" },
    total_tax_money: { amount: 0, currency: "USD" },
    total_discount_money: { amount: 0, currency: "USD" },
    line_items: [{ uid: "abc123", catalog_object_id: "PROD-1", name: "Widget",
      quantity: "1", base_price_money: { amount: 9000, currency: "USD" },
      gross_sales_money: { amount: 9000, currency: "USD" },
      total_money: { amount: 9000, currency: "USD" } }],
    fulfillments: [{ uid: "fulfillment-1", type: "SHIPMENT", state: "COMPLETED",
      shipment_details: { recipient: { display_name: "Amelia Earhart",
        email_address: "amelia@example.com", phone_number: "+14155553211",
        address: { address_line_1: "500 Electric Ave", locality: "San Francisco",
          administrative_district_level_1: "CA", postal_code: "94103", country: "US" } } } }],
    tenders: [],
  }],
  cursor: "MJUyMTYyMjAxMTI1MzgyMTM2OTI0",
});

show("Square webhook payment.updated", {
  merchant_id: "ME83K8Y2N4M3Z",
  type: "payment.updated",
  event_id: "00000000-1111-2222-3333-444444444444",
  created_at: "2026-05-13T16:14:26Z",
  data: {
    type: "payment",
    id: "GQTFp1ZlXdpoOFOetCXKLgdCdkQ7Y",
    object: {
      payment: {
        id: "GQTFp1ZlXdpoOFOetCXKLgdCdkQ7Y",
        created_at: "2026-05-13T16:14:25Z", updated_at: "2026-05-13T16:14:26Z",
        amount_money: { amount: 9000, currency: "USD" },
        total_money: { amount: 9000, currency: "USD" },
        status: "COMPLETED", source_type: "CARD",
        location_id: "L88917AVBK2S5",
        order_id: "y8sLNwsxptIlWvWcXkEFNpVjbHrZY",
        customer_id: "JDKYHBWT1D4F8MFH63DBMEN8Y4",
        receipt_number: "GQTF",
        buyer_email_address: "amelia@example.com",
        card_details: { status: "CAPTURED", entry_method: "KEYED",
          card: { card_brand: "VISA", last_4: "1111", exp_month: 11, exp_year: 2028,
            fingerprint: "sq-1-Y8tDxQ", cardholder_name: "John Doe" } },
        version_token: "FfQhQJh9r3VSQIgyWBk1chsPdbbsgRBnXuhPF2Y5tRY6o",
      },
    },
  },
});

// --- Mailchimp ---

show("Mailchimp list member retrieve", {
  id: "ec0e60b80ed1a3a1c08ce15a5e5b89e3",
  email_address: "freddie@example.com",
  unique_email_id: "abc123def456",
  contact_id: "9b29adfac0f0e7ee9b3a2dfa5c0e7a3a",
  full_name: "Freddie Chimp",
  web_id: 12345,
  email_type: "html",
  status: "subscribed",
  consent_timestamp: "",
  ip_signup: "203.0.113.42",
  timestamp_signup: "2025-09-01T00:00:00+00:00",
  ip_opt: "203.0.113.42",
  timestamp_opt: "2025-09-01T00:00:00+00:00",
  member_rating: 4,
  last_changed: "2026-04-01T00:00:00+00:00",
  language: "en",
  vip: false,
  email_client: "Gmail",
  list_id: "a1b2c3d4e5",
  source: "API",
  tags_count: 1,
  tags: [{ id: 100, name: "VIP" }],
  location: { latitude: 37.7749, longitude: -122.4194, gmtoff: -8, dstoff: 1,
    country_code: "US", timezone: "America/Los_Angeles", region: "CA" },
  merge_fields: {
    FNAME: "Freddie", LNAME: "Chimp", PHONE: "+14155551212", BIRTHDAY: "01/15",
    ADDRESS: { addr1: "675 Ponce de Leon Ave NE", addr2: "Suite 5000",
      city: "Atlanta", state: "GA", zip: "30308", country: "US" } },
  marketing_permissions: [],
  stats: { avg_open_rate: 0.5, avg_click_rate: 0.2,
    ecommerce_data: { total_revenue: 250.00, number_of_orders: 3, currency_code: "USD" } },
});

show("Mailchimp list members list", {
  members: [{
    id: "ec0e60b80ed1a3a1c08ce15a5e5b89e3",
    email_address: "freddie@example.com",
    unique_email_id: "abc123def456",
    full_name: "Freddie Chimp", web_id: 12345, email_type: "html",
    status: "subscribed", ip_signup: "203.0.113.42",
    timestamp_signup: "2025-09-01T00:00:00+00:00",
    ip_opt: "203.0.113.42", timestamp_opt: "2025-09-01T00:00:00+00:00",
    member_rating: 4, last_changed: "2026-04-01T00:00:00+00:00",
    language: "en", vip: false, email_client: "Gmail",
    list_id: "a1b2c3d4e5", source: "API", tags_count: 0, tags: [],
    location: { country_code: "US", region: "CA" },
    merge_fields: { FNAME: "Freddie", LNAME: "Chimp", PHONE: "+14155551212",
      ADDRESS: { addr1: "675 Ponce de Leon Ave NE", city: "Atlanta",
        state: "GA", zip: "30308", country: "US" } },
  }],
  list_id: "a1b2c3d4e5",
  total_items: 1,
  _links: [{ rel: "self", href: "https://us1.api.mailchimp.com/3.0/lists/a1b2c3d4e5/members", method: "GET" }],
});

show("Mailchimp list retrieve", {
  id: "a1b2c3d4e5",
  web_id: 67890,
  name: "Mailchimp Newsletter",
  contact: { company: "Mailchimp", address1: "675 Ponce de Leon Ave NE",
    address2: "Suite 5000", city: "Atlanta", state: "GA", zip: "30308",
    country: "US", phone: "+14155551212" },
  permission_reminder: "You are receiving this email because you opted in via our website.",
  use_archive_bar: true,
  campaign_defaults: { from_name: "Freddie", from_email: "freddie@example.com",
    subject: "", language: "en" },
  notify_on_subscribe: "",
  notify_on_unsubscribe: "",
  date_created: "2025-01-01T00:00:00+00:00",
  list_rating: 3, email_type_option: false,
  subscribe_url_short: "http://eepurl.com/abc",
  subscribe_url_long: "https://example.us1.list-manage.com/subscribe?u=...",
  beamer_address: "us1-abc123def456-abc@inbound.mailchimp.com",
  visibility: "pub", double_optin: false, has_welcome: false,
  marketing_permissions: false,
  modules: [],
  stats: { member_count: 1525, total_contacts: 1602, unsubscribe_count: 50,
    cleaned_count: 27, member_count_since_send: 12, unsubscribe_count_since_send: 0,
    cleaned_count_since_send: 1, campaign_count: 24,
    campaign_last_sent: "2026-05-01T00:00:00+00:00",
    merge_field_count: 6, avg_sub_rate: 5.0, avg_unsub_rate: 0.2,
    target_sub_rate: 8.0, open_rate: 42.5, click_rate: 10.2,
    last_sub_date: "2026-05-13T08:30:00+00:00",
    last_unsub_date: "2026-05-10T00:00:00+00:00" },
});

show("Mailchimp lists", {
  lists: [{
    id: "a1b2c3d4e5", web_id: 67890, name: "Mailchimp Newsletter",
    contact: { company: "Mailchimp", address1: "675 Ponce de Leon Ave NE",
      city: "Atlanta", state: "GA", zip: "30308", country: "US", phone: "+14155551212" },
    permission_reminder: "You opted in.",
    campaign_defaults: { from_name: "Freddie", from_email: "freddie@example.com",
      subject: "", language: "en" },
    date_created: "2025-01-01T00:00:00+00:00",
    list_rating: 3, email_type_option: false,
    visibility: "pub",
    stats: { member_count: 1525, unsubscribe_count: 50, cleaned_count: 27,
      open_rate: 42.5, click_rate: 10.2 },
  }],
  total_items: 1,
  constraints: { may_create: true, max_instances: 1, current_total_instances: 1, current_total_active_instances: 1 },
});

show("Mailchimp campaigns", {
  campaigns: [{
    id: "abc123def4",
    web_id: 5432,
    type: "regular",
    create_time: "2026-05-01T00:00:00+00:00",
    archive_url: "http://eepurl.com/archive123",
    long_archive_url: "https://us1.campaign-archive.com/?u=abc&id=def",
    status: "sent", emails_sent: 1525,
    send_time: "2026-05-13T08:00:00+00:00",
    content_type: "template", needs_block_refresh: false, resendable: true,
    recipients: { list_id: "a1b2c3d4e5", list_is_active: true,
      list_name: "Mailchimp Newsletter", segment_text: "",
      recipient_count: 1525 },
    settings: { subject_line: "Q2 newsletter", preview_text: "What's new",
      title: "Q2 Newsletter", from_name: "Freddie",
      reply_to: "freddie@example.com", use_conversation: false,
      to_name: "*|FNAME|*", folder_id: "", authenticate: true,
      auto_footer: false, inline_css: false, auto_tweet: false,
      template_id: 1234 },
    tracking: { opens: true, html_clicks: true, text_clicks: false,
      goal_tracking: false, ecommerce360: false },
    report_summary: { opens: 648, unique_opens: 525, open_rate: 0.345,
      clicks: 156, subscriber_clicks: 134, click_rate: 0.088 },
    delivery_status: { enabled: false },
  }],
  total_items: 1,
});

show(
  "Mailchimp webhook subscribe (form-encoded)",
  "type=subscribe&fired_at=2026-05-13+12%3A34%3A56&data%5Bid%5D=ec0e60b80ed1a3a1c08ce15a5e5b89e3&data%5Bemail%5D=freddie%40example.com&data%5Bemail_type%5D=html&data%5Bip_opt%5D=203.0.113.42&data%5Bweb_id%5D=12345&data%5Blist_id%5D=a1b2c3d4e5&data%5Bmerges%5D%5BEMAIL%5D=freddie%40example.com&data%5Bmerges%5D%5BFNAME%5D=Freddie&data%5Bmerges%5D%5BLNAME%5D=Chimp&data%5Bmerges%5D%5BPHONE%5D=%2B14155551212",
);

// --- PayPal ---

show("PayPal order retrieve", {
  id: "5O190127TN364715T",
  status: "COMPLETED",
  intent: "CAPTURE",
  create_time: "2026-05-13T10:00:00Z",
  update_time: "2026-05-13T10:00:30Z",
  payer: {
    payer_id: "QYR5Z8XDVJNXQ",
    email_address: "buyer@example.com",
    name: { given_name: "Jane", surname: "Buyer" },
    phone: { phone_type: "MOBILE", phone_number: { national_number: "14155551111" } },
    address: { address_line_1: "1 Main St", admin_area_2: "San Francisco",
      admin_area_1: "CA", postal_code: "94103", country_code: "US" },
  },
  purchase_units: [{
    reference_id: "PUHF", invoice_id: "INV-001",
    amount: { currency_code: "USD", value: "100.00",
      breakdown: { item_total: { currency_code: "USD", value: "100.00" },
        shipping: { currency_code: "USD", value: "0.00" } } },
    payee: { email_address: "merchant@example.com", merchant_id: "ME83K8Y2N4M3Z" },
    items: [{ name: "Widget", sku: "WID-1", quantity: "1",
      unit_amount: { currency_code: "USD", value: "100.00" } }],
    shipping: { name: { full_name: "Jane Buyer" },
      address: { address_line_1: "1 Main St", admin_area_2: "San Francisco",
        admin_area_1: "CA", postal_code: "94103", country_code: "US" } },
    payments: { captures: [{ id: "3C679366HH908993F", status: "COMPLETED",
      amount: { currency_code: "USD", value: "100.00" },
      create_time: "2026-05-13T10:00:30Z", update_time: "2026-05-13T10:00:30Z" }] },
  }],
  links: [{ href: "https://api.paypal.com/v2/checkout/orders/5O190127TN364715T",
    rel: "self", method: "GET" }],
});

show("PayPal capture retrieve", {
  id: "3C679366HH908993F",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "100.00" },
  invoice_id: "INV-001", custom_id: "CUSTOM-1",
  final_capture: true, disbursement_mode: "INSTANT",
  create_time: "2026-05-13T10:00:30Z", update_time: "2026-05-13T10:00:30Z",
  seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED"] },
  seller_receivable_breakdown: {
    gross_amount: { currency_code: "USD", value: "100.00" },
    paypal_fee: { currency_code: "USD", value: "3.20" },
    net_amount: { currency_code: "USD", value: "96.80" },
  },
  supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
  links: [{ href: "https://api.paypal.com/v2/payments/captures/3C679366HH908993F",
    rel: "self", method: "GET" }],
});

show("PayPal refund retrieve", {
  id: "1JU08902781691411",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "50.00" },
  invoice_id: "INV-001", note_to_payer: "Refund as requested",
  create_time: "2026-05-13T11:00:00Z", update_time: "2026-05-13T11:00:05Z",
  seller_payable_breakdown: {
    gross_amount: { currency_code: "USD", value: "50.00" },
    paypal_fee: { currency_code: "USD", value: "1.60" },
    net_amount: { currency_code: "USD", value: "48.40" },
    total_refunded_amount: { currency_code: "USD", value: "50.00" },
  },
  payer: { email_address: "buyer@example.com", payer_id: "QYR5Z8XDVJNXQ",
    name: { given_name: "Jane", surname: "Buyer" } },
  links: [{ href: "https://api.paypal.com/v2/payments/refunds/1JU08902781691411",
    rel: "self", method: "GET" }],
});

show("PayPal subscription retrieve", {
  id: "I-BW452GLLEP1G",
  plan_id: "P-5ML4271244454362WXNWU5NQ",
  status: "ACTIVE",
  start_time: "2026-04-30T00:00:00Z", create_time: "2026-04-29T23:55:00Z",
  update_time: "2026-04-30T00:00:00Z", quantity: "1",
  shipping_amount: { currency_code: "USD", value: "0.00" },
  subscriber: { payer_id: "QYR5Z8XDVJNXQ", email_address: "subscriber@example.com",
    name: { given_name: "Jane", surname: "Subscriber" },
    shipping_address: { name: { full_name: "Jane Subscriber" },
      address: { address_line_1: "1 Main St", admin_area_2: "San Francisco",
        admin_area_1: "CA", postal_code: "94103", country_code: "US" } } },
  billing_info: { outstanding_balance: { currency_code: "USD", value: "0.00" },
    cycle_executions: [{ tenure_type: "REGULAR", sequence: 1, cycles_completed: 1,
      cycles_remaining: 11, total_cycles: 12 }],
    last_payment: { amount: { currency_code: "USD", value: "10.00" },
      time: "2026-04-30T00:00:00Z" },
    next_billing_time: "2026-05-30T10:00:00Z",
    failed_payments_count: 0 },
  links: [{ href: "https://api.paypal.com/v1/billing/subscriptions/I-BW452GLLEP1G",
    rel: "self", method: "GET" }],
});

show("PayPal invoice retrieve", {
  id: "INV2-ABCD-EFGH-IJKL-MNOP",
  status: "SENT",
  detail: { invoice_number: "0001", reference: "deal-ref", currency_code: "USD",
    note: "Thanks for your business", terms_and_conditions: "Payment due in 30 days",
    invoice_date: "2026-05-13",
    payment_term: { term_type: "NET_30", due_date: "2026-06-12" },
    metadata: { create_time: "2026-05-13T08:00:00Z", last_update_time: "2026-05-13T08:00:00Z",
      created_by_flow: "INVOICE_NEW",
      recipient_view_url: "https://www.paypal.com/invoice/p/#ABCD",
      invoicer_view_url: "https://www.paypal.com/invoice/details/INV2-ABCD" } },
  invoicer: { name: { given_name: "Bill", surname: "Sender" },
    email_address: "merchant@example.com", business_name: "Example Co",
    address: { address_line_1: "100 Industrial Way", admin_area_2: "Portland",
      admin_area_1: "OR", postal_code: "97201", country_code: "US" } },
  primary_recipients: [{
    billing_info: { name: { given_name: "Jane", surname: "Buyer" },
      email_address: "buyer@example.com",
      address: { address_line_1: "1 Main St", admin_area_2: "Brooklyn",
        admin_area_1: "NY", postal_code: "11211", country_code: "US" } } }],
  items: [{ id: "ITEM-1", name: "Widget", quantity: "1",
    unit_amount: { currency_code: "USD", value: "100.00" } }],
  amount: { currency_code: "USD", value: "100.00",
    breakdown: { item_total: { value: "100.00" } } },
  due_amount: { currency_code: "USD", value: "100.00" },
  links: [{ href: "https://api.paypal.com/v2/invoicing/invoices/INV2-ABCD",
    rel: "self", method: "GET" }],
});

show("PayPal webhook PAYMENT.CAPTURE.COMPLETED", {
  id: "WH-2WR32451HC0233532-67976317FL4543714",
  event_version: "1.0",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource_type: "capture", resource_version: "2.0",
  create_time: "2026-05-13T10:00:31Z",
  summary: "Payment completed for $100.00 USD",
  resource: { id: "3C679366HH908993F", status: "COMPLETED",
    amount: { currency_code: "USD", value: "100.00" },
    invoice_id: "INV-001", final_capture: true,
    create_time: "2026-05-13T10:00:30Z", update_time: "2026-05-13T10:00:30Z",
    seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED"] },
    seller_receivable_breakdown: {
      gross_amount: { currency_code: "USD", value: "100.00" },
      paypal_fee: { currency_code: "USD", value: "3.20" },
      net_amount: { currency_code: "USD", value: "96.80" } },
    supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
    links: [{ href: "https://api.paypal.com/v2/payments/captures/3C679366HH908993F",
      rel: "self", method: "GET" }] },
  links: [{ href: "https://api.paypal.com/v1/notifications/webhooks-events/WH-2WR",
    rel: "self", method: "GET" }],
});

// --- Shippo ---

show("Shippo shipment retrieve", {
  object_id: "89436997a794439ab47999701e60392e",
  object_owner: "shippotle@example.com",
  object_created: "2026-05-13T08:00:00Z", object_updated: "2026-05-13T08:00:05Z",
  status: "SUCCESS", test: false,
  shipment_date: "2026-05-13T08:00:00Z",
  address_from: { object_id: "addr_from_1", is_complete: true,
    name: "Sender Person", company: "Sender Co",
    street1: "215 Clayton St", city: "San Francisco",
    state: "CA", zip: "94117", country: "US",
    phone: "+15553419393", email: "sender@example.com", is_residential: false },
  address_to: { object_id: "addr_to_1", is_complete: true,
    name: "Recipient Person", company: "",
    street1: "1 Main St", street2: "Apt 4B",
    city: "Brooklyn", state: "NY", zip: "11211", country: "US",
    phone: "+12125551111", email: "recipient@example.com", is_residential: true },
  parcels: [{ object_id: "parcel_1", length: "5", width: "5", height: "5",
    distance_unit: "in", weight: "2", mass_unit: "lb" }],
  rates: [
    { object_id: "rate_1", amount: "5.50", currency: "USD",
      provider: "USPS",
      servicelevel: { name: "Priority Mail", token: "usps_priority", terms: "" },
      estimated_days: 3, carrier_account: "ca_1" },
    { object_id: "rate_2", amount: "12.30", currency: "USD",
      provider: "FedEx",
      servicelevel: { name: "FedEx 2Day", token: "fedex_2_day", terms: "" },
      estimated_days: 2, carrier_account: "ca_2" },
  ],
});

show("Shippo shipments list", {
  count: 1, next: null, previous: null,
  results: [{
    object_id: "89436997a794439ab47999701e60392e",
    object_owner: "shippotle@example.com",
    object_created: "2026-05-13T08:00:00Z", object_updated: "2026-05-13T08:00:05Z",
    status: "SUCCESS", shipment_date: "2026-05-13T08:00:00Z",
    address_from: { object_id: "addr_from_1", name: "Sender Person",
      street1: "215 Clayton St", city: "San Francisco", state: "CA",
      zip: "94117", country: "US", phone: "+15553419393", email: "sender@example.com" },
    address_to: { object_id: "addr_to_1", name: "Recipient Person",
      street1: "1 Main St", city: "Brooklyn", state: "NY",
      zip: "11211", country: "US", phone: "+12125551111", email: "recipient@example.com" },
    parcels: [{ object_id: "parcel_1", length: "5", width: "5", height: "5", weight: "2" }],
    rates: [{ object_id: "rate_1", amount: "5.50", currency: "USD", provider: "USPS",
      servicelevel: { name: "Priority Mail", token: "usps_priority" },
      estimated_days: 3, carrier_account: "ca_1" }],
  }],
});

show("Shippo rate retrieve", {
  object_id: "ee81fab0372e419ab52245c8952ccaeb",
  object_created: "2026-05-13T08:00:00Z", object_updated: "2026-05-13T08:00:00Z",
  object_owner: "shippotle@example.com",
  shipment: "89436997a794439ab47999701e60392e",
  amount: "5.50", currency: "USD",
  amount_local: "5.50", currency_local: "USD",
  provider: "USPS",
  provider_image_75: "https://shippo-static.s3.amazonaws.com/providers/75/USPS.png",
  provider_image_200: "https://shippo-static.s3.amazonaws.com/providers/200/USPS.png",
  servicelevel: { name: "Priority Mail", token: "usps_priority", terms: "" },
  days: 3, estimated_days: 3,
  duration_terms: "Delivery in 1-3 business days.",
  carrier_account: "ca_1", zone: "1", test: false,
});

show("Shippo transaction retrieve", {
  object_id: "ef8808606f4241ee848aa5990a09933c",
  object_state: "VALID",
  object_created: "2026-05-13T08:00:00Z", object_updated: "2026-05-13T08:00:01Z",
  object_owner: "shippotle@example.com",
  status: "SUCCESS",
  rate: "ee81fab0372e419ab52245c8952ccaeb",
  tracking_number: "9499907123456123456781",
  tracking_status: "TRANSIT",
  tracking_url_provider: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9499907123456123456781",
  label_url: "https://shippo-delivery-east.s3.amazonaws.com/label.pdf",
  label_file_type: "PDF_4x6", test: false, messages: [],
});

show("Shippo track retrieve", {
  carrier: "usps",
  tracking_number: "9499907123456123456781",
  servicelevel: { name: "Priority Mail", token: "usps_priority" },
  eta: "2026-05-15T20:00:00Z",
  tracking_status: { status: "TRANSIT",
    substatus: { code: "out_for_delivery", text: "Out for Delivery" },
    status_details: "Out for delivery", status_date: "2026-05-14T08:30:00Z",
    location: { city: "Brooklyn", state: "NY", zip: "11211", country: "US" } },
  tracking_history: [
    { status: "PRE_TRANSIT", status_details: "Shipping label created",
      status_date: "2026-05-13T08:00:00Z",
      location: { city: "San Francisco", state: "CA", zip: "94117", country: "US" } },
    { status: "TRANSIT", status_details: "Departed shipping facility",
      status_date: "2026-05-13T14:00:00Z",
      location: { city: "San Francisco", state: "CA", zip: "94117", country: "US" } },
  ],
  address_from: { city: "San Francisco", state: "CA", zip: "94117", country: "US" },
  address_to:   { city: "Brooklyn", state: "NY", zip: "11211", country: "US" },
});

show("Shippo address retrieve", {
  object_id: "0476d70c612a423f9509ba5f807569db",
  object_created: "2026-05-13T08:00:00Z", object_updated: "2026-05-13T08:00:00Z",
  object_owner: "shippotle@example.com",
  is_complete: true,
  name: "Mr Hippo", company: "Shippo",
  street1: "215 Clayton St", city: "San Francisco",
  state: "CA", zip: "94117", country: "US",
  phone: "+15553419393", email: "support@example.com",
  is_residential: false, metadata: "Customer ID 123456", test: false,
});

show("Shippo webhook track_updated", {
  carrier: "usps",
  tracking_number: "9499907123456123456781",
  servicelevel: { name: "Priority Mail", token: "usps_priority" },
  eta: "2026-05-15T20:00:00Z",
  tracking_status: { status: "DELIVERED",
    substatus: { code: "delivered", text: "Delivered" },
    status_details: "Delivered, Front Door/Porch",
    status_date: "2026-05-14T15:30:00Z",
    location: { city: "Brooklyn", state: "NY", zip: "11211", country: "US" } },
  tracking_history: [
    { status: "PRE_TRANSIT", status_details: "Shipping label created",
      status_date: "2026-05-13T08:00:00Z",
      location: { city: "San Francisco", state: "CA", zip: "94117", country: "US" } },
    { status: "DELIVERED", status_details: "Delivered",
      status_date: "2026-05-14T15:30:00Z",
      location: { city: "Brooklyn", state: "NY", zip: "11211", country: "US" } },
  ],
  address_from: { city: "San Francisco", state: "CA", zip: "94117", country: "US" },
  address_to:   { city: "Brooklyn", state: "NY", zip: "11211", country: "US" },
});

// --- ShipperHQ ---

show("ShipperHQ rates quote", {
  globalSettings: { transactionId: "5f8c1d2a-4e2b-4c7e-9b6a-1a2b3c4d5e6f" },
  carrierGroups: [{
    carrierGroupId: 42,
    carrierGroupDetail: { name: "Domestic Ground",
      checkoutDescription: "Ships from Austin TX warehouse" },
    carrierRates: [
      { carrierDetail: { carrierCode: "ups", carrierTitle: "UPS", carrierType: "smallpackage" },
        methodDetails: { methodCode: "03", methodTitle: "UPS Ground",
          totalCharges: 12.47, cost: 9.85, currency: "USD",
          dispatchDate: "2026-05-15", deliveryDate: "2026-05-19" } },
      { carrierDetail: { carrierCode: "fedex", carrierTitle: "FedEx", carrierType: "smallpackage" },
        methodDetails: { methodCode: "FEDEX_2_DAY", methodTitle: "FedEx 2Day",
          totalCharges: 24.10, currency: "USD", deliveryDate: "2026-05-18" } },
    ],
  }],
  requestEcho: {
    destination: { street: "742 Evergreen Terrace", city: "Springfield",
      region: "IL", zipcode: "62704", country: "US",
      validationStatus: "valid", destinationType: "RES" },
    customer: { email: "homer@example.com", remoteIp: "73.221.14.88" },
  },
});

show("ShipperHQ rates request body", {
  credentials: { apiKey: "SHQ_PUBLIC_KEY_abc123", password: "SHQ_SECRET_xyz789" },
  siteDetails: { ecommerceCart: "magento2", ecommerceName: "Magento",
    ecommerceVersion: "2.4.6", appVersion: "20.45.0",
    environmentScope: "production", websiteUrl: "https://shop.example.com" },
  destination: { street: "742 Evergreen Terrace", city: "Springfield",
    region: "IL", zipcode: "62704", country: "US",
    validationStatus: "valid", destinationType: "RES" },
  customer: { email: "homer@example.com", remoteIp: "73.221.14.88",
    id: "12345", groupId: "1" },
  cart: { declaredValue: 100.00, currency: "USD",
    items: [{ sku: "WID-1", name: "Widget", price: 50.00,
      weight: 1.5, qty: 2, id: "100", type: "simple",
      productType: "Goods", freeShipping: false, fixedPrice: 0, fixedWeight: 0 }] },
});

show("ShipperHQ Insights shipment (GraphQL)", {
  data: { shipment: {
    transactionId: "5f8c1d2a-4e2b-4c7e-9b6a-1a2b3c4d5e6f",
    carrier: "ups", service: "Ground", serviceCode: "03",
    shipDate: "2026-05-15", deliveryDate: "2026-05-19",
    origin: { name: "Warehouse Manager", company: "Example Co",
      street: "100 Industrial Way", city: "Austin", region: "TX",
      postalCode: "78701", country: "US",
      email: "warehouse@example.com", telephone: "+15125551234" },
    destination: { name: "Homer Simpson", company: "",
      street: "742 Evergreen Terrace", city: "Springfield", region: "IL",
      postalCode: "62704", country: "US",
      email: "homer@example.com", telephone: "+13125551111" },
    packages: [{ weight: 3.0,
      dimensions: { length: 8, width: 6, height: 4, units: "in" },
      trackingNumber: "1Z999AA10123456784",
      declaredValue: 100.00, currency: "USD" }],
    totalCharges: 12.47, currency: "USD",
  } },
  extensions: { complexity: 5 },
});

// --- Salesforce GraphQL ---

show("Salesforce GraphQL Contact", {
  data: {
    uiapi: {
      query: {
        Contact: {
          edges: [{
            cursor: "MQ==",
            node: {
              Id: "003Hp00003N5xQzIAJ",
              FirstName: { value: "Priya" },
              LastName: { value: "Ramachandran" },
              Name: { value: "Priya Ramachandran" },
              Email: { value: "priya@example.com" },
              Phone: { value: "+14155550142" },
              Title: { value: "VP Procurement" },
              AccountId: { value: "001Hp00002kQ8aZIAS", displayValue: "Northwind Traders" },
              OwnerId: { value: "005Hp000001Tk9LIAS", displayValue: "Dana Okonkwo" },
              MailingAddress: {
                Street: { value: "1455 Market Street" },
                City: { value: "San Francisco" },
                State: { value: "California" },
                StateCode: { value: "CA" },
                PostalCode: { value: "94103" },
                Country: { value: "United States" },
                CountryCode: { value: "US" },
              },
              LeadSource: { value: "Web" },
              Description: { value: "Met at Dreamforce 2026 expo floor" },
              LastModifiedDate: "2026-04-22T17:34:18.000Z",
              CreatedDate: "2025-09-01T00:00:00.000Z",
            },
          }],
          pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: "MQ==", endCursor: "MQ==" },
          totalCount: 1247,
          pageResultCount: 1,
        },
      },
    },
  },
});

show("Salesforce GraphQL Account", {
  data: {
    uiapi: {
      query: {
        Account: {
          edges: [{
            cursor: "MQ==",
            node: {
              Id: "001Hp00002kQ8aZIAS",
              Name: { value: "Northwind Traders" },
              Phone: { value: "+15555551234" },
              Website: { value: "https://northwind.example.com" },
              Industry: { value: "Manufacturing" },
              Type: { value: "Customer - Direct" },
              Description: { value: "Strategic account in EMEA region" },
              OwnerId: { value: "005Hp000001Tk9LIAS", displayValue: "Dana Okonkwo" },
              AnnualRevenue: { value: 50000000, displayValue: "$50,000,000.00" },
              NumberOfEmployees: { value: 1200 },
              BillingAddress: {
                Street: { value: "100 Industrial Way" },
                City: { value: "Portland" },
                State: { value: "Oregon" },
                StateCode: { value: "OR" },
                PostalCode: { value: "97201" },
                Country: { value: "United States" },
                CountryCode: { value: "US" },
              },
              ShippingAddress: {
                Street: { value: "100 Industrial Way" },
                City: { value: "Portland" },
                PostalCode: { value: "97201" },
                Country: { value: "United States" },
              },
              LastModifiedDate: "2026-04-01T00:00:00.000Z",
              CreatedDate: "2024-01-01T00:00:00.000Z",
            },
          }],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "MQ==", endCursor: "MQ==" },
          totalCount: 1,
          pageResultCount: 1,
        },
      },
    },
  },
});

show("Salesforce GraphQL Opportunity", {
  data: {
    uiapi: {
      query: {
        Opportunity: {
          edges: [{
            cursor: "MQ==",
            node: {
              Id: "006Hp00001ABC123",
              Name: { value: "Northwind Q2 expansion" },
              AccountId: { value: "001Hp00002kQ8aZIAS", displayValue: "Northwind Traders" },
              OwnerId: { value: "005Hp000001Tk9LIAS", displayValue: "Dana Okonkwo" },
              Amount: { value: 75000, displayValue: "$75,000.00" },
              CurrencyIsoCode: { value: "USD" },
              StageName: { value: "Proposal/Price Quote" },
              Probability: { value: 60 },
              CloseDate: { value: "2026-06-30" },
              Type: { value: "Existing Customer - Upgrade" },
              LeadSource: { value: "Partner Referral" },
              ForecastCategoryName: { value: "Pipeline" },
              IsWon: { value: false },
              IsClosed: { value: false },
              LastModifiedDate: "2026-05-01T00:00:00.000Z",
              CreatedDate: "2026-04-01T00:00:00.000Z",
            },
          }],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "MQ==", endCursor: "MQ==" },
          totalCount: 1,
          pageResultCount: 1,
        },
      },
    },
  },
});

show("Salesforce GraphQL Lead", {
  data: {
    uiapi: {
      query: {
        Lead: {
          edges: [{
            cursor: "MQ==",
            node: {
              Id: "00QHp00001XYZ789",
              FirstName: { value: "Sam" },
              LastName: { value: "Lead" },
              Name: { value: "Sam Lead" },
              Company: { value: "Lead Co" },
              Email: { value: "sam@lead.example" },
              Phone: { value: "+15555558888" },
              Title: { value: "Director of Operations" },
              Website: { value: "https://lead.example.com" },
              Industry: { value: "Software" },
              LeadSource: { value: "Web" },
              Status: { value: "Working - Contacted" },
              Rating: { value: "Hot" },
              AnnualRevenue: { value: 10000000, displayValue: "$10,000,000.00" },
              NumberOfEmployees: { value: 250 },
              OwnerId: { value: "005Hp000001Tk9LIAS", displayValue: "Dana Okonkwo" },
              IsConverted: { value: false },
              Description: { value: "Inquired about enterprise tier pricing" },
              Address: {
                Street: { value: "500 Lead Blvd" },
                City: { value: "Austin" },
                State: { value: "Texas" },
                StateCode: { value: "TX" },
                PostalCode: { value: "78701" },
                Country: { value: "United States" },
                CountryCode: { value: "US" },
              },
              LastModifiedDate: "2026-05-01T00:00:00.000Z",
              CreatedDate: "2026-04-15T00:00:00.000Z",
            },
          }],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "MQ==", endCursor: "MQ==" },
          totalCount: 1,
          pageResultCount: 1,
        },
      },
    },
  },
});

show("Salesforce GraphQL Case", {
  data: {
    uiapi: {
      query: {
        Case: {
          edges: [{
            cursor: "MQ==",
            node: {
              Id: "500Hp00001DEF456",
              CaseNumber: { value: "00012345" },
              Subject: { value: "Cannot log into account" },
              Description: { value: "Customer reports password reset email never arrives" },
              Status: { value: "New" },
              Priority: { value: "High" },
              Origin: { value: "Email" },
              Type: { value: "Problem" },
              Reason: { value: "Other" },
              ContactId: { value: "003Hp00003N5xQzIAJ", displayValue: "Priya Ramachandran" },
              AccountId: { value: "001Hp00002kQ8aZIAS", displayValue: "Northwind Traders" },
              OwnerId: { value: "005Hp000001Tk9LIAS", displayValue: "Dana Okonkwo" },
              SuppliedName: { value: "Priya Ramachandran" },
              SuppliedEmail: { value: "priya@example.com" },
              SuppliedPhone: { value: "+14155550142" },
              SuppliedCompany: { value: "Northwind Traders" },
              IsClosed: { value: false },
              IsEscalated: { value: false },
              LastModifiedDate: "2026-05-13T00:00:00.000Z",
              CreatedDate: "2026-05-13T00:00:00.000Z",
            },
          }],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "MQ==", endCursor: "MQ==" },
          totalCount: 1,
          pageResultCount: 1,
        },
      },
    },
  },
});

show("Recharge webhook customer/created", {
  customer: {
    id: 9001, email: "buyer@example.com", first_name: "Jane", last_name: "Buyer",
    phone: "+15555555555", subscriptions_active_count: 1, subscriptions_total_count: 1,
    hash: "abc123hash", created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
  },
});
