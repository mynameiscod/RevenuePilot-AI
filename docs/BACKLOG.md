# RevenuePilot product goal and sequential backlog

Agreed on 15 November 2026. This is the product delivery plan; it does not mark the ten stages complete.

## Main goal

**Help a business owner understand where potential customers are lost or delayed—from an ad click or other marketing interaction through to a successful business conversion—and connect that journey to advertising cost and money actually collected.**

The owner should be able to answer:

- Where are opportunities stopping: before enquiry, during capture, during contact, before an appointment, at payment, or before the final outcome?
- How many progressed, how many are still pending, how long have they waited, and what is unknown because tracking or integration is missing?
- Is there an observed technical failure, an explicitly recorded customer reason, or only inferred inactivity?
- Who owns the next action, and which source/campaign/ad produced evidenced paying customers?

CodeBegun is the first tenant and education is the first reference use case. The product goal is cross-industry. The existing local/test implementation uses course, counselor, demo and enrollment concepts; generic terminology, optional stages and business-specific outcome rules are **planned work**, not already-delivered capabilities.

## Business-specific completion

| Business example      | Offering              | Optional intermediate step | Operational conversion                 | Financial evidence                                                            |
| --------------------- | --------------------- | -------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| Education / CodeBegun | Course                | Demo                       | Enrollment                             | Confirmed course payment under the chosen rule                                |
| Services / agency     | Service or project    | Consultation / proposal    | Customer activation or signed contract | Confirmed invoice/payment record, separately from contract signature          |
| Property sales        | Property / service    | Site visit                 | Booking or signed agreement            | Evidenced booking amount/payment; no assumption that full value was collected |
| Product sales         | Product               | Optional product demo      | Completed sale/order                   | Confirmed payment and any refunds                                             |
| Subscription business | Customer subscription | Trial / onboarding         | Active customer subscription           | Confirmed paid invoice/payment, separate from RevenuePilot's own SaaS billing |

These are design examples for stage 8, not claims that every template, deposit, installment, accounting or invoice workflow exists now. A contract signed or booking recorded is not automatically collected cash. A business may skip an appointment or have a different order of steps; reports must use its configured applicable transitions rather than impose the education funnel.

## Ten separate backlog items

Each GitHub issue contains the owner's question, existing foundation, scope, dependencies and testable acceptance criteria.

