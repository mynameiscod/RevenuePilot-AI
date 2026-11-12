# Operations and release runbook

## Local use and troubleshooting

The launcher waits for its API child to connect to MongoDB and listen before starting Vite. If an older checkout logs `ECONNREFUSED 127.0.0.1:4000` immediately before `RevenuePilot API ready on 4000`, refresh once after that ready message, then pull the latest code and restart to remove the startup race. An error that continues after readiness is a different failure: inspect the API process output. A failed API startup or a 60-second readiness timeout stops the launcher rather than serving a frontend without its backend.

`npm run dev:demo` is the complete ephemeral path: temporary MongoDB replica set, Express API, Vite and direct background projections. It requires no MongoDB service or Redis installation. The Windows MongoDB launcher omits `--nounixsocket`; this fixes the earlier exit-code-2 startup caused by Unix-only arguments. If startup still fails, collect MongoDB's own stderr with `MONGOMS_DEBUG=1` in your shell and inspect that concrete error; an exit code alone does not identify a missing runtime or download problem.

PowerShell:

```powershell
npm ci
npm run setup:env
npm run dev:demo
```

If the origin is denied, confirm `WEB_ORIGIN=http://localhost:3001` in `.env`, close old development processes and restart. localhost/127.0.0.1 are aliases only on the configured local port. Never change CORS to `*` with credentialed sessions. `setup:env` never overwrites an existing `.env`. An explicitly configured different port needs the same origin in the browser and server.

Persistent local Compose owns `revenuepilot` services/volumes. `docker compose up --build -d` starts MongoDB, replica-set initialization, Redis, API, collector, worker and nginx. `docker compose ps` and `docker compose logs --tail=100` diagnose local startup. Do not paste logs containing credentials. `docker compose down` preserves volumes. The CI-only `--volumes` cleanup destroys its disposable test data and must not be copied onto a persistent installation.

## Environments and credentials

| Setting                                               | Purpose / default                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| NODE_ENV                                              | development/test/production; production requires HTTPS and forbids demo                |
| MONGODB_URI                                           | Dedicated RevenuePilot replica set; transactions required                              |
| REDIS_URL                                             | Dedicated queue; production must use authenticated private/TLS endpoint                |
| DATA_ENCRYPTION_KEY                                   | 32 random bytes as 64 hex characters; stable for the database lifetime                 |
| WEB_ORIGIN                                            | Exact app origin, scheme and port; no path/query                                       |
| ALLOW_REGISTRATION                                    | Controls public owner/workspace registration                                           |
| REVENUEPILOT_DEMO                                     | Explicit ephemeral synthetic mode; never production                                    |
| ALLOW_LIVE_PROVIDERS                                  | false by default; true permits explicitly activated/approved live actions              |
| ALLOW_ACCOUNT_EMAIL / ACCOUNT_EMAIL_FROM / AWS_REGION | Installation-owned SES account mail; default off; SDK credential chain                 |
| BILLING_STRIPE_SECRET_KEY / WEBHOOK_SECRET            | Installation-owned SaaS subscription account; distinct from tenant gateway credentials |
| BILLING_PRICE_GROWTH / SCALE                          | Existing recurring Stripe price IDs; no client-defined price or free plan upgrade      |

Tenant provider keys are entered through the protected connector configuration UI, encrypted server-side and returned only as field names. Use least-privilege scoped credentials and supported API versions. Never check them into Git. ChatGPT connected apps are not runtime credentials for this application. Outpero agent setup, Meta permissions, Google scopes, WhatsApp template approval, SES domain verification and Stripe/Razorpay activation must be completed in the respective provider accounts.

## Production release gates — not yet executed

