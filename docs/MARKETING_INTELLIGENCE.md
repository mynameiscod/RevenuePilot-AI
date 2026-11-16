# Marketing intelligence and recovery — implementation record

Updated 16 November 2026. Parent: [architecture epic #13](https://github.com/mynameiscod/RevenuePilot-AI/issues/13). This document separates implemented code, deployment and live-provider acceptance. It does not certify the entire proposed architecture as complete.

## Product and architecture alignment

The goal is to help an owner find where opportunities stop, inspect the evidence, choose a recovery action and relate subsequent business outcomes to collected revenue. CodeBegun is the first tenant. An anonymous form starter is an observed attempt, not an identified lead who can be called or uploaded to Customer Match.

| Architecture block       | Current foundation / this increment                                                                                     | Remaining backlog                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| All lead sources         | Managed campaign links, source evidence, hosted/external website capture, manual leads and existing provider contracts  | Native Meta forms, inbound WhatsApp/phone, walk-in/referral normalization, CRM origination versus importing-system provenance; #1 #2 #3 |
| AI Lead Intelligence     | Strict capture validation, tenant-local deduplication, qualification outcomes                                           | Explainable intent/fit/scoring, model evaluation, confidence, overrides and business profiles; #15 #5 #6                                |
| Sales Intelligence       | Unified lead journey, assignment, recorded contact outcomes, tasks and appointment history; new overdue-task suggestion | Certified calling integrations, deeper call insights, configurable SLA and alerts; #6 #7                                                |
| Funnel Intelligence      | New Overview and Observed gaps: pending, mature activity, observed errors, acceptance and missing observations          | Cross-source cohort comparison, configured stage transitions, materialized analytics, automated anomaly alerts; #4 #11                  |
| Revenue Attribution      | Existing first/last/linear allocation with distinct manual/test/provider evidence; direct link to Reports               | Live spend/payment reconciliation and business-specific outcomes; #8 #9 #10                                                             |
| AI Recommendations       | New Ideas view with deterministic rules, evidence, an action and a metric                                               | Model-backed explanations, evaluation and approval controls; #11 #15. Current ideas are not AI predictions                              |
| Closed-loop optimization | Recovery-plan drafts and Google/YouTube setup recipes; separate website measurement/personalization controls            | Actual account activation, certified audience sync, suppressions, outcome feedback and controlled uplift experiments; #14 #11           |

The integration boundary is website SDK → public capture API → tenant-scoped MongoDB records → aggregate read API / recovery-plan API → React Marketing views. Existing Redis/BullMQ provider jobs remain separate. No new background job launches an audience or ad. No LMS access or changes are required.

## End-to-end business example

1. An owner creates a managed Google campaign link for the configured Java website form. The destination retains `rp_link` and the available campaign/ad IDs. An existing website must already have the capture integration installed; a campaign URL alone cannot track it.
2. A visitor grants optional website measurement. A visible form records a view; editing a non-checkbox input records a start. The observer records no typed field contents. With no measurement permission, the functional enquiry still works and no browsing history is reconstructed.
3. A submission attempt records `submitted`. Validation/network/server/rate-limit symptoms may record `failed`. Only the server transaction establishes acceptance, creates or reuses the lead, retains available source evidence and assigns a follow-up.
4. Recent activity remains pending. After 30 minutes from the latest retained observation, unaccepted activity is grouped by form/source/campaign. This is a diagnostic maturity rule, not proof that a person abandoned or why.
5. The owner checks observed problems first. An API failure needs repair or investigation; extra ad spend is not a repair. For genuine follow-up opportunities the owner can save a recovery plan and obtain provider-specific setup instructions.
6. For Google/YouTube, the website emits allowlisted GA4 events only with measurement permission. Advertising personalization requires an additional explicit choice. A separately configured GA4 audience includes starters and excludes accepted enquiries for the same form. Google determines eligible membership and delivery; RevenuePilot cannot target a named anonymous visitor.
7. A reviewed recovery campaign uses a distinct managed campaign link. If the visitor returns and submits, the current source is retained where available. Same-tab consented continuity is bounded; no cross-device stitching or retrospective history is invented.
8. Staff work the accepted enquiry in Leads: contact → qualification → appointment where appropriate → payment evidence → business outcome. Reports show attribution under the selected model and evidence category. Attribution is not causal uplift; an experiment is required to assess incremental recovery.

## UI specification and operating paths

Open **Marketing** in the workspace. Seven keyboard-accessible tabs are available. Owners/admins can create plans; analysts can inspect aggregate marketing but cannot write plans. Other roles do not gain marketing access.

| View            | What to inspect / do                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview        | Awaiting acceptance, observed problems, overdue tasks, independently recorded sales milestones; links to a lead journey and revenue reports                               |
| Observed gaps   | Mutually exclusive states by form, offering, source and campaign; pending and unknown remain explicit                                                                     |
| Retargeting     | Choose an active tenant form, Google/YouTube or Meta planning, start/view behavior and 1–90 day membership; save a draft, inspect/download rules, pause or reopen a draft |
| Ideas           | Inspect the observed fact, suggested action and success metric. No action runs automatically                                                                              |
| Campaign links  | Existing campaign setup and website integration helpers                                                                                                                   |
| Sources         | Existing channel breakdown and imported spend evidence                                                                                                                    |
| Source evidence | Existing source coverage and links to individual lead journeys                                                                                                            |

Routes preserve the selection, for example `/marketing?view=gaps`, `/marketing?view=recovery`, `/marketing?view=ideas`. Empty results explain missing observations. Oversized reports fail explicitly instead of silently truncating. Forms, dialogs and tab controls reuse the application's accessible components. Responsive grids and a scrolling data table are implemented; physical mobile-device acceptance is still required.

The complete identified chronology remains **Leads → select lead → Journey / Activity / Source history**. Anonymous starters have no contact profile. This increment deliberately provides aggregate gap diagnostics, not an identifying visitor surveillance screen.

## Schemas and API contract

Executable requests are in `packages/core/src/journey.ts` and `recovery.ts`; generated contracts are in [REQUEST_SCHEMAS.json](REQUEST_SCHEMAS.json). `T` below means `/api/v1/tenants/:tenantId`.

| Endpoint                                      | Contract                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `T/marketing/intelligence?days=30`        | `marketing.read`; days 7/30/90. Returns period, observation counts/groups, sales milestone coverage, ideas, safe form names, recovery plans, capabilities and limits |
| POST `T/marketing/recovery-plans`             | `settings.write`, normal session/CSRF, required `Idempotency-Key`; strict `{name,formId,provider,segment,membershipDays}`; 201 `{id,status:"draft",version:0}`       |
| PATCH `T/marketing/recovery-plans/:id`        | `settings.write`, session/CSRF; strict `{status:"draft"                                                                                                              | "paused",version}`; version match required; 409 if changed/unavailable |
| GET `T/marketing/recovery-plans/:id/recipe`   | `marketing.read`; same-tenant plan/form; rules only, no audience contacts or anonymous IDs; 404 foreign/missing plan                                                 |
| POST `/api/v1/public/forms/:publicKey/events` | Existing exact-origin, consented observation route now accepts `type:"failed"` and optional enum `failureCode`: validation/network/server/rate_limited/unknown       |

RecoveryPlan stores immutable `tenantId`, UUID `_id`, timestamps, `createdBy`, name (3–100 chars), same-tenant form UUID, provider (`google_ads`/`meta`), segment (`started_not_accepted`/`viewed_not_accepted`), membershipDays (integer 1–90), draft/paused status and optimistic version. Index: tenant plus creation time. The 100-plan cap includes paused plans. Plan rules are immutable after creation; create a new plan for a changed segment/window. There is no active/synced/delivered status because the implementation does not perform those operations.

Attempt adds optional `failedAt` and allowlisted `failureCode`. Existing attempt/form/tenant identity, first-source snapshot, accepted timestamp and retention stay in use. The SDK deduplicates observation types and preserves an uncertain submission payload for exact retries. This is not a keystroke log or an exhaustive failure timeline. Existing acceptance takes precedence over earlier failure observations.

The recipe exposes schemaVersion, provider, readiness, membershipDays, include/exclude event rules, requirements, planStatus and formActive. Google is `manual_provider_setup_required`; Meta is `connector_backlog` with no fabricated Google-to-Meta rules. `identityExport` and `automaticActivation` are false. A paused local plan does not pause an independently created provider campaign.

## Evidence semantics

Classification precedence: accepted → pending (<30 minutes since latest recorded event) → observed problem → submitted without acceptance → started without acceptance → viewed without start → earlier activity unavailable. Each retained attempt appears once. Counts are not unique people, ad clicks, or eligible Google users. A recorded validation error may reflect an incomplete form; a network failure may prevent its own telemetry from arriving.

The intelligence endpoint uses a rolling 7/30/90-day attempt/lead creation window in UTC and excludes expired attempts. The older source cards use UTC calendar bounds including today; boundary records can therefore differ. Retention and separate cohorts also affect comparisons. Sales milestones count unique leads in the selected creation cohort that have recorded each milestone; skipped steps are not fabricated and these counts are not a sequential funnel. Historical seeded stages may have no corresponding milestone evidence.

Recovery previews use the shorter of the reporting window and membership window, exclude accepted/pending/unknown attempts, and count matching start/view behavior. They can include technical problems, which the UI asks operators to investigate first. `providerMatchedUsers` is always null until a real provider read is implemented. These previews do not establish that advertising consent was granted or that Google can match the person. Google handles its own consent, membership, exclusions, processing delay and eligibility.

## Security, privacy and failure behavior

- Public capture stays bound to its configured exact website origins and tenant form. Tenant IDs and secrets are never supplied by the public website.
- Every aggregate, plan and recipe query is tenant-filtered. Mutations enforce RBAC, CSRF, strict input, audit, idempotency on creation and optimistic locking on status change. Plan creation and the cap check run under the existing tenant transaction lock.
- Reads cap attempts at 20,000, leads at 10,000, forms at 1,000, plans at 100 and milestones at 100,000; overflow returns `REPORT_TOO_LARGE`. Pre-aggregation/pagination is future scaling work.
- Report/recipe responses do not expose names, email, phone, acceptance tokens, raw browser IDs or form field values. Provider credentials remain in the existing encrypted connector store.
- Website v2 consent separates analytics, advertising measurement and personalized Google/YouTube ads. Old v1 permission is not promoted. Consent defaults denied, expires after 30 minutes in the current tab, and withdrawal blocks future events. Already sent requests/history cannot be recalled by clearing a browser choice.
- Google recovery is off by default. Events contain only public form ID, configured offering key, schema version and allowlisted failure category. Explicit page URLs omit query/fragment and referrers retain origin only. Optional tag failures cannot turn an accepted enquiry into a failed form.
- No form partials are collected for Customer Match. Customer-list export, cross-device identity, audience synchronization and deletion propagation require separate reviewed provider work.

## Verification and rollout

Automated verification: the RevenuePilot suite passes 110 tests across 15 files, including new classification and recovery API tests. Both projects pass TypeScript and production builds. Website tests exercise denied/granted/withdrawn/re-granted/expired choices, disabled feature flag, pre-initialization queue, safe payloads, broken-tag isolation and acceptance separation. API tests cover foreign tenants, role denial, idempotency, stale versions, strict inputs and acceptance overriding a prior observed problem. Existing intake tests cover uncertain retries and server-confirmed acceptance.

Local browser QA uses synthetic demo data: Overview, recovery-plan creation, provider recipe, pause/reopen, gaps and ideas. No real ad account or customer is used. See [ACCEPTANCE.md](ACCEPTANCE.md) and the commit's CI for the final execution record.

Rollout order: back up persistent RevenuePilot data; deploy its API/web/collector/worker build using [HOSTINGER_VPS.md](HOSTINGER_VPS.md); verify health and marketing role access; deploy website code with the Google recovery flag still off; configure and verify a dedicated consenting Google test using [the website activation guide](https://github.com/mynameiscod/cbwebsite/blob/master/docs/REVENUEPILOT_GOOGLE_RECOVERY.md); only then enable the build-time flag and rebuild. No production deployment or provider activation is claimed by local checks.

Rollback: turn the Google flag off and rebuild the website; stop separately configured campaigns in Google if needed. This does not stop functional enquiry capture. Existing API consumers remain compatible with the optional failure event. Rolling API code back before the website can reject optional failure telemetry, but does not change the submit contract. Preserve database volumes and audit history; do not use destructive volume removal.

## Remaining delivery sequence

1. Complete controlled deployed acceptance of UC-01 and the Google audience recipe, including a visitor who declines all tracking, a starter, validation failure, API failure, safe retry and accepted-user exclusion.
2. Certify Meta instant forms, inbound messaging/phone, manual/referral/CRM source distinctions and consent provenance (#1 #3 #5).
3. Implement the versioned business profile and explainable lead-intelligence engine, evaluate it against human outcomes and retain human overrides (#15 #6 #9).
4. Add provider-specific audience sync, withdrawal/deletion reconciliation, downstream recovery and alerts with approval/audit (#14 #11).
5. Reconcile source costs, verified payments/refunds and outcome feedback; use a controlled experiment to assess incremental results (#8 #10 #11).

Status discipline: Backlog → In progress → Code complete/review → Deployed → Live verified. An issue stays open while its declared live or wider architecture acceptance is incomplete.
