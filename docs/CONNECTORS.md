# Provider-agnostic connectors

## Contract and capability boundary

`packages/connectors/src/index.ts` contains browser-safe manifests. `runtime.ts` is server-only and resolves typed capabilities: `pullSpend`, `pullContacts`, `submitConversion`, `analyze`, `send`, `call`, `createCheckout`, `verifyCheckout`. `settings.ts` validates each provider's settings/credential field names; `http.ts` enforces HTTPS host allowlists, no redirects, time/size limits and sanitized error classes. Adding a provider does not change the canonical lead/receipt schema.

Connection lifecycle: draft → configure (version increments, health reset) → check → explicit activation → test/active; pause blocks new work. Reconfiguration invalidates pending command approval. Live activation and approval require verified email, MFA, recent login and the installation live flag. A credentials check is not vendor certification. Generic CRM/Outpero can only return configuration validation without a configured signed inbound/outbound acceptance exercise.

## Implemented provider matrix

| Provider                  | Implemented operations                                                                        | Required configuration / access                                                                                                                           | Evidence limits                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Meta                      | Daily ad-level spend/clicks/impressions; native lead form pull; CAPI feedback                 | Explicit supported Graph version, ad account, scoped access token; optional lead form/import mapping, pixel/test event code                               | Tags and provider reports are separate; CAPI acceptance is not attributed conversion                                    |
| Google Ads + Data Manager | Ad-level spend by campaign/channel (VIDEO → YouTube); offline conversion ingestion/validation | Supported Ads version (default v26), customer/optional manager, OAuth client/secret/refresh token, developer token, conversion action; Data Manager scope | Valid click ID required; validation mode does not upload a real conversion; request ID is acceptance only               |
| HubSpot                   | Paged contact reads into canonical leads                                                      | Private/scoped access token; active intake form for course/owner mapping; contacts API 2026-03                                                            | Read/import only; no CRM stage/contact writeback; no inferred communication consent                                     |
| Generic CRM               | Signed `contact.upsert.v1` intake                                                             | Shared webhook secret, active import form                                                                                                                 | No arbitrary remote URL proxy and no LMS dependency                                                                     |
| Outpero                   | Approved lead-intake call request; signed post-call event → call history/milestones           | Dashboard intake URL on allowed host, lead secret, webhook secret; configured agent and correlation mapping                                               | No automatic redial; acceptance is not answered call; no recording URL fetch; actual tenant payload needs certification |
| Stripe                    | Checkout session, capture/refund reconciliation, raw webhook                                  | Matching test/live secret key and endpoint signing secret                                                                                                 | Server price/reference; captures, not bank payouts; refunds initiated in provider account                               |
| Razorpay                  | Payment Links, payment/refund reconciliation, raw webhook                                     | Matching test/live key ID/secret and webhook secret                                                                                                       | No partial-link payment support; link/payment relationship and captured amount verified                                 |
| OpenAI                    | Responses API, bounded structured conversation analysis                                       | User-selected supported model and API key                                                                                                                 | `store:false`, no tools; schema-validated suggestions for human review; no automated sales decision                     |
| Anthropic                 | Messages structured-output analysis                                                           | User-selected supported model and API key                                                                                                                 | Same bounded schema/review contract; actual model capability checked with test account                                  |
| WhatsApp Cloud API        | Reviewed static approved template send; delivery status; STOP suppression                     | Graph version, phone ID, WABA ID, template name/language/exact body, token, app secret, verify token                                                      | Template body checked before send; variable/header/button templates rejected; accepted ≠ delivered                      |
| Amazon SES                | Reviewed text email; account check; SNS delivery/bounce/complaint intake                      | Region, verified sender, subject/body, access keys; optional exact SNS topic ARN                                                                          | SES/domain permissions required; SNS confirmation done in AWS; acceptance ≠ inbox delivery                              |

Calls, messages and AI in **test mode are local simulations**, not a way to spend real provider credits. Advertising test commands intentionally call provider test/validation endpoints after approval. Stripe/Razorpay test mode uses provider sandbox keys. Production/demo guards prevent treating these results as verified live cash/conversions.

No live credentials were used to certify these adapters. Protocol fixtures validate request/response handling; account scopes, product eligibility and real tenant payloads remain activation work. OAuth refresh is implemented for supplied Google refresh credentials; self-service OAuth consent/state/PKCE UI is not included.

## Canonical import and command semantics

Imported contact fields are externalId, name, email, phone, source and campaign. The connector maps course/owner through a tenant-owned active form. An integration link and tenant-keyed identity hash make repeats safe; existing customer details are not silently overwritten. Import one provider page at a time; return nextCursor and partial/rejected row IDs. Spend windows are at most31 days per request. Replaying a spend page upserts unique daily rows; reports deduplicate duplicate connections to the same account.

Outbound command inputs are tenant-owned connection/lead IDs, capability kind, bounded analysis text or milestone ID and optional scheduled time. Creation stores an encrypted payload for review. Approval binds the current connection version and repeats consent checks. Execution repeats scope/consent/suppression/config checks, checks 09:00–20:00 tenant quiet hours for calls/messages, reserves UTC daily usage and makes one request. Ambiguous responses become unknown. No auto-failover, retry blast or AI-triggered money mutation exists.

