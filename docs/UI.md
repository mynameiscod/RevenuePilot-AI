# UI specification — foundation

## Visual system

Light workspace with white surfaces, restrained violet primary actions, teal/amber status accents and slate text. DM Sans and Manrope are locally packaged; there is no runtime font request to a third party. Bootstrap 5 form/table/grid primitives are combined with scoped CSS and Lucide icons. The RevenuePilot identity is independent of an existing application.

Desktop shell: fixed workspace sidebar, tenant selector, main navigation, utility navigation and current-user role. The top bar provides tenant/page context, lead search, refresh and an uncontacted-lead shortcut. Smaller screens collapse navigation into a dismissible drawer, stack metric cards and allow horizontal table overflow. CSS breakpoints exist; full device coverage remains a release gate.

## Screens and behavior

| Screen                 | Content                                                                                                                | Functional actions / evidence                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Sign in / registration | Product introduction, email/password, optional MFA code, sample entry in demo mode                                     | Create independent owner workspace, sign in, enter sample workspace              |
| Overview               | Acquisition-window counts, currency cash summary, daily UTC trend, current stages, recorded sources, next-action rules | 7/30/90-day selector, metric toggle, lead/source drilldowns, refresh             |
| Lead journeys          | Six current-stage cards, consented website event counts, response coverage                                             | Open stage-filtered leads and tracking settings; no inferred funnel conversion   |
| Leads                  | Search/filter/page controls, course/source/campaign, stage and received date                                           | Create lead; scoped detail view; counselor own records                           |
| Lead detail            | Contact/course/source panel, current stage, last contact, chronological evidence                                       | Optimistic stage change, contact note, refresh pending timeline                  |
| Revenue                | Gross/refund/net totals in workspace currency, manual evidence notice, paged ledger                                    | Add capture/refund; select original capture; distinct immutable reference        |
| Connections            | Six categories, provider cards, saved draft configurations                                                             | Save encrypted draft, remove draft; all statuses visibly inactive                |
| Settings               | Workspace name/timezone/currency/response target, site registration, MFA, read-only team and audit                     | Save preferences, create workspace, register exact origins, enroll authenticator |

## Interaction rules

- A switched tenant remounts the workspace view and fetches scoped data. Browser selection never supplies authorization. Initial memberships are alphabetically ordered, putting the seeded CodeBegun workspace first.
- Active operations disable duplicate submission; idempotent operations retain their key across uncertain network failures. Financial operations explicitly say manual evidence and never imply money was charged/refunded through a gateway.
- Empty, loading and error states are distinct. Failed revenue summary fetches show unavailable values rather than zero. Denied data is masked or replaced with a permission explanation.
- Demo banners label all data synthetic. The help dialog describes actual release boundaries. There is no fake “connected”, generated AI analysis or ad spend.
- Native dialog semantics, linked form labels, keyboard focus, skip navigation, accessible button names and textual chart descriptions are included. Color is supplemented by stage text. End-to-end screen-reader and contrast auditing remain pre-release work.
- Lead history is eventually consistent; pending state explains the worker delay and supplies refresh. Realtime subscriptions are not implemented.
- Per-event notes are plain text. No user-controlled HTML rendering is used.

## Next UI work

Build cohort-based funnel conversion with drillable drop-offs, timestamp provenance and confidence/coverage labels; abandoned-form recovery only after consent and authoritative acceptance signals exist. Add campaign/ad dimensions, spend/ROAS with explicit windows, verified payment reconciliation, provider connection wizard, consent controls, invitations and self-serve billing. Keep CodeBegun-specific courses/configuration tenant-owned rather than hard-coded product assumptions.
