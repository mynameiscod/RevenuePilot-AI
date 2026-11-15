# UC-01 — existing website enquiry to verified revenue

CodeBegun is the first tenant. This release connects its existing website course forms and home enquiry to RevenuePilot. It does not deploy either application or change the LMS. Meta Instant Forms, WhatsApp inbound capture, phone/walk-in ingestion and a general-purpose business journey builder remain separate backlog work.

## The complete operating flow

| Step | Visitor/team action | RevenuePilot evidence and where to check |
| --- | --- | --- |
| 1. Set up | Owner creates the tenant, active counselors and priced enquiry forms; maps each website course to its form | Settings → Team & account; Enquiry forms. A form belongs to exactly one tenant and offering. Public form keys are routing IDs, never admin credentials. |
| 2. Marketing source | Create a campaign link to the existing `/courses/...` URL; use it as the ad destination | Marketing → Create campaign link. Enter actual source, ad account, campaign and ad IDs. Managed metadata wins over edited URL tags. No live campaign is created automatically. |
| 3. Ad click / arrival | Advertising platform reports a click; visitor reaches the website | Provider clicks/spend and consented form views are different evidence. A browser cannot prove a visitor arrived when navigation was blocked or closed. Import provider spend through Integrations and reconcile exact IDs/date/currency. Missing spend is unknown, not zero. |
| 4. Form view | Form becomes visible and visitor permits measurement | One observed `viewed` event per attempt. Before consent, no RevenuePilot telemetry is sent. View counts are attempts, not unique people or ad clicks. |
| 5. Form start | Visitor changes a contact field after consenting | `started` observation; contact values are not included in telemetry. Earlier activity is not reconstructed when consent is granted later. |
| 6. Submit intent | Browser validates name, email, Indian phone and optional graduation year; visitor accepts enquiry processing | `submitted` is an observation only. Optional marketing, analytics and advertising choices are independent of required enquiry consent. No payment is requested automatically. |
| 7. Acceptance | SDK sends contact and consent to the form API; transaction commits | Lead + tenant-scoped identity + consent records + source touch (when allowed) + assigned first-response task + acceptance record. Lead shows “Existing website form”. Graduation year appears in its restricted note. Only then does the website show success. |
| 8. Deduplication / retry | Same request is retried after a lost response; returning visitor submits again | Same attempt/payload returns the same acceptance; in-flight double clicks share one request. Different data on an uncertain attempt is blocked. Same normalized email + offering within the tenant reuses a lead; this is not universal cross-channel/phone identity resolution. |
| 9. First response | Counselor opens Follow-ups, contacts prospect and records outcome | Assigned owner, due time, first response, no-answer/wrong-number/not-interested outcomes and next follow-up. Human calls do not require an AI provider. Automatic calls/messages require a separately configured provider, appropriate consent and approval. |
| 10. Qualification | Counselor records course fit or a loss reason | Lead Journey → Follow-up / stage. A manual status is not proof of a call, attended demo or payment. Unknown reasons stay unknown. |
| 11. Demo | Schedule demo; record attended, no-show or cancelled after it occurs | Lead → Demo. Host overlaps and invalid premature attendance are rejected. Scheduled does not mean attended. |
| 12. Payment offer | Finance/owner verifies the offering and generates checkout link when prospect is ready | Lead → Payment; form → Payment setup. Link generation/redirect does not mean payment. Pending/failed/unknown stays unpaid. Do not send a new charge when provider creation is uncertain; reconcile first. |
| 13. Financial confirmation | Provider signed webhook enters durable inbox; worker reconciles provider order/account/amount/currency/mode | Receipt, captured-payment milestone and enrollment evidence are created once. Sandbox/test/live/manual evidence remains distinct. Cash captured is not bank settlement. |
| 14. Enrollment / customer outcome | Full configured offer is confirmed paid | Enrollment evidence inside RevenuePilot. No LMS student record is created. This release uses an education outcome; generalized conversions remain backlog. |
| 15. Refund | Provider reports/reconciles a partial or full refund | Net revenue decreases once; enrollment becomes review-required. Stale/duplicate webhook events cannot inflate/refund twice. |
| 16. Attribution / improvement | Owner reviews Marketing, lead Journey and Reports | First/last/linear observed attribution, exact-ID campaign cost joins, missing-stage observations, stalled leads and recorded loss reasons. No causal uplift claim, invented observation or automatic ad-budget change. Any advertising conversion feedback remains separately approved. |

## Exactly what the website release covers