| Order | Backlog item                                                                                                           | Question it must answer                                                                                                                  | Planning status |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 01    | [Marketing source and advertising cost](https://github.com/mynameiscod/RevenuePilot-AI/issues/2)                       | Which source, campaign and ad brought the opportunity, and what did that advertising cost?                                               | Backlog         |
| 02    | [Entry points: websites, instant forms and direct enquiries](https://github.com/mynameiscod/RevenuePilot-AI/issues/3)  | Are people reaching the business's enquiry channels, and which entry points attract observable engagement?                               | Backlog         |
| 03    | [Form interaction and observed abandonment](https://github.com/mynameiscod/RevenuePilot-AI/issues/4)                   | Where does observed form activity stop: form viewed, started, submitted, or accepted?                                                    | Backlog         |
| 04    | [Lead capture, deduplication and ownership](https://github.com/mynameiscod/RevenuePilot-AI/issues/5)                   | Was the enquiry captured correctly, who owns it, and has anyone responded?                                                               | Backlog         |
| 05    | [Contact, qualification and follow-up](https://github.com/mynameiscod/RevenuePilot-AI/issues/6)                        | Was contact made, is the offer relevant, what was the outcome, and what should happen next?                                              | Backlog         |
| 06    | [Demo, consultation or sales appointment](https://github.com/mynameiscod/RevenuePilot-AI/issues/7)                     | Are qualified prospects booking the next appointment, attending it, and progressing afterward?                                           | Backlog         |
| 07    | [Payment status and collected money](https://github.com/mynameiscod/RevenuePilot-AI/issues/8)                          | Is money pending, failed, confirmed or refunded, and how much has actually been collected?                                               | Backlog         |
| 08    | [Configurable business conversion and customer outcome](https://github.com/mynameiscod/RevenuePilot-AI/issues/9)       | Which opportunities became actual customers, and does the recorded success match the business's completion rules and financial evidence? | Backlog         |
| 09    | [Revenue attribution by source, campaign and ad](https://github.com/mynameiscod/RevenuePilot-AI/issues/10)             | Which marketing interactions produced business conversions and collected revenue, rather than only enquiries?                            | Backlog         |
| 10    | [Business-owner drop-off dashboard and improvement feedback](https://github.com/mynameiscod/RevenuePilot-AI/issues/11) | Where are opportunities being lost or delayed, what should the team act on next, and which evidenced outcomes can inform advertising?    | Backlog         |

**Selected scope: UC-01 existing website forms — implementation ready for review; production activation pending.** See [the full operating flow and release gates](WEBSITE_FLOW.md). Existing features should be reused and checked against the expanded business goal; this is not a rebuild from zero.

## Business use cases within the stages

The [eight business use cases and detailed acceptance checklists](BUSINESS_USE_CASES.md) cover existing website forms, RevenuePilot-hosted forms, Meta Instant Forms, WhatsApp enquiries, inbound phone calls, walk-ins, referrals and existing CRM imports. They are recorded under the relevant existing GitHub issues; no duplicate top-level stages are needed.

Source, actual contact route, ingestion mechanism and offering must remain separate. The shared backlog also covers safe contact/opportunity matching, assignment and follow-up, optional appointments, payment evidence and the separation of Offering / Entry point / Lead journey. Referral is a source, and a CRM is an ingestion mechanism; neither should erase the original contact route when it is known.

UC-01 now has paired RevenuePilot and CodeBegun website changes for review, with synthetic SDK/API journey evidence. Production domain/form mapping, browser acceptance and provider certification remain open. Other use cases remain in Backlog; Meta Instant Forms remains deferred.

## One stage at a time

1. Select the next numbered item and mark it In progress.
2. Inspect the current implementation and acceptance evidence; identify only the gaps for that item.
3. Implement the smallest coherent increment, using the existing stack and independent tenant/provider boundaries.
4. Demonstrate the owner's question in the UI with a controlled scenario, including the failed/pending/unknown paths; record the checks and limits in the issue.
5. Move the item to Ready for review. After review, close it as Done for the explicitly agreed scope, then move to the next item.

Use **Backlog → In progress → Ready for review → Done**. If a provider or external installation is required, record that dependency as blocked; do not silently activate it or describe an unverified live flow as complete. Evidence produced by later stages can be joined later without pretending those stages have already shipped. Shared terminology/configuration should be introduced within the stage that needs it; a new full-platform rewrite is not a prerequisite for stage 1.

## Measurement rules across all items

- Keep provider-reported aggregate ad clicks, consented anonymous observations, accepted enquiries, identifiable leads, operational conversions and paid conversions distinct.
- For each applicable transition, define the population/cohort, date basis, window, denominator and maturity threshold. Show progressed, pending, explicit loss, inferred stall, skipped/not applicable and unknown/unobserved separately.
- Rates must not compare incompatible populations or call every non-progressed record a lost customer. A missing tracking event is not proof of abandonment.
- Carry tenant, source, entry point, offering, owner, timestamps, evidence provenance and applicable consent through supported joins.
- Preserve configurable stage names and outcome rules with history/version context. Changing a business template must not rewrite old evidence.
- Keep collected amounts, refunds, currency and manual/sandbox/test/provider-verified evidence distinct. Attribution is descriptive, not a claim of causal advertising impact or profitability.
- Present one clear owner view and one lead journey. Prioritize the next action while keeping evidence and missing data accessible.
- Retain role access, PII protection, tenant isolation, audit history and provider-agnostic connectors across industries.

## Existing deferred integration

[Issue #1 — CodeBegun website and Meta Instant Forms](https://github.com/mynameiscod/RevenuePilot-AI/issues/1): **website implementation ready for review; Meta Instant Forms deferred**. It is the existing live-integration work related to items 01, 02 and 04, not an eleventh stage or an automatically activated dependency. Website observations and provider instant-form metrics have different visibility; missing pre-submission histories must not be invented.

## Current foundation and release boundaries

See [the implementation record](ROADMAP.md), [acceptance evidence](ACCEPTANCE.md), [architecture](ARCHITECTURE.md) and [marketing guide](MARKETING.md) for what currently exists. UC-01 changes application code in RevenuePilot and the website only. No deployment, LMS change or live outreach is included. The wider ten-stage, multi-industry backlog is not marked complete by this release.
