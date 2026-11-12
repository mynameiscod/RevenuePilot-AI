# API contracts — 0.2

Base `/api/v1`; JSON except raw signed webhooks. `T` below means `/tenants/:tenantId`. Active tenant membership is checked server-side on every T request. `S` denotes a current session; authenticated writes additionally require `Origin` and `X-CSRF-Token`. A role never broadens object scope. All unknown request fields are rejected by strict request schemas unless a provider payload is explicitly passthrough.

[REQUEST_SCHEMAS.json](REQUEST_SCHEMAS.json) is generated from executable Zod contracts for leads, money, settings, forms, events and all provider configurations. Cross-field refinements, permissions and state transitions described here remain required. Run `npm run contracts` after changing them.

## Authentication, errors and idempotency

The session cookie is HttpOnly/SameSite=Lax, eight hours, stored server-side as a hash. Production uses Secure `__Host-rp_session`; development uses `rp_session`. `GET /auth/session` returns `{user:{id,name,email,mfaEnabled,emailVerified}, tenants:TenantView[], csrfToken}`. Tenant view includes role, currency, timezone, demo, response minutes, retention days and attribution preference. There is no bearer API token or service-account endpoint.

Origin is exact in production. Local development/test accepts localhost and 127.0.0.1 aliases only for the configured scheme/port. Missing/opaque origins, arbitrary ports and forwarding headers do not establish trust. Public forms use their independently registered origin allowlist; signed webhooks use signature authentication, not browser cookies.

Errors: `application/problem+json` with `{type,status,code,title,requestId,errors?:[{path,message}]}`. 401: missing/bad auth; 403: origin/CSRF/role/live gate; 404: scoped object absent; 409: version/idempotency/state conflict; 422: validation/evidence/configuration; 429: rate/plan limit; 502: sanitized provider failure; 500: generic internal failure. Unmatched routes return a simpler 404. Clients must display safe `title` and retain `requestId` for support.

Where marked **K**, `Idempotency-Key` is required. Durable key scope is tenant + principal + route + key + normalized body hash. Same body returns the stored result; changed body is 409. Reuse the key after an unknown response. Financial/order/webhook business uniqueness remains independent of that key.

## Identity and accounts

| Method/path                       | Request / authorization                                                      | Success                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET `/public/config`              | Public                                                                       | Demo and registration flags                                                      |
| POST `/auth/register`             | registrationInput; email, 12–128 char password, name, workspaceName          | 201 session; owner/workspace plus verification mail queued                       |
| POST `/auth/login`                | loginInput; optional six-digit code or one-time recoveryCode                 | 200 session or MFA_REQUIRED/MFA_INVALID                                          |
| POST `/auth/demo`                 | Explicit nonproduction demo mode only                                        | 200 synthetic session                                                            |
| GET `/auth/session`               | S                                                                            | SessionView                                                                      |
| POST `/auth/logout`               | S                                                                            | 204; server session removed                                                      |
| POST `/auth/mfa/setup`            | S + `{password}`                                                             | Secret/URI; sensitive one-time setup                                             |
| POST `/auth/mfa/confirm`          | S + `{code}`                                                                 | enabled and ten recoveryCodes; store securely; other sessions revoked            |
| POST `/auth/forgot-password`      | `{email}`; public rate limits                                                | 202 generic response for known/unknown email                                     |
| POST `/auth/reset-password`       | `{token,password}`                                                           | updated; token single-use, all sessions revoked, MFA retained                    |
| POST `/auth/verify-email`         | `{token}`                                                                    | verified; token single-use                                                       |
| POST `/auth/verify-email/request` | S                                                                            | 202; queues installation account mail                                            |
| GET `/auth/sessions`              | S                                                                            | `{items:[{id,authenticatedAt,expiresAt,current}]}`                               |
| DELETE `/auth/sessions/:id`       | S; own sessions only                                                         | 204                                                                              |
| POST `/auth/invites/accept`       | S + `{token}`; signed-in email must match invite                             | accepted; role/seat/expiry checked transactionally                               |
| POST `/tenants`                   | S + `{name}`                                                                 | 201 updated SessionView                                                          |
| GET `T/account/usage`             | settings.write                                                               | plan, billingStatus, limits, usage, seats, pendingInvites, retentionDays         |
| GET `T/account/invites`           | members.read                                                                 | Pending invite IDs, email, role, expiry; no token hash                           |
| POST `T/account/invites`          | settings.write + `{email,role}`; role admin/analyst/counselor/finance/viewer | 202; owner alone may invite admin                                                |
| DELETE `T/account/invites/:id`    | settings.write                                                               | 204; token invalidated                                                           |
| PATCH `T/account/members/:id`     | settings.write + `{role,status:active                                        | revoked}`                                                                        | updated; last-owner and seat checks; owner-only privileged changes |
| GET `T/account/local-mail`        | settings.write; own queued messages; nonproduction only                      | Preview body for local verification/invite/reset testing; 404 production         |
| GET `T/privacy/leads/:id/export`  | settings.write + scoped lead                                                 | Contact, consent, up to 500 activities, demos, receipts/enrollments; audit entry |
| POST `T/privacy/leads/:id/erase`  | settings.write + current `{password}`                                        | Pseudonymized local contact; 409 if action running; financial/audit retained     |

