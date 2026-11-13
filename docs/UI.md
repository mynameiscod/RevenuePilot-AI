# UI specification — RevenuePilot 0.2

## Visual and interaction system

Retain the independent RevenuePilot identity: purple primary actions, white/light lavender surfaces, Manrope headings, DM Sans text, thin neutral borders, restrained elevation and Lucide icons. Bootstrap 5 provides form/table/layout primitives; no third-party font calls. Responsive layouts collapse paired panels and make wide financial tables horizontally scrollable. Reduced-motion preferences disable decorative motion. Navigation shows only applicable tenant permissions; API enforcement remains authoritative.

The fixed desktop workspace rail contains tenant selection, main workflows, settings/help and signed-in identity. The header provides current workspace/page, lead search and refresh. Small screens use the existing collapsed navigation. Pages have explicit loading, empty, error/retry and success states; destructive/privileged actions use reviewed dialogs. Forms have labels, visible keyboard focus, required/range validation and error summaries. Dialogs manage focus/Escape; tables retain headers. Avoid color-only status cues.

## Navigation and the lead workspace

The main menu has five entries: **Dashboard**, **Leads**, **Follow-ups**, **Marketing**, **Reports**. **Settings** is the separate entry for enquiry forms, integrations, team/account, workspace preferences and the provider catalog. Navigation retains the existing tenant/role permissions.

**Leads → open a lead** is the canonical journey page. It shows the contact/source, one next action, five evidence checkpoints, and four keyboard-accessible tabs: **Journey**, **Follow-up**, **Demo**, **Payment**. Finance permissions control the Payment tab. Source details, imported calls, milestones and consent evidence use disclosure sections. Switching lead or tenant resets forms, dialogs and generated checkout links.

A checkpoint becomes complete from recorded evidence, not from the lead's manually chosen status. No answer is an attempt, a future demo is scheduled, and a refund requires enrollment review. A direct enrollment does not fill in a missing conversation or demo. Old `/leads/:id/workflow` bookmarks redirect to `/leads/:id` while preserving their tab; `/journeys` redirects to Reports.

## Screens and contracts

| Screen / route                                | Principal content                                                                                | Actions and safeguards                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in `/`                                   | Email/password, MFA or recovery code, sample workspace                                           | Error shown inline; demo clearly synthetic; forgot-password link; no shared production login                                                         |
| Registration                                  | Name/email/password/workspace name                                                               | Creates independent tenant/owner; verification queued                                                                                                |
| Recovery `/forgot-password`, `/account/reset` | Email request, fragment token, new password                                                      | Generic request response; expired/single-use errors; reset revokes sessions                                                                          |
| Verification/invite `/account/:action`        | Explicit link confirmation                                                                       | Invite must be accepted by matching signed-in email; no automatic link side effects                                                                  |
| Settings `/setup`                             | Grouped configuration entry points                                                               | Filters administrative cards by role; self-service preferences remain reachable                                                                      |
| Dashboard `/`                                 | Enquiries, overdue first contact, qualified leads, net cash; due work and current pipeline       | 7/30/90-day cohort; finance restriction; sample data notice; direct links to follow-ups/leads/reports                                                |
| Leads `/leads`                                | Search, stage filters, pagination, owner-scoped fields                                           | Add lead; no PII search oracle for restricted roles                                                                                                  |
| Lead journey `/leads/:id`                     | Contact/source, next action, independent checkpoints, timeline, follow-up, demo and payment tabs | Versioned status note; stop outcomes suppress; booking/attendance validation; sandbox/live evidence; finance and PII controls retained               |
| Follow-ups `/work`                            | Open follow-ups by due date and scheduled demos                                                  | Opens the relevant tab on the canonical lead page; dates use tenant timezone                                                                         |
| Marketing `/marketing`                        | Campaign links first, Sources and Source evidence tabs; visits, enquiries and source coverage    | Immutable source details, consent, imported costs and role checks unchanged; keyboard tab order matches the visual order                             |
| Enquiry forms `/intake`                       | Fixed enrollment offers and public links, reached from Settings                                  | Create/pause offers; fixed amount/currency/origins; round-robin assignment; payment setup                                                            |
| Form payment setup `/intake/:id`              | Bound active/test gateway or local sandbox                                                       | No client price editing; server checks tenant and provider state                                                                                     |
| Hosted enquiry `/enquire/:publicKey`          | Workspace/course, contact fields, separate consent choices                                       | Functional enquiry consent required; marketing/tracking/ad sharing opt-in; honeypot; server acceptance receipt                                       |
| Confirmation/checkout `/checkout#token`       | Accepted enquiry, server price, mode and order status                                            | Explicit sandbox simulation or safe provider redirect; withdrawal control; expired token errors; refunded status cannot create a second order        |
| Payment return `/payment-return`              | Provider confirmation pending explanation                                                        | Returning to site is never presented as proof of capture                                                                                             |
| Reports `/flow`                               | Cohort milestones, observed exits, stalls/loss reasons and source/campaign/ad attribution        | First/last/linear models; evidence/currency separated; coverage gaps and null ROAS explicit; finance-only Payment records link                       |
| Payment records `/revenue`                    | Gross/refund/net summary and append-only ledger, reached from Reports                            | Manual receipt/refund entry and evidence labels retained; gateway reconciliation separate                                                            |
| Provider catalog `/connections`               | Supported providers and configuration summaries, reached from Settings                           | Encrypted drafts; unused-draft removal; activation in Integrations                                                                                   |
| Integrations `/operations`                    | Configuration health, commands, sync history and webhooks, reached from Settings                 | Configure/check/activate/pause; payload preview and approval; test/live distinction; failed-webhook replay only                                      |
| Team & account `/account-settings`            | Verified-email state, usage/plan, sessions, invitations, member roles, billing, privacy          | Owner-only billing controls; last-owner/seat protection; revoke access; download export; password-confirmed erasure; local-only account-mail preview |
| Workspace preferences `/settings`             | Workspace name/timezone/currency, response target, retention, MFA, websites and audit            | Bounded settings; TOTP and recovery codes; no tenant impersonation                                                                                   |

## Critical status language

- **Observed form activity** is consented telemetry; **accepted enquiry** means a server transaction committed. Historical/manual leads may lack older milestone evidence.
- **No contact recorded**, **no connection recorded** and **no confirmed payment** are evidence gaps, not proven reasons a person left. Age thresholds are visible.
- **Manual record**, **sandbox**, **provider test**, **provider verified** remain visibly distinct. Revenue numbers never collapse currencies or present simulated cash as live ROAS.
- **Configuration validated** is weaker than **credentials verified**; either is weaker than vendor-certified live operation. A green check cannot imply real lead sync or message delivery.
- **Pending approval**, **queued**, **running**, **accepted**, **failed**, **unknown** are separate. Unknown instructs provider reconciliation, not another Send button.
- **Enrollment review required** after a refund remains until the business decides its course/enrollment state. Financial evidence stays immutable.

## Browser acceptance checklist

Verify demo entry, tenant switch, enquiry submission with/without optional consent, assignment, contact outcome, future demo scheduling, attendance after start, sandbox capture, enrollment evidence, cumulative refund and report separation. Verify empty integration/account screens, settings save, missing/expired links, keyboard dialog focus and errors. Repeat on a physical/narrow mobile viewport before a public release; desktop browser QA alone is not a mobile accessibility certification.