1. Approve a deployment destination/domain and environment ownership. No production infrastructure has been created.
2. Provision isolated authenticated MongoDB replica set and Redis, private networking, TLS termination, encrypted disks/backups, secret manager and least-privilege service identities. Remove database public port publishing. Pin approved image digests and scan actual images.
3. Keep live actions off. Run schema/index review and a restore rehearsal on that infrastructure; retain the encryption key securely with version/rotation planning. A key change without migration makes old ciphertext unreadable.
4. Verify account-email delivery, domain sender configuration, registration policy, owner MFA, time synchronization, application origin/proxy settings and abuse controls.
5. Certify each selected provider with the tenant's test account: credentials/scopes, account identity, pagination, provider signatures, real payload shape, duplicate/reordered events, revocation, throttling and budget limits. Test Outpero's actual intake host and correlation field mapping. No fixture test replaces this step.
6. Run a CodeBegun shadow pilot with recorded consent and a fixed spending/action budget; reconcile gateway captures/refunds against source records. Never use fabricated conversions for real campaigns.
7. Exercise a second independent tenant, measured load/capacity, penetration review and restore failover. Approve production activation separately.

## Health, replay and unknown outcomes

`/health/live` checks process liveness; `/health/ready` verifies MongoDB connectivity only. A healthy API is not proof of a healthy worker/Redis/provider. Monitor process exits, Redis ping/latency, pending outbox age, failed/leased webhook count, queued/unknown commands, payment `unknown` state, rate limits, sync errors, usage caps and provider token expiry. Alert on growing queue age and missing provider data rather than treating missing data as zero.

Integration controls shows bounded command, sync and webhook history. A failed webhook with retained encrypted payload can be explicitly retried. Processing is idempotent and caps at eight attempts before operator replay. Correct credentials/configuration first. An expired in-flight outbound action becomes **unknown**. Investigate the provider dashboard using its request/command reference; do not create a fresh call/message/payment merely because a response was lost. This release does not offer automatic failover or a false “delivered” override.

For an order with a stored checkout reference, **Reconcile status** fetches provider truth. If creation timed out before the reference was stored, inspect the provider by RevenuePilot order metadata/reference. Resolve through an audited engineering reconciliation procedure before retrying; no public API accepts an arbitrary capture claim. Fully/partially refunded enrollments are flagged for human review. Manual stage correction does not remove financial evidence.

Imports run by explicit date range/cursor from Integration controls. Continue until `nextCursor` is absent. Rejected row IDs and partial status require review. API paging is not an automatic historic backfill scheduler. Account mail `unknown` similarly needs inspection; requesting a new verification/reset link invalidates the old token and creates a new message.

## Backup and restore

CI starts the actual Compose stack, runs the built application against MongoDB/Redis, then dumps its quiescent synthetic database and restores it into **a separate `rp_restore_check` namespace**. Durable collection counts must match; volatile rate buckets are excluded. This is a local restore smoke, not a production RPO/RTO guarantee.

For production use the chosen managed MongoDB backup/PITR system or an operator-reviewed replica-set `mongodump --oplog`/consistent snapshot process. Encrypt archives, restrict access and store the data encryption key separately with recoverable access. Do not put URIs/passwords or archives in Git. Restore to a new isolated environment, with live providers/account mail disabled and outgoing network destinations blocked. Validate collection counts, indexes, ledger sums by currency/evidence, refund bounds and tenant boundaries. Rebuild Redis from durable MongoDB pending work; inspect all unknown external commands before resuming.

Document measured restore time, achievable data-loss window, approver, backup ID and reconciliation result. Test regularly on the actual production topology. RPO/RTO targets remain a business decision until measured.

## Retention and erasure

Tenant retention is 30–365 days, default 90, for form attempts, call content, raw webhook payloads, account mail and completed analysis payload/results. Generic collector events currently have their own fixed 90-day TTL. Financial, consent and audit evidence have distinct durability rules. Erasure requires current password, blocks while an outbound action is running, removes local contact identifiers/call content, clears PII-bearing notes and cancels pending work while preserving pseudonymized financial evidence. External copies, stored backups and provider-side retention require separate operational handling.

## Rollback

Use the prior reviewed commit/image with compatible schemas. Stop worker dispatch before changing external action semantics; preserve durable inbox/outbox and unknown states. Do not delete the database to roll back code. This release has no production migration history or automated production rollback claim. No deploy, messaging blast, calling campaign or actual financial transaction runs from CI.