Verification/reset token lifetime one hour; invite 72 hours. Links use URL fragments. Unknown account recovery never reveals registration status. Email is delivered only when installation SES account mail is enabled; local preview is not production delivery.

## Acquisition and sales

| Method/path                            | Request / authorization                                                      | Success                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST `T/forms`                     | settings.write; POST formInput + K                                           | List / 201 `{id,publicKey,url}`                                                                                                  |
| PATCH `T/forms/:id`                    | settings.write + `{active}`                                                  | updated; reactivation checks active-form quota                                                                                   |
| GET `/public/forms/:publicKey`         | Public form origin policy                                                    | name, course, workspaceName, amountMinor/currency, consentVersion, sandboxAvailable                                              |
| POST `/public/forms/:publicKey/events` | formEventInput; trackingConsent true                                         | 202 accepted observation; never creates a lead                                                                                   |
| POST `/public/forms/:publicKey/submit` | submissionInput; privacyConsent true, correct consentVersion, empty honeypot | 201 `{accepted:true,acceptanceToken,expiresInSeconds}`; never returns existing contact ID                                        |
| GET `T/journey/team`                   | leads.write                                                                  | Active eligible host/assignee `{id,name}` items                                                                                  |
| GET `T/journey/work`                   | leads.read                                                                   | Up to 100 open tasks and 100 scheduled demos, scoped names                                                                       |
| GET `T/leads`                          | leads.read; q/stage/page/limit                                               | `{items,total,page,limit}`; counselor owns records, PII restricted by role                                                       |
| POST `T/leads`                         | leads.write + leadInput + K                                                  | 201 `{id}`; lead quota, audit/outbox and milestone                                                                               |
| GET `T/leads/:leadId`                  | leads.read + scope                                                           | `{lead,events}`; latest 100 timeline events                                                                                      |
| PATCH `T/leads/:leadId/stage`          | leads.write + `{stage,note,version}`                                         | updated; version conflict 409; qualified/lost milestone                                                                          |
| POST `T/leads/:leadId/contact`         | leads.write + `{note}` + K                                                   | Legacy contact-attempt record; use outcomes for richer evidence                                                                  |
| GET `T/leads/:leadId/journey`          | leads.read + scope                                                           | lead, tasks, demos, milestones, enrollments, role-filtered orders/consent/call text, suppression                                 |
| POST `T/leads/:leadId/outcomes`        | leads.write + contactInput + K                                               | updated; closes open follow-ups, optionally schedules next, suppresses wrong-number/not-interested                               |
| POST `T/leads/:leadId/demos`           | leads.write + demoInput + K                                                  | 201 `{id}`; eligible host, future time and overlap check                                                                         |
| PATCH `T/demos/:id`                    | leads.write + demoOutcomeInput                                               | updated; version required; attendance/no-show cannot precede start                                                               |
| GET `T/journey/analytics?days=30`      | leads.read; 1–90 days                                                        | asOf/start/cohortSize, funnel, tracking, stalls/losses, reviewCount, role-filtered revenue/campaigns/advertising and methodology |
| GET `T/overview?days=30`               | leads.read; 7/30/90                                                          | Overview, role-filtered cash, current stages/source/trend; test cash excluded outside demo                                       |

