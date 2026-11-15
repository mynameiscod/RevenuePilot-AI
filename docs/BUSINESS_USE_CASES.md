# Business use cases and backlog mapping

Updated 15 November 2026. **Status: Backlog.** These are eight business use cases within the existing ten delivery stages, not eight new stages. All were matched to existing issues; no duplicate top-level issues were created.

## Goal and shared concepts

A business owner should understand where opportunities are lost or delayed between marketing and a business-specific successful conversion, which action is next, and how source/cost relates to collected money. CodeBegun is the first tenant; the same model must fit services, sales, bookings, subscriptions and other business outcomes.

Keep four concepts separate:

| Concept             | Question                                    | Example                                                    |
| ------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Acquisition source  | Where did the person discover the business? | Meta Ads, Google search, referral, unknown                 |
| Entry/contact route | How did the person contact the business?    | Website form, Instant Form, WhatsApp, phone, walk-in       |
| Ingestion mechanism | How did the record reach RevenuePilot?      | SDK/API, provider event, CRM import, staff entry           |
| Offering            | What is the opportunity about?              | Java course, consulting project, property booking, product |

For example, a customer can originate from Meta Ads, contact the business on WhatsApp, and arrive in RevenuePilot through a CRM import. The source must not be replaced by either WhatsApp or the CRM. Referral is a discovery source; its contact route can be phone, website, WhatsApp or walk-in. Unknown source and unavailable evidence remain explicit.

## Use-case index

