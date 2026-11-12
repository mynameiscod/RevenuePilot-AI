# Implementation roadmap

This repository starts the independent project. Milestone 1 is implemented below; remaining phases are not represented as finished features. No deployment, existing-system changes or provider activation is included in this commit.

| Milestone                              | Scope                                                                                                                                        | Exit criteria                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1 — Working foundation                 | Tenant/session/roles; leads/history; manual financial evidence; draft catalog; consented event intake; dashboard; Docker/CI                  | Isolation and integrity tests pass; local browser workflows verified; limitations documented                     |
| 2 — Production identity and operations | Verified email, recovery, privileged MFA, invitations, member lifecycle, secure infrastructure, backups, observability, retention            | Two-tenant abuse tests, recovery tests, restore exercise, full Docker smoke and independent security review      |
| 3 — Authoritative acquisition          | Consent ledger, UTM/click IDs, form attempts and accepted lead receipts, identity links, campaign dimensions, first advertising/CRM adapters | Replay-safe accepted leads; traceable click/visit/form/lead evidence; completeness and freshness surfaced        |
| 4 — Revenue and journey attribution    | Payment webhooks/reconciliation, demo attendance, loss reasons, immutable milestones, first/last/linear windows                              | Capture/refund/dispute reconciliation, currency conservation, versioned cohort results, late-event recalculation |
| 5 — Calling, messaging and AI          | Provider-independent command interfaces, suppression/consent, quiet hours, approval policy, AI evidence summaries and budgets                | Sandbox certification, injection tests, no duplicate outbound effects, traceable evidence/costs                  |
| 6 — Commercial SaaS                    | Subscriptions, metering/quotas, entitlements, exports/deletion, region choices, support tooling, onboarding                                  | Tenant lifecycle billing tests, quota enforcement, operational SLOs and controlled pilot                         |

Recommended pilot sequence: CodeBegun's synthetic workspace → controlled test tenant → approved read-only integration shadow mode → reconciled pilot → a second unrelated tenant. No CodeBegun-specific integration is active now. API permissions and provider availability must be verified when each adapter is built; provider catalog entries do not guarantee access.

Prioritize one advertising provider and one authoritative lead source before adding all vendors. Add gateway reconciliation before revenue optimization and outbound automation. Independent tenant provisioning, provider swaps and commercial entitlements should be exercised before public SaaS launch.

## Decisions before the next external integration

- Source of accepted leads, sales stage ownership, demo attendance and enrollment truth.
- First ad account/provider and permitted read scopes; provider sandbox accounts and callback domain.
- Payment evidence source and treatment of discounts, installments, disputes and refunds.
- Pilot users/roles, data retention, data region and consent policy.
- Hosting budget, operational ownership, response targets and commercial packaging.

These choices do not block local development. Credentials, real customer data and deployment require their own authorized setup. No new repository needs to be created; this is the project's source repository.