Qualified/enrollment feedback candidates from the last seven days are prepared automatically from recorded milestones with appropriate consent and matching provider-source touch evidence. They still require approval. Live enrollment feedback rejects synthetic/test payment evidence and refunded captures. This version does not automatically retract a conversion already accepted by an ad provider when a later refund arrives; finance reporting reconciles the refund and the operator must review provider-side adjustments.

## Webhook contracts

Paths: `/api/v1/webhooks/payments/:connectionId`, `/api/v1/webhooks/integrations/:connectionId`, `/api/v1/webhooks/billing`. Verify raw bytes before parsing business data. Encrypt and persist the inbox before returning202. Duplicate same-byte delivery is accepted; conflicting reuse of an external ID returns409. Processing leases/retries are separate from receipt acknowledgement.

Generic CRM headers:

```text
X-RevenuePilot-Timestamp: <Unix seconds>
X-RevenuePilot-Signature: sha256=<HMAC-SHA256(secret, timestamp + "." + rawBody)>
Content-Type: application/json
```

```json
{
  "eventId": "stable-source-event-id",
  "type": "contact.upsert.v1",
  "contact": {
    "externalId": "source-contact-id",
    "name": "Example Contact",
    "email": "contact@example.test",
    "phone": "",
    "source": "Other",
    "campaign": "Partner enquiry"
  }
}
```

Timestamp tolerance five minutes. Outpero uses `X-Outpero-Timestamp` / `X-Outpero-Signature` with the same timestamp/raw-body scheme and a flat `call.ended` JSON payload containing call_id, status completed/voicemail, duration_s, ended_at, summary/transcript and `pre_call.revenuepilot_command_id`. Configure that correlation field explicitly. Actual dashboard envelope/signature behavior must match; unsigned or differently mapped events fail visibly rather than inventing associations.

Stripe uses its SDK raw-body signature check with timestamp tolerance. Razorpay uses its raw HMAC signature and event ID (body hash fallback); replay protection is durable because its signature does not supply an application timestamp. Payment lookup validates current provider truth. WhatsApp uses `X-Hub-Signature-256`, verified phone ID and a separate challenge token. SES validates exact topic, timestamp, AWS regional certificate origin/path/validity, canonical signed fields and RSA signature; no arbitrary SubscribeURL is fetched.

## Website integration without modifying another application

See [MARKETING.md](MARKETING.md) for the campaign builder, downloadable complete website form and counting rules. The hosted form works immediately. External sites may optionally import the build output `/revenuepilot-sdk.js`, configure their exact origin on the intake form and explicitly call the intake methods:

```ts
import { createIntake } from "https://your-revenuepilot-origin.example/revenuepilot-sdk.js";
const intake = createIntake({
  apiOrigin: "https://your-revenuepilot-origin.example",
  formKey: "YOUR_PUBLIC_FORM_KEY",
});
const offer = await intake.info();
// Wire this to an actual visitor consent choice, never a default grant.
intake.setConsent({ tracking: true, advertising: false });
await intake.record("started");
const confirmation = await intake.submit({
  name: "Example Learner",
  email: "learner@example.test",
  privacyConsent: true,
  marketingConsent: false,
  consentVersion: offer.consentVersion,
});
// Navigate to your RevenuePilot /checkout#<acceptanceToken> if payment is desired.
```

`createIntake` uses memory-only pseudonymous IDs, omits browser credentials and reuses its attempt ID across retries. It retains initial allowlisted UTM/click fields and a referrer hostname in memory, and sends source observations only after consent. Managed links also supply `rp_link`, which resolves to tenant/form-bound canonical metadata. Exact ad joins use `utm_source`, `ad_account_id` (numeric account without act_), `utm_id` (campaign ID) and `ad_id`. `utm_campaign` is a readable label. Never put email/phone/name in campaign URLs. Consent decline still allows an enquiry; no tracking touch is saved.

The separate `createTracker` API is a generic telemetry collector with bounded memory queue/retry and explicit consent. It does not create accepted leads or monetary evidence. See its executable types/tests. Neither SDK is installed into any CodeBegun site or LMS by this change.

## Primary protocol references

Implementation references were checked during development; providers may change contracts. Recheck the selected account/version at activation.

- [Google Ads release notes](https://developers.google.com/google-ads/api/docs/release-notes)
- [Google Data Manager events ingestion](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest)
- [Google Data Manager destinations](https://developers.google.com/data-manager/api/reference/rest/v1/Destination)
- [Stripe Node SDK](https://github.com/stripe/stripe-node) and [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Razorpay official API documentation source](https://github.com/razorpay/markdown-docs)
- [HubSpot CRM API](https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/guide)
- [Outpero post-call webhooks](https://outpero.com/ai-voice-agents/features/post-call-webhooks)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [WhatsApp webhook reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
- [SES SendEmail v2](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)
- [SNS signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html)
