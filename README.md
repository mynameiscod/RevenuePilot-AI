# RevenuePilot AI

An independent multi-tenant revenue workspace for CodeBegun first, with reusable provider connectors for other businesses. React, TypeScript, Vite, Bootstrap 5, Node.js, Express, MongoDB replica sets, Redis/BullMQ and Docker.

**Release 0.2: connected local/test journey implemented.** Enquiry → assigned follow-up → conversation → demo → verified payment → enrollment → attribution → approved conversion feedback. Provider code is implemented; no real provider account or production deployment is activated by this repository. It has no dependency on the LMS, shared LMS database, or LMS source code.

## Start on Windows, macOS or Linux

Use Node.js 24 and npm. From the repository directory:

```sh
npm ci
npm run setup:env
npm run dev:demo
```

Open **http://localhost:3001** (or **http://127.0.0.1:3001**) and click **Explore sample workspace**. No login credentials are needed for this option. It signs into a fictional CodeBegun workspace, with Northstar Studio as a separate tenant. To use your own login, choose **Create workspace** and set your own email/password. There is no shared production password.

The demo downloads MongoDB 7.0.48 on first use, starts a temporary replica set and drains durable work directly without Redis. Stopping it discards its data and encryption key. Use synthetic data only. On Windows the launcher omits Unix-only MongoDB flags. The deprecated `node-abort-controller` warning is unrelated to MongoDB startup; do not change dependencies just to hide it.

If you get **“This request origin is not allowed”**, use the port in `.env`'s `WEB_ORIGIN`, stop the old process and restart. Development accepts localhost/127.0.0.1 aliases on that same scheme/port; another port is deliberately different. Production accepts its exact HTTPS origin only. See [OPERATIONS.md](docs/OPERATIONS.md) for diagnostics.

## Try the complete journey

1. Open **Intake forms → Open form**. Enter an `example.test` contact, select optional measurement if desired, then send the enquiry. Leave the checkout tab open.
2. Open **Work queue** in the workspace. The assigned first-response task links to the lead's workflow.
3. Record a contact outcome; qualify the lead from its detail page with a note. Schedule a future demo. After its start time, record attended/no-show and the next step.
4. On the enquiry confirmation, choose **Simulate successful payment**. No money is charged. Refresh the workflow: a sandbox receipt and enrollment appear once.
5. Open **Journey & attribution** for milestone coverage, inferred stalled leads, loss reasons, first/last/linear allocation and evidence-separated cash. Historical seed records do not fabricate milestones they never recorded.
6. Simulate a refund in the workflow. Cash reverses and enrollment becomes **review required**; a counselor/finance owner must decide the enrollment outcome.
7. **Connections → Integration controls** supports configuration, health check, activation, paginated imports, reviewed commands and webhook history. Test calls/messages/AI are local simulations. Advertising tests use provider test/validation endpoints only after approval; payment tests use provider test keys.
8. **Team & account** manages invitations, roles, access revocation, sessions, usage, email verification, privacy export/erasure and configured SaaS billing. **Settings → Security** enables TOTP and one-time recovery codes.

## Persistent local stack

```sh
npm run setup:env
docker compose up --build -d
```

Open http://localhost:3001 and create an account. MongoDB and Redis use dedicated RevenuePilot volumes and loopback ports. `docker compose down` preserves data. Do not delete volumes unless you intentionally want to destroy this local database. Alternatively run only MongoDB/Redis through Compose, then `npm run dev` on the host using `.env`.

The supplied Compose file is **local development**, not a production deployment template: databases are unauthenticated inside its isolated local network. Production requires the controls and release gates in [OPERATIONS.md](docs/OPERATIONS.md). Nothing is deployed by CI.

## What is implemented

| Area              | Behavior                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant security   | Current membership on every request; owner/admin/analyst/counselor/finance/viewer; counselor assignment scope; role-safe PII; CSRF and exact origins                                                      |
| Accounts          | Registration, password recovery, verification, invitation acceptance, last-owner protection, session revocation, TOTP recovery codes                                                                      |
| Acquisition       | Origin-scoped forms; separate enquiry/marketing/tracking/ad consent; accepted lead receipts; contact/course deduplication; round-robin assignment; follow-up queue                                        |
| Sales             | Contact outcomes, explicit loss notes, conflict-checked demos, attendance and follow-up tasks, provider call history                                                                                      |
| Payments          | Stripe Checkout and Razorpay Payment Links; signature-checked durable inbox; provider reconciliation; exact amount/currency/mode matching; cumulative refunds; one order per lead/offer                   |
| Measurement       | Consented form observations; recorded milestones; age-based stalls; separate known loss reasons; 30-day first/last/linear touch allocation; exact campaign/ad ID matching; live ROAS using observed spend |
| Connectors        | Meta, Google Ads/Data Manager, HubSpot, signed generic CRM, Outpero, Stripe, Razorpay, OpenAI, Anthropic, WhatsApp Cloud API, SES                                                                         |
| Action control    | Consent/configuration recheck; explicit approval; daily/monthly limits; quiet hours; paused connections; unknown-result quarantine; no blind outbound retries                                             |
| Commercialization | Separate Stripe SaaS subscriptions, server-priced entitlements, seat/form/lead/action limits, tenant usage                                                                                                |
| Operations        | Transactional outbox, Redis worker, durable webhook replay, retention, Linux/Windows tests, built Docker stack smoke and isolated restore CI                                                              |

## Activation boundary

Live use still needs your provider accounts, scoped credentials, supported API versions, approved WhatsApp templates, configured calling agent/webhook, verified sending domain and SaaS price IDs. Enable `ALLOW_LIVE_PROVIDERS=true` only in the intended installation. A verified email, MFA and recent login are required to activate live connections and approve live commands. Demo mode rejects this flag.

No OAuth self-service authorization UI, third-party CRM writeback, calendar invites, arbitrary automation builder, cross-device identity graph, multi-currency FX or causal uplift claims are included. Imports are explicit, paginated operations. Conversion candidates from recent evidence are prepared automatically but require approval. Provider acceptance is not delivery, completed calling, payment settlement into a bank or confirmed ad attribution.

## Engineering references

- [Architecture and data boundaries](docs/ARCHITECTURE.md)
- [Collection schemas and indexes](docs/SCHEMAS.md)
- [API contracts](docs/API.md) and [generated request JSON schemas](docs/REQUEST_SCHEMAS.json)
- [Connector contracts and setup](docs/CONNECTORS.md)
- [Security model](SECURITY.md)
- [UI specification](docs/UI.md)
- [Implementation status and release gates](docs/ROADMAP.md)
- [Acceptance tests](docs/ACCEPTANCE.md)
- [Operations and recovery](docs/OPERATIONS.md)

```sh
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

CI runs the same checks on Linux/Node 24.22.1 and Windows/Node 24.11.0, plus an isolated Docker stack test. See the [current Actions results](https://github.com/mynameiscod/RevenuePilot-AI/actions). Passing protocol fixtures does not certify a real vendor account. This is a pilot implementation; measured load, restore drills on the chosen infrastructure and provider acceptance remain production release gates.