- `/courses/java-full-stack`, `/courses/data-analytics`, `/courses/data-science`, `/courses/ai-ml`, `/courses/python-full-stack`, plus the home course enquiry selector.
- The former CRM endpoint remains the destination when `NEXT_PUBLIC_REVENUEPILOT_ENABLED=false`. When true, these forms send to RevenuePilot only. There is no dual write and no silent fallback to the legacy platform after a failure.
- Event/workshop/placement/hackathon forms have different contracts and are not silently migrated. Direct those campaigns to a supported course form for UC-01.
- The website bundles the reviewed intake source, rather than requiring a remote script at runtime. Update the vendored copy together with the RevenuePilot SDK. No credential is shipped in the bundle.
- Same-form, same-tab source/attempt continuity is optional and lasts 30 minutes after measurement consent. Storage failures degrade to in-memory behavior. No contact fields, full referrer, complete URL or acceptance token are persisted. Successful submission and withdrawal clear the SDK continuity record.
- No consent, blocked scripts, cross-device visits, new sessions and navigation before source capture create measurement gaps. Carry approved source parameters to the destination; never add contact data to a URL. Use the dedicated course URL as the ad landing page.
- Optional legacy GA and Meta scripts are gated when RevenuePilot mode is enabled. The new form does not emit an automatic Meta Lead/Purchase conversion. Live platform feedback must use the approved evidence workflow.
- Before acceptance, uncertain network/server responses lock the original input in memory and offer “Retry same enquiry”. Definitive validation failures allow correction. Closing/reloading can lose unsent contact input; no offline-delivery guarantee is made.

## Production configuration and release order

1. Review the RevenuePilot and website changes together. Deploy RevenuePilot first; older APIs reject the new `entryPoint` and `message` fields. Older SDK requests keep their replay-hash format. Do not roll the API back beneath an enabled website without first reverting the website mode.
2. Set up a **dedicated** authenticated MongoDB replica set and authenticated Redis with private networking/TLS, backups, restore rehearsal and a stable encryption key. Use `compose.production.yaml` as the separate deployment template. `compose.yaml` and `dev:demo` are development only. No LMS database, Redis, network or credentials should be reused.
3. Set the exact HTTPS `WEB_ORIGIN`, `NODE_ENV=production`, `REVENUEPILOT_DEMO=false`, and leave live providers/account mail off during installation. Configure TLS ingress to the loopback web port. Trust only the actual private proxy IPs/CIDRs with `TRUST_PROXY_CIDRS`; otherwise rate limits see every visitor as the proxy. Ingress must append the true client address, and the API/collector must not be directly reachable from the internet. Test forged forwarded headers and real visitor separation on the chosen topology.
4. Create the owner on an access-restricted installation with registration temporarily enabled, enable MFA, verify email delivery if enabled, then disable public registration for the pilot. Add counselors, confirm their active memberships and first-response SLA. Review quota/headroom and task coverage before ad traffic.
5. Create a form for each offering in Settings → Enquiry forms. Set exact price/currency, active assignees and **exact website origins**, including `https://www.codebegun.com` and `https://codebegun.com` only if both serve forms. Add staging/local origins only on staging forms. Public keys must match the corresponding course, tenant and environment. Do not use demo form keys in production.
6. In the website build environment, use `revenuepilot.env.example`: set `NEXT_PUBLIC_REVENUEPILOT_ORIGIN` to the externally reachable **RevenuePilot web origin**, and map all five course codes to their public form key and exact backend course name. These are public settings; private provider credentials belong in RevenuePilot Integrations. Missing/malformed configuration fails visibly without sending to another system.
7. Run `npm run check:revenuepilot` in the website checkout against the actual target. It checks form availability, exact offering, allowed origin, OPTIONS preflight and production sandbox disablement without creating leads. Run for every serving website origin; use `-- --local` only for local QA. This does not test worker/provider readiness.
8. Build the website with the flag enabled in **staging**. Next.js public values are build-time values: changing environment variables after a build does not switch traffic. Verify HTTPS, no mixed content, CSP `connect-src` permits the RevenuePilot origin, browser/ad-blocker behavior and redirects preserve the campaign query. Do not broaden credentialed CORS to `*`.
9. Complete the acceptance matrix below with synthetic records in staging. If accepting live payments, certify the actual Stripe/Razorpay tenant account and webhook path using its test mode, replay/reordering and refund tests. Configure the worker/Redis, verify unknown-state reconciliation and then explicitly approve live activation. Keep keys out of chat/Git.
10. Reconcile your real course fee and enrollment policy before enabling checkout. The current offer is a **single full payment**, not installments, a ₹3,000 demo fee, tax invoicing or partial-fee enrollment. If those are required, payment/enrollment is not launch-ready for that policy. Capture-and-follow-up can operate independently while checkout remains disabled.
11. Approve the release and controlled rollout. The website repository has a master-push deploy webhook; merging the website PR can deploy. Do not merge until the API, settings, and staging checks are ready. This implementation has not changed production infrastructure or ad destinations.

