# Provider and tracking boundaries

## Provider catalog

| Category    | Initial catalog                          | Current behavior                                                   |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Advertising | Meta Ads, Google Ads (including YouTube) | Configuration drafts only                                          |
| CRM         | HubSpot, Custom CRM                      | Configuration drafts only                                          |
| AI calling  | Outpero                                  | Configuration drafts only                                          |
| Payments    | Razorpay, Stripe                         | Configuration drafts only; manual ledger is separate               |
| AI models   | OpenAI, Anthropic                        | Configuration drafts only; recommendations are deterministic rules |
| Messaging   | WhatsApp Cloud, Amazon SES               | Configuration drafts only                                          |

The catalog is extensible; no vendor is embedded in the lead or ledger model. A provider's declared capabilities are its intended scope, not evidence of implemented support. Google Ads and SES currently expose no credential inputs because OAuth/workload credentials are not implemented. The generic CRM has no arbitrary destination URL field. Do not store production credentials during evaluation.

`packages/connectors/src/index.ts` defines `ProviderManifest`, tenant-bound `ConnectorContext`, `ChangePage`, `ConnectorAdapter` and the explicit `ConnectorUnavailable` error. Context contains tenant ID, connection ID, trace ID and deadline. Pull responses include external ID, provider revision, occurrence time, normalized type/data, continuation cursor and completion state. The current registry always fails with `ADAPTER_NOT_IMPLEMENTED`; there is no silent fallback provider.

## Next adapter contract

Implement each adapter behind the same service boundary, with category-specific capability methods. The initial read-only pull contract is insufficient for send/call/payment commands; add typed command/result contracts rather than an unrestricted generic execute method.

| Capability  | Canonical records / method to add                                               | Required protections                                                                                |
| ----------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Advertising | Account/campaign/ad dimensions, daily spend, captured lead, submit conversion   | Provider/account/timezone/currency keys, duplicate lead/event IDs, consent eligibility              |
| CRM         | Contact, opportunity, assignment, stage and accepted lead                       | Explicit field mapping, conflict ownership, revision/tombstone support                              |
| Calling     | Call session, attempt/outcome, recording/transcript reference, schedule command | Consent/suppression, permitted hours, cost limits, PII retention, human approval                    |
| Payments    | Order, capture, refund, dispute, settlement                                     | Raw-body signed webhook, authoritative lookup, event dedupe, money conservation                     |
| AI          | Structured generation/transcription with usage                                  | Schema validation, redaction, tenant budgets, model/version provenance, prompt-injection boundaries |
| Messaging   | Template, send command, delivery/bounce/opt-out                                 | Approved template, opt-in/suppression, dedupe and destination validation                            |

A complete activation flow should be draft → credentials validated → scoped test → backfill/shadow → certified → active, with paused/revoked/error states. Store auth separately from configuration, use a secret reference and record connection version. Provider changes must not rewrite canonical lead IDs or historical evidence.

Retries must distinguish safe reads, provider idempotent writes and ambiguous outcomes. After an unknown payment/message/call result, reconcile using a stable external request key before retrying. Never fail over an action to another provider if that could duplicate its effect. Persist watermarks only with accepted canonical changes; support overlap windows, late events and reconciliation.

Before activation, fixture and sandbox tests must cover authentication expiry, rate limits with Retry-After, cursor restart, duplicate/reordered webhooks, pagination boundaries, partial failure, schema changes and tenant credential isolation. Store provider API version and certification date. Outbound execution remains disabled until the corresponding domain policies are implemented and explicitly approved.

## Browser SDK

Register a site in Settings → Tracking using exact origins (for example `https://marketing.example.test`), then serve the built SDK from `dist/web/revenuepilot-sdk.js`. No script has been added to any existing website.

Example integration after a site's consent manager has obtained the applicable permission:

```js
import { createTracker } from "/revenuepilot-sdk.js";

const tracker = createTracker({
  endpoint: "https://revenue.example.test/api/v1/collect",
  siteKey: "REPLACE_WITH_REGISTERED_PUBLIC_SITE_KEY",
});

// Invoke only from the consent manager's granted state/change callback.
// tracker.grantConsent();
// tracker.track('form.viewed.v1', { formId: 'java-enquiry', attemptId });
// tracker.track('form.started.v1', { formId: 'java-enquiry', attemptId });
// tracker.track('form.submitted.v1', { formId: 'java-enquiry', attemptId });
// tracker.revokeConsent();
// tracker.destroy();
```

Create one random `attemptId` per form attempt and reuse it for that attempt's events. Do not use names, emails or phone numbers as IDs. This SDK does not wire form listeners automatically, change form submission or submit leads. An authoritative accepted-enquiry event and identity-linking endpoint are later milestones.

Consent grant creates one page view. Pseudonymous IDs and pending events are memory-only: navigation/reload resets them. Queue capacity is 100, batch size 50, periodic retry 5 seconds. Network/429/5xx failures retain bounded pending events; permanent 4xx failures drop their batch. The caller should destroy the tracker on application teardown. Withdrawal clears queued events and rotates identity; requests already sent cannot be recalled.

Only pathnames are collected: no query, fragment, input contents, cookies, fingerprint or persistent identifiers. Avoid sensitive data in pathnames and form identifiers. Collector validation rejects unapproved event types and extra fields. Event timestamps more than seven days old or five minutes ahead are rejected. The site key selects tenant server-side, exact Origin is checked, rate limits apply and duplicate IDs are acknowledged safely.

No cross-domain/cross-device linking, UTM/click-ID attribution, signed lead receipt, abandonment inference, browser replay or consent history is implemented in v0.1. These omissions are explicit so initial metrics cannot be mistaken for end-to-end conversion measurement.
