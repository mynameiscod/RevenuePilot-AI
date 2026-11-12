# Acceptance and verification

## Automated local checks

The suite uses a disposable **real MongoDB replica set**, not a mocked collection layer. The database is created solely for the tests. Shared startup options use MongoDB 7.0.48 and pass `--nounixsocket` only on Unix platforms; Windows must not receive that unsupported flag. No sandbox protection is disabled.

| Area            | Acceptance condition                                                                                                           | Coverage                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Tenant boundary | Other tenant paths, objects and forged tenant headers cannot disclose/mutate records                                           | API test                             |
| RBAC            | Analyst/viewer contact masking; counselor assignee restriction; revoked membership loses access                                | API/domain tests                     |
| Session/CSRF    | Missing CSRF or wrong Origin fails; logout invalidates cookie session                                                          | API tests                            |
| Atomic writes   | Lead mutation, audit and outbox commit together                                                                                | API test                             |
| Idempotency     | Replay produces one business record; changed body with same key conflicts                                                      | API tests                            |
| Stage conflicts | Stale version fails; stage update does not imply contact                                                                       | API test                             |
| Timeline replay | Reprocessing same outbox creates one event                                                                                     | Real database worker projection test |
| Money           | Invalid decimal rejected; captures deduped; wrong-tenant/currency refund rejected; concurrent refunds cannot exceed capture    | API/domain tests                     |
| Secret boundary | Wrong-tenant decrypt fails; randomized cipher; no credentials in connection DTO                                                | Domain/API tests                     |
| MFA             | Known algorithm vector; enrollment/login/replay handling                                                                       | Domain/API tests                     |
| Collector       | Consented allowed origin accepted; duplicate acknowledged; forged financial/extra-field events rejected                        | API/schema tests                     |
| SDK             | No sending before consent; query/fragment excluded; withdrawal rotates identity; rate-limit retry preserves IDs; queue bounded | SDK tests                            |
| Adapter safety  | All eleven providers configuration-only; unsupported execution fails explicitly                                                | Domain/API tests                     |

Run `npm run typecheck`, `npm test`, `npm run build` and `npm audit --omit=dev`. The original foundation passed 27 tests. The Windows startup fix adds an end-to-end process smoke test, bringing the suite to 28: it launches the actual demo command, waits for MongoDB/API/Vite, signs into the synthetic workspace and checks the 48 seeded leads. CI runs on Linux with Node 24.22.1 and Windows with Node 24.11.0; consult the current commit's CI result for execution status. Production dependency audit reported zero known vulnerabilities at the time of implementation; future advisories can change that result.

## Browser verification performed

- Entered the local synthetic demo; inspected sign-in and dashboard layouts.
- Created `QA Sample Lead` with an `example.test` address; opened its stored detail view.
- Confirmed the outbox-generated enquiry event, changed stage to Qualified and observed its note in the timeline.
- Confirmed stage change left “No attempt recorded” unchanged.
- Switched to empty Northstar Studio and observed zero leads/cash in USD; switched back to CodeBegun and observed its distinct data.
- Inspected the provider screen and verified clear draft/inactive labels and six categories.
- Saved `docs/screenshots/dashboard.jpg` from the running application after these actions.

## Explicitly not verified here

- Full Docker build/start/stop, Redis delivery/failover and image scanning: Docker/Redis server were unavailable in the implementation runtime. The worker projection itself was tested against MongoDB; the demo uses a direct projection loop.
- Live provider OAuth, webhooks, calls, messages, AI inference or payments: no adapters are active.
- Production deployment, sustained load, backup restore, full mobile-device matrix, screen-reader audit or independent penetration testing.

CI performs source checks and Compose syntax validation; it does not deploy. Full stack smoke tests must be added/run before claiming container operational readiness.