## Acceptance matrix — record evidence before go-live

| Check | Required result |
| --- | --- |
| Google/Meta/YouTube tagged course URL | Correct tenant, course, source, immutable campaign/ad IDs; no payment automatically |
| Consent accepted, form visible, field changed, submitted | One observed view/start/submission, one accepted enquiry, one lead/task and correct source history |
| All optional consent declined | Enquiry/task succeed; no touch or browser observations; no GA/Meta loader in RevenuePilot mode before permission |
| Invalid email/phone/year, unchecked enquiry consent, honeypot | No accepted lead; clear error; entered details retained |
| Duplicate click / concurrent submit / lost success response | One lead/task/acceptance/financial effect; same payload replay confirms original |
| Consent version changed / wrong form / paused form / no active assignee / quota exceeded | Visible failure, no false success, no silent legacy write; correct configuration or capacity before retry |
| Origin missing/wrong, forged tenant/extra fields, foreign form/link | Rejected or source uncredited; no tenant data leakage |
| Browser storage unavailable / refresh / navigation / different campaign | Functional submission remains possible; consented same-form continuity bounded to 30 minutes; new campaign separate; gaps stated truthfully |
| Counselor no answer / connected / lost | Ownership, due follow-up, outcome and explicit loss reason visible |
| Demo overlap / no-show / attendance | Overlap and premature attendance blocked; only recorded attendance advances evidence |
| Checkout pending/cancelled/failed/unknown | No capture or enrollment; reconcile unknown before retrying a charge |
| Valid provider capture, duplicate/reordered webhook, amount/account/currency mismatch | Only matched provider evidence creates exactly one receipt/enrollment; mismatch rejected |
| Refund / repeated refund / stale event | Net amount correct and enrollment review-required; no double refund |
| Source reports / absent spend / test money | Source matches evidence; missing costs stay unknown; sandbox/test cash excluded from live figures |
| Mobile keyboard, zoom, narrow viewport, screen reader, browsers | Form labels/errors/buttons usable without overflow; consent and confirmation accessible |
| API restart, Redis/worker outage, backup restore, real proxy topology | Durable accepted enquiries survive; backlog recovered; alerts work; client IPs/rate limits behave correctly |

Automated evidence: `tests/website-flow.test.ts` uses the **real SDK over HTTP** and a MongoDB replica set, including an acknowledgement dropped after commit, through sandbox payment/refund. `tests/intake.test.ts` covers privacy, continuity, request timeout, invalid responses and retry rules. Existing security, origin, provider, marketing and journey suites cover the remaining contracts. Live gateway/account, real-domain, mobile-device, infrastructure restore and capacity checks require the actual deployment and are not substituted by these tests.

## Day-to-day operation and incident handling

- Owner: review **Marketing** source observations/costs, **Dashboard** and **Reports** gaps; inspect an individual lead's **Journey** for evidence. Counselor: work **Follow-ups** by due time; record every contact/demo result. Finance: use **Payment** and reconcile pending/unknown orders.
- Monitor acceptance errors by request ID/status, no-assignee/quota errors, HTTP 429/5xx, API readiness, Redis connectivity, oldest pending outbox/webhook, unknown payments/commands and expiring credentials. API readiness checks Mongo only. Never log contact payloads, full marketing URLs, checkout tokens or credentials.
- Per-IP form controls are bounded (20 submits/15 minutes, 60 observations/minute, 120 reads/minute). Validate realistic shared-NAT traffic before increasing capacity; CORS is not authentication or bot protection. Optional telemetry failure must not block a functional enquiry.
- If production fails, pause campaign traffic and retain logs/request IDs without PII. Reconcile whether an uncertain submission committed; do not manually duplicate it. Pause the affected form if needed. Roll the website back to its prior build/flag and rebuild; retain all RevenuePilot records. The legacy platform receives only **new** enquiries after rollback; no automatic historical synchronization is claimed.
- Keep payment callbacks and the worker running for already-created orders during a website rollback. Preserve the database and encryption key. Follow [OPERATIONS.md](OPERATIONS.md) for backup, retention, erasure and unknown provider outcomes.

## Release status

Implementation and synthetic verification are distinct from production activation. No real ad, real customer submission, provider payment, enrollment in the LMS or deployment has been performed. Record the two reviewed commit SHAs, passing CI runs, actual domain/form mapping, provider certification and operator approval in the GitHub issue before marking UC-01 live.