Form request: `{name,course,amountMinor,currency,origins,assignees?,consentVersion?}`. Empty assignees means the creating administrator; configured lists round-robin across current active eligible members. Full-enrollment offer amount is immutable; create a new offer for a new price. Currency INR/USD/AED.

Submission request:

```json
{
  "attemptId": "random-stable-attempt-id",
  "anonymousId": "random-pseudonymous-id",
  "name": "Example Learner",
  "email": "learner@example.test",
  "phone": "+910000000001",
  "privacyConsent": true,
  "marketingConsent": false,
  "trackingConsent": true,
  "adConsent": false,
  "consentVersion": "1",
  "website": "",
  "touch": {
    "source": "meta",
    "medium": "paid",
    "campaign": "Java admissions",
    "accountId": "123",
    "campaignId": "456",
    "adId": "789",
    "clickIds": { "fbclid": "provider-click-id" }
  }
}
```

`touch` is ignored for attribution when tracking consent is false. No contact fields belong in telemetry events. Event body: `{attemptId,anonymousId,type:viewed|started|submitted,path,trackingConsent:true,touch}`. `path` excludes query/hash. Contact outcomes: answered/no_answer/unreachable/wrong_number/not_interested + note + optional ISO nextFollowupAt. Demo: hostId, ISO scheduledAt, durationMinutes 15–120. Outcome: attended/no_show/cancelled + interested/not_interested/follow_up/not_applicable + note + version.

## Payments and revenue

| Method/path                              | Request / authorization                            | Success                                                            |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| GET `T/checkout/forms`                   | revenue.write                                      | Active enrollment offers                                           |
| POST `T/leads/:leadId/checkout-link`     | revenue.write + `{formId}` + K; same course        | 201 opaque URL, expiry 86400; no price override                    |
| PUT `T/forms/:id/payment`                | connections.write + `{connectionId:string          | null}`                                                             | updated; active/test tenant-owned gateway required |
| POST `/public/checkout/status`           | `{acceptanceToken}` + app origin                   | course, amount/currency, mode, sandbox, safe order status          |
| POST `/public/checkout/start`            | Same token                                         | id, mode, status, provider URL; server creates once per lead/offer |
| POST `/public/checkout/simulate`         | Same token; nonproduction sandbox only             | order status, sandbox receipt/enrollment; no external money        |
| POST `/public/checkout/withdraw-consent` | Same unexpired token                               | withdraws all optional purposes and cancels queued/pending actions |
| POST `T/orders/:id/reconcile`            | revenue.write                                      | Verified settlement status; stored provider reference required     |
| POST `T/orders/:id/sandbox-refund`       | revenue.write; nonproduction + `{cumulativeMinor}` | Cumulative simulated refund; no real gateway refund                |
| GET `T/revenue`                          | revenue.read; page/limit/leadId/kind               | Receipt page, evidence labels, role-safe names                     |
| POST `T/revenue`                         | revenue.write + receiptInput + K                   | 201 manual ledger receipt; cannot assert provider evidence         |
| POST `/webhooks/payments/:connectionId`  | Exact raw signed Stripe/Razorpay body              | 202 durable inbox, not synchronous confirmation                    |

Minor-unit strings are positive integers at most `9000000000000000`. Refund references are distinct and reference a same-tenant capture; server rejects mismatched currency/lead and over-refunds. Manual refund cannot modify a provider-confirmed capture. Real refunds happen at the gateway and are reconciled through signed events/API reads. Browser return pages never confer money or enrollment. Payment order states: created → unknown (create claimed) → pending → paid → refunded; unknown without reference requires operator reconciliation. A lower cumulative refund never regresses state.

## Connectors, consent and billing

