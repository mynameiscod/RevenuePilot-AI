# Acceptance plan and verification record

## Automated acceptance

| Area                | Required behavior                                                                                                                                                       | Tests / checks                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Startup             | Actual dev:demo process starts MongoDB/API/Vite on Linux and Windows; both local hostnames work                                                                         | demo-startup.test.ts, origins.test.ts                |
| Isolation           | Foreign tenant paths/IDs/headers, revoked membership, counselor scope and PII search cannot broaden access                                                              | api.test.ts, accounts-integrations.test.ts           |
| Sessions            | HttpOnly cookie, CSRF/exact origins, logout, hashed tokens, MFA replay and single-use recovery                                                                          | api/origins/security/accounts-integrations tests     |
| Accounts            | Single-use verification/reset; generic recovery; reset revokes sessions and preserves MFA; invite email binding; last owner retained                                    | accounts-integrations.test.ts                        |
| Acquisition         | Strict input and exact origins; no telemetry-created lead; duplicate/repeated enquiries safe; no unconsented touch; quotas atomic                                       | journey.test.ts                                      |
| Sales               | Contact evidence, follow-up assignment, qualification, host overlap prevention, no future attendance, version conflict                                                  | journey.test.ts                                      |
| Money               | One concurrent capture/enrollment; repeat enquiry cannot duplicate offer order; tampered amount denied; cumulative refunds and stale refund events safe                 | api.test.ts, journey.test.ts                         |
| Attribution         | Exact minor-unit conservation first/last/linear, cumulative refund allocation, duplicate account spend dedupe, no test cash in live ROAS                                | journey.test.ts                                      |
| Webhooks            | Raw HMAC verification, timestamp replay rejection, same-event dedupe/conflicting replay refusal, durable projection once                                                | journey/providers/accounts-integrations tests        |
| Actions             | Consent required before creation/approval/execution; config version binding; foreign preview denied; test AI never calls network; expired work unknown                  | accounts-integrations.test.ts                        |
| Provider boundaries | Destination/redirect guard, Google validation, Meta hashed IDs, structured AI/redaction, WhatsApp changed-template refusal, Outpero correlation, Razorpay link mismatch | providers.test.ts; synthetic transport fixtures only |
| Billing             | Server current paid invoice required; wrong tenant metadata rejected; replacement/late old subscription events safe                                                     | billing.test.ts; provider reads mocked               |
| Privacy             | Retention removes call content; password required for erase; encrypted transcript erased; self-service withdrawal cancels queued work                                   | accounts-integrations.test.ts, journey.test.ts       |
| SDK                 | No tracking before consent, safe paths/allowlisted tags, bounded queue/retries, stable attempt IDs                                                                      | sdk.test.ts, providers.test.ts                       |
| Built stack         | Nginx/API/collector, MongoDB, Redis and BullMQ process a complete synthetic journey plus signed CRM webhook                                                             | scripts/smoke-stack.mjs via docker-stack CI          |
| Restore             | Quiescent CI database archived and restored into separate namespace; durable collection counts match                                                                    | docker-stack CI, excludes volatile rate buckets      |

Run `npm run typecheck`, `npm test`, `npm run build`, `npm audit --omit=dev --audit-level=high`. All unit/API tests use synthetic contacts and either a real temporary MongoDB replica set or explicit provider transport mocks. No test calls a real AI/calling/message/payment account.

CI verifies Linux Node24.22.1 and Windows Node24.11.0, plus the actual Docker stack on Ubuntu. Consult the current commit's [Actions result](https://github.com/mynameiscod/RevenuePilot-AI/actions) for authoritative execution status. CI creates only disposable test containers; it does not deploy the product.

## Browser verification during implementation

Desktop Chromium local demo:

- Entered the synthetic workspace using **Explore sample workspace**; observed 48 seeded leads and zero live connections.
- Opened the hosted CodeBegun form, granted measurement only, submitted a synthetic enquiry and received its confirmation.
- Observed the assigned work-queue task, recorded a connected conversation, scheduled a demo and recorded attendance after its start.
- Simulated a successful payment and observed a sandbox receipt plus enrollment. Simulated full refund and observed refunded order and enrollment review requirement.
- Observed report milestones and separate manual/sandbox revenue; no imported live spend or fabricated ROAS.

- Verified integration controls, team/seats/billing configuration status and saving workspace preferences.

The v0.2 release passed 66 tests across 9 files, TypeScript, production build and production dependency audit with zero vulnerabilities. The subsequent startup regression adds a deliberately slow API and an occupied-port failure check; the current commit's CI is authoritative for the expanded suite. The [dashboard screenshot](screenshots/journey-verified.jpg) records the synthetic walkthrough. Screenshots are implementation evidence, not a claim that real provider accounts are connected. The current cloud browser does not expose a supported viewport-resize API; a physical/narrow-device mobile pass remains a release gate.

## External acceptance before live operation

For each chosen provider, use its actual sandbox/test account to verify scopes/account identity, real pagination/event shape, rate limits, revocation, signatures and duplicate/reordered events. Test payment failure, asynchronous confirmation, refunds and provider timeouts. Reconcile ad import totals against the provider and record missing coverage. Verify WhatsApp template/body/phone mapping, SES domain/SNS subscription, and Outpero lead intake/correlation/signature mapping. Confirm actual email delivery for account recovery and SaaS invoice/entitlement transitions with configured server price IDs.

Load/chaos testing, production restore measurements, security review, monitoring thresholds, image scans/digest pins and production deployment are not certified by these local tests. No claim of 100% identity coverage, causal ad attribution, bank settlement, delivery, or paid conversions is made without the corresponding evidence.