| ID    | Business use case                        | Primary backlog issue                                         | Related issues                                                                                                                                                                                                                                                                                                                                                                             | Status  |
| ----- | ---------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| UC-01 | Existing website or landing-page form    | [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3) | [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#4](https://github.com/mynameiscod/RevenuePilot-AI/issues/4), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5)                                                                                                                                                                                                | Backlog |
| UC-02 | RevenuePilot-hosted enquiry form         | [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3) | [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#4](https://github.com/mynameiscod/RevenuePilot-AI/issues/4), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#8](https://github.com/mynameiscod/RevenuePilot-AI/issues/8), [#9](https://github.com/mynameiscod/RevenuePilot-AI/issues/9)                                                                  | Backlog |
| UC-03 | Meta / Instagram / Facebook Instant Form | [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3) | [#1](https://github.com/mynameiscod/RevenuePilot-AI/issues/1), [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5)                                                                                                                                                                                                | Backlog |
| UC-04 | WhatsApp inbound enquiry                 | [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3) | [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6), [#10](https://github.com/mynameiscod/RevenuePilot-AI/issues/10)                                                                                                                               | Backlog |
| UC-05 | Inbound phone enquiry                    | [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3) | [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6)                                                                                                                                                                                                | Backlog |
| UC-06 | Walk-in enquiry                          | [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5) | [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3), [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6), [#7](https://github.com/mynameiscod/RevenuePilot-AI/issues/7)                                                                                                                                 | Backlog |
| UC-07 | Referral-originated enquiry              | [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2) | [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#10](https://github.com/mynameiscod/RevenuePilot-AI/issues/10)                                                                                                                                                                                              | Backlog |
| UC-08 | Existing CRM lead/import                 | [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3) | [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6), [#8](https://github.com/mynameiscod/RevenuePilot-AI/issues/8), [#9](https://github.com/mynameiscod/RevenuePilot-AI/issues/9), [#10](https://github.com/mynameiscod/RevenuePilot-AI/issues/10) | Backlog |

Primary ownership avoids duplicating work across stages. [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3) holds the route-setup checklists; [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5) owns canonical identity/ownership and walk-in capture; [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2) owns referral/source evidence. Existing delivery order and review gates in [BACKLOG.md](BACKLOG.md) remain unchanged.

## UC-01: Existing website or landing-page form

**Example:** Google/Meta ad, organic search or referral → existing business website → enquiry submission.

**Current foundation / gap:** Campaign links and the external intake SDK/API exist; the CodeBegun website is not connected.

**Primary issue:** [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3). **Related:** [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#4](https://github.com/mynameiscod/RevenuePilot-AI/issues/4), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5).

**Backlog acceptance:**

- [ ] Connect an existing form using the SDK/API without replacing the website design; validate the exact origin and preserve permitted source/campaign/ad evidence through submission.
- [ ] Keep visitor permission choices, observed form attempts and authoritative lead acceptance distinct; show setup, last successful capture and errors rather than implying a generated link has installed tracking.
- [ ] A synthetic valid submission appears once with offering, source, entry point and owner; replay, opt-out and unavailable tracking cases remain correct.

## UC-02: RevenuePilot-hosted enquiry form

**Example:** Instagram bio, email, QR code or campaign link → RevenuePilot form → enquiry submission.

**Current foundation / gap:** Hosted enquiry forms and campaign links work in the local demo; the current form bundles course, price and assignment.

**Primary issue:** [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3). **Related:** [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#4](https://github.com/mynameiscod/RevenuePilot-AI/issues/4), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#8](https://github.com/mynameiscod/RevenuePilot-AI/issues/8), [#9](https://github.com/mynameiscod/RevenuePilot-AI/issues/9).

**Backlog acceptance:**

- [ ] Allow several tagged campaigns to use the same hosted form/entry point; do not require a new form for every advertisement.
- [ ] Explain Create form, Open form, Pause and Payment setup in the UI: a displayed offering price is not ad spend or a per-enquiry fee, and submitting an enquiry must not charge the visitor.
- [ ] Show local/demo versus publicly reachable capture clearly. Test a synthetic submission and pause/resume; create the appropriate opportunity and initial follow-up once.

## UC-03: Meta / Instagram / Facebook Instant Form

**Example:** Meta ad → native Instant Form → provider submission → RevenuePilot.

**Current foundation / gap:** A basic paged Meta form-lead import exists; automatic lead notifications, complete mapping and live CodeBegun validation remain deferred in #1.

**Primary issue:** [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3). **Related:** [#1](https://github.com/mynameiscod/RevenuePilot-AI/issues/1), [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5).

**Backlog acceptance:**

- [ ] Retrieve new submissions through verified provider notification/API handling with replay-safe recovery and reconciliation; retain supplied lead/form/account/campaign/ad IDs, timestamps and mapped answers.
- [ ] Map the external form to an offering/owner without asking the prospect to submit a second RevenuePilot form or open the website.
- [ ] Create one canonical opportunity/follow-up per documented matching policy; do not manufacture website visits, person-level form starts or abandonment histories that the provider does not supply.

## UC-04: WhatsApp inbound enquiry

**Example:** Ad, website button, social profile or referral → incoming business WhatsApp message → matched contact/opportunity.

**Current foundation / gap:** Manual Add lead is available. The current WhatsApp adapter supports approved template sends, statuses and STOP handling, not general inbound-message lead creation.

**Primary issue:** [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3). **Related:** [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6), [#10](https://github.com/mynameiscod/RevenuePilot-AI/issues/10).

**Backlog acceptance:**

- [ ] Add tenant-scoped inbound business-message handling with sender/message identity, provider event IDs and supported source/referral metadata; distinguish new sales enquiries from replies to an existing conversation.
- [ ] Link repeated messages to the right contact/opportunity and record the owner's first human/AI response separately from automatic acknowledgement. Apply stop requests and the relevant consent rules.
- [ ] Retain evidenced Meta/other acquisition source separately from WhatsApp as the contact route. Missing ad/referral evidence stays unknown; live inbox activation is not implied by this backlog.

## UC-05: Inbound phone enquiry

**Example:** Search/ad/referral/signboard → person calls the business → manual entry or approved telephony events.

**Current foundation / gap:** Manual lead entry/contact outcomes work. Automatic inbound telephony-to-lead ingestion is not implemented; Outpero's correlated outbound-call events do not provide it.

**Primary issue:** [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3). **Related:** [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6).

**Backlog acceptance:**

- [ ] Provide a manual phone-enquiry path and a separate inbound-telephony connector path using tenant/provider event IDs, caller identity where available, time and answered/missed outcome.
- [ ] Treat one business call and its retries/status events as one interaction; record repeat calls on the existing contact/opportunity rather than creating a lead for every event.
- [ ] Capture 'How did you hear about us?' as self-reported evidence. Attribute an exact ad only with reliable tracking metadata; a common phone number alone cannot establish it.

## UC-06: Walk-in enquiry

**Example:** Person visits an office/showroom → staff captures an enquiry → assigned sales follow-up.

**Current foundation / gap:** Leads → Add lead can record a person, known source, offering and notes. Walk-in is currently a note rather than a structured entry type.

**Primary issue:** [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5). **Related:** [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3), [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6), [#7](https://github.com/mynameiscod/RevenuePilot-AI/issues/7).

**Backlog acceptance:**

- [ ] Add an explicit Walk-in entry route with visit time, staff member/branch where relevant, offering and known original source; no public form or gateway setup is required just to register interest.
- [ ] Check for an existing contact/opportunity before creating another; support phone-only or email-only capture and surface the case where neither identifier is available for a deliberate business rule rather than inventing details.
- [ ] Create the applicable owner/task once; continue in-person conversation or appointment evidence without inventing a phone call, website visit or abandoned form.

## UC-07: Referral-originated enquiry

**Example:** Friend/partner/customer recommendation → phone, WhatsApp, website form or walk-in → opportunity.

**Current foundation / gap:** Referral is an available acquisition source; the contact route and referral context can be recorded in notes. Structured referral provenance/matching is planned.

**Primary issue:** [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2). **Related:** [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#10](https://github.com/mynameiscod/RevenuePilot-AI/issues/10).

**Backlog acceptance:**

- [ ] Represent Referral as the discovery source while keeping the actual contact route (phone, WhatsApp, website or walk-in) separate.
- [ ] Record available referrer/campaign/code and self-reported or verified provenance without collecting unnecessary referrer PII or implying consent from the referred person.
- [ ] Preserve a later referral touch alongside any earlier source; show missing evidence explicitly and do not overwrite the original source or invent ad spend.

## UC-08: Existing CRM lead/import

**Example:** Another CRM receives the enquiry → scoped connector/API event → RevenuePilot opportunity and linked outcomes.

**Current foundation / gap:** Basic HubSpot contacts and signed generic CRM intake exist. A complete CodeBegun CRM connection, field mapping and outcome/payment sync are not configured.

**Primary issue:** [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3). **Related:** [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2), [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6), [#8](https://github.com/mynameiscod/RevenuePilot-AI/issues/8), [#9](https://github.com/mynameiscod/RevenuePilot-AI/issues/9), [#10](https://github.com/mynameiscod/RevenuePilot-AI/issues/10).

**Backlog acceptance:**

- [ ] Choose which system owns contact fields, assignment, sales status and financial truth; map external contact/opportunity/event IDs and preserve the original source/entry route where supplied.
- [ ] Treat the CRM as the ingestion system, not automatically the acquisition source. Duplicate imports and a direct capture arriving through both paths must not create duplicate contacts/opportunities/tasks.
- [ ] Define permitted one-way or two-way status/outcome/payment handoff explicitly, with sync errors, conflicts and audit provenance. A CRM 'paid' flag alone is not provider-verified payment; no LMS access or writeback is authorized here.

## Shared product and UI backlog

| Work                                             | Existing issue                                                  | Acceptance focus                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Source separate from contact route and ingestion | [#2](https://github.com/mynameiscod/RevenuePilot-AI/issues/2)   | Preserve original and later evidence; Meta Ads → WhatsApp remains a Meta-origin opportunity when evidenced                       |
| Explain and configure every capture route        | [#3](https://github.com/mynameiscod/RevenuePilot-AI/issues/3)   | Draft/test/connected/healthy/stale states; no forced second form; real public capture requires a reachable installation          |
| Observe only applicable form stages              | [#4](https://github.com/mynameiscod/RevenuePilot-AI/issues/4)   | Website/hosted telemetry under consent; no invented website drop-off for WhatsApp, calls, walk-ins or native forms               |
| Match contacts, opportunities and owners         | [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5)   | Safe phone/email/provider matching, ambiguous-match review, distinct offerings, one task per acceptance policy                   |
| Channel-aware conversation and follow-up         | [#6](https://github.com/mynameiscod/RevenuePilot-AI/issues/6)   | Substantive response versus acknowledgement; missed/answered calls; in-person conversations; CRM outcome ownership               |
| Optional business appointment                    | [#7](https://github.com/mynameiscod/RevenuePilot-AI/issues/7)   | Demo, consultation or site visit from any route; skipped step is not abandonment                                                 |
| Payment independent of entry form                | [#8](https://github.com/mynameiscod/RevenuePilot-AI/issues/8)   | Enquiry does not charge; quote-first capture is permitted by policy; provider evidence and refund reconciliation remain separate |
| Separate Offering / Entry point / Lead journey   | [#9](https://github.com/mynameiscod/RevenuePilot-AI/issues/9)   | Decouple import mapping from public-form records; generic business terms/rules; preserve existing links/history during migration |
| Attribute revenue across route changes           | [#10](https://github.com/mynameiscod/RevenuePilot-AI/issues/10) | Source and route filters; no double count from direct capture plus CRM copies; unsupported exact-ad attribution stays unknown    |
| Owner view for all eight use cases               | [#11](https://github.com/mynameiscod/RevenuePilot-AI/issues/11) | Comparable cohorts; missing measurement, pending work, explicit loss, inferred delay and skipped steps stay distinct             |

## Enquiry forms screen: required explanation

The current screen combines an offering, full enrollment price, owner mapping and a hosted form. Imported leads currently depend on an active form record for offering/owner mapping; the prospect does not have to open it. Separating those responsibilities is planned in [#9](https://github.com/mynameiscod/RevenuePilot-AI/issues/9).

- **Create form:** creates a hosted entry point and its current configuration; it does not install anything on an existing website or connect a provider automatically.
- **Open form / enquiry link:** opens the customer-facing form. Several campaign links can point to one form.
- **Offering price:** the displayed ₹35,000 example is the configured full course offer, not ad spend or a per-lead fee. Enquiry submission is not a financial charge.
- **Payment setup:** configures the gateway for a later checkout; it must not be required merely to capture a quote or general enquiry in the intended generic model.
- **Pause:** explain exactly which route/mappings are affected, including legacy active-form import dependencies, before changing its state.
- **Local/demo:** a localhost link is for local testing. Public collection requires a reachable configured installation; sample data and sandbox payments are not live business evidence.

These explanations belong in the relevant UI, not only in engineering documentation. They are backlog acceptance requirements, not a claim that the screen has already been redesigned again.

## Current manual route and gaps to close

Today, staff can use **Leads → Add lead** for WhatsApp, phone, walk-in and referral enquiries. Record the known acquisition source, course/product interest and contact details; put the contact route and customer-reported context in Notes until structured fields exist. Record the actual outcome and next date in **Follow-up**.

Manual creation currently assigns the creator, does not provide complete cross-channel matching and does not create the same initial task as hosted/imported acceptance. Check existing records first. These gaps are explicit tasks in [#5](https://github.com/mynameiscod/RevenuePilot-AI/issues/5), not capabilities assumed to be finished.

All routes should meet at the same scoped contact/opportunity journey. That does not require all people to pass through all ten stages. A lead that never visited the website must not be counted as a failed website visitor. A signed contract, booked appointment or selected success status must not fabricate payment evidence.

## Deferred work and verification

[#1](https://github.com/mynameiscod/RevenuePilot-AI/issues/1) remains deferred for actual CodeBegun website and Meta Instant Forms integration. Incoming WhatsApp-to-lead capture, inbound telephony, complete CRM handoff and the generic offering/entry-point split are planned work under the linked issues, not activated integrations.

This update changes GitHub backlog descriptions and planning documents only. Acceptance checklists remain unchecked. It does not modify application behavior, connect live accounts, send messages/calls, execute payments, deploy, or touch the LMS. Validate each selected use case against its parent stage, retain the existing one-stage-at-a-time delivery plan, and record any external dependency before claiming completion.