| Method/path                                     | Request / authorization                                                           | Success                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET `T/connections`                             | Membership                                                                        | Safe catalog/configuration summaries; no secrets                                        |
| POST `T/connections`                            | connections.write + connectionInput                                               | 201 encrypted draft ID                                                                  |
| DELETE `T/connections/:id`                      | connections.write                                                                 | 204 only unused drafts; historical connections must be paused                           |
| POST `T/connections/:id/sync`                   | Deprecated                                                                        | 422 instructing use of Integration controls                                             |
| GET `T/integrations`                            | connections.write                                                                 | Config/health/version, latest 100 commands, 30 syncs/webhooks, live flag                |
| PUT `T/integrations/:id/configure`              | `{version,mode:test                                                               | live,settings,credentials}`                                                             | configured/draft; strict provider schema, encrypted merge, increments version |
| POST `T/integrations/:id/check`                 | connections.write                                                                 | Credentials verified or configuration-only check with note/version/time                 |
| POST `T/integrations/:id/activate`              | `{confirmed:true}`                                                                | activated; fresh health version; live requires email/MFA/recent login/global flag       |
| POST `T/integrations/:id/pause`                 | connections.write                                                                 | paused; queued actions return to review                                                 |
| POST `T/integrations/:id/sync`                  | `{kind:spend                                                                      | contacts,since?,until?,cursor?}`                                                        | runId/imported/rejected/rejectionIds/nextCursor/complete; spend ≤31-day range |
| POST `T/integrations/webhooks/:id/retry`        | connections.write                                                                 | queued; failed and retained payload only                                                |
| POST `T/commands`                               | connections.write + K; `{connectionId,leadId,kind,text?,milestoneId?,notBefore?}` | 201 pending review; capability/consent/monthly quota checked                            |
| GET `T/commands/:id/preview`                    | connections.write                                                                 | Safe command plus reviewed payload; no ciphertext                                       |
| POST `T/commands/:id/approve`                   | `{confirmed:true}`                                                                | queued; config/consent/live gates repeated                                              |
| POST `T/commands/:id/cancel`                    | connections.write                                                                 | cancelled; pending/queued only                                                          |
| POST `T/consent/:leadId`                        | `{purpose,granted,evidence}`                                                      | recorded; purposes marketing/tracking/ad_measurement/ai_analysis; evidence 10–300 chars |
| GET/POST `/webhooks/integrations/:connectionId` | WhatsApp challenge / provider-specific raw signature                              | Challenge / 202 durable inbox                                                           |
| GET `T/billing`                                 | Owner only                                                                        | plan/status/configured/availablePlans/subscription safe fields                          |
| POST `T/billing/checkout`                       | Owner + verified email + `{plan:growth                                            | scale}`                                                                                 | Stripe hosted subscription URL; server-priced only                            |
| POST `T/billing/portal`                         | Owner                                                                             | Provider billing portal URL for bound customer                                          |
| POST `/webhooks/billing`                        | Raw platform Stripe signature                                                     | 202; provider current subscription/invoice reconciled by worker                         |

Command kinds: call/message/analysis/conversion. Calls/messages require marketing consent, analysis requires ai_analysis, conversions require tracking plus ad_measurement. Any suppression blocks all. Calls/messages execute only 09:00–20:00 workspace time and respect UTC daily caps. Test calls/messages/AI simulate locally; ad test/validation and payment test modes use real provider test endpoints with scoped credentials. Human approval does not bypass guards.

## Settings and collector

| Method/path        | Request / permission                                        | Success                                            |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------- |
| GET/POST `T/sites` | settings.write; POST siteInput                              | List / 201 registered site/public key              |
| POST `/collect`    | collectInput + exact registered Origin; no session required | 202 acceptedIds/duplicateIds/rejected              |
| PUT `T/settings`   | settings.write + settingsInput                              | Updated SessionView; optional retentionDays 30–365 |
| GET `T/members`    | members.read                                                | Member/user IDs, names, email, role, status        |
| GET `T/audit`      | audit.read                                                  | Latest 100 audit actions and pending outbox count  |

Collector batches contain 1–50 page/form observations, pseudonymous IDs, occurredAt, consent literal `granted`, query-free path and strict payload. Timestamps accept up to seven days old/five minutes future. No lead/receipt mutation is exposed by the collector.

`/health/live` and `/health/ready` are outside `/api/v1`; readiness checks MongoDB only. Pagination defaults page1/limit25, maximum100/page and page10000. Reports return 422 when bounded processing limits are exceeded. No unrestricted MongoDB query, arbitrary HTTP proxy or generic untyped provider execution endpoint exists.
