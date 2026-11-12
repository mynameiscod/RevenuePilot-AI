# Security model and release gates

This is a local evaluation foundation, not a declaration of production readiness or compliance certification. Never place real secrets in issues, screenshots, test fixtures or commits. For sensitive findings, contact the repository owner through an existing private channel.

## Implemented controls

| Boundary            | Control                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User authentication | Argon2id passwords, opaque random session tokens stored as hashes, eight-hour expiry, server logout                                                                                  |
| Browser writes      | Exact production Origin; development-only localhost/127.0.0.1 aliases at the configured scheme/port, session-bound CSRF token, HttpOnly/SameSite cookie, Secure cookie in production |
| Tenant access       | Server membership lookup on every request; immutable tenant IDs; tenant and object filters                                                                                           |
| Roles               | Owner/admin management; counselor assigned leads; finance receipts; analyst aggregate data; viewer masked leads                                                                      |
| Sensitive fields    | AES-256-GCM with random nonce and tenant/user authenticated context; secrets hidden from normal model queries and response DTOs                                                      |
| Identity lookup     | Tenant-specific HMAC; no global cross-tenant lead identity matching                                                                                                                  |
| MFA                 | Password recheck for setup, encrypted TOTP secret, confirmation, time-step replay check, other-session invalidation                                                                  |
| Money               | Positive integer strings, BigInt totals, transaction-safe refund ceiling, unique references                                                                                          |
| Replay              | Durable request idempotency, unique collector event keys, outbox/event transaction deduplication                                                                                     |
| Input handling      | Strict Zod request schemas, escaped search regex, bounded payloads, rate buckets                                                                                                     |
| Browser app         | React text rendering, no dangerous HTML renderer, self-hosted fonts, Nginx CSP and frame restriction                                                                                 |
| Diagnostics         | Request IDs; generic server error responses; no credential/request-body logging                                                                                                      |

MFA is optional in this milestone. The database key must be a random 32-byte hex value; startup fails if missing. No production demo mode is permitted. Public website keys identify a source, not a trusted person; an attacker can forge browser-like submissions outside a browser. Origin checks reduce accidental abuse but do not make collector evidence authoritative.

No untrusted provider code, transcripts, user prompts or remote URLs are executed. Connector drafts cannot trigger HTTP requests. This eliminates outbound provider effects in v0.1, but does not substitute for the controls needed when adapters are added.

## Required before customer production

1. Add verified-email onboarding, password reset, MFA recovery, mandatory privileged-user MFA, session inventory/revocation and reauthentication for sensitive changes. Do not enable MFA on an important account before a recovery process exists.
2. Add invitations, owner transfer, last-owner protection, tenant suspension and tested member lifecycle APIs. Current membership list is read-only; roles are enforced but administration is not complete.
3. Deploy behind TLS with explicit trusted-proxy settings, correct client-IP rate limiting, private authenticated MongoDB/Redis, workload credentials and a secret manager. Current API ignores forwarded client IPs rather than trusting arbitrary headers; behind Nginx, IP limits are therefore shared at the proxy address until configured deliberately.
4. Introduce key versions and rotation/migration tooling, encrypted backup retention, restore drills, least-privilege database users and operator access controls. Encryption of contacts is not full-field PII encryption: names, notes, references and event details still need protected storage and appropriate retention.
5. Implement retention, deletion/export, consent ledger, suppression enforcement and region controls. Obtain market-specific privacy/calling review before collecting real tracking data or making outbound contact. No automatic tracking starts before consent in the SDK.
6. Add signature/raw-body webhook verification, timestamp replay protection, scoped OAuth state/PKCE, destination allowlists/SSRF protection, secret refresh locks and provider-specific certification before activating connectors.
7. Add per-tenant quotas, subscription entitlements, background-job fairness, queue alerts/dead-letter recovery, reporting rollups, load testing and independent security testing.
8. Verify container builds and full Docker lifecycle; scan images, pin digests, enforce branch protections and test recoverability. Production dependencies were audited locally; this is not a full supply-chain or penetration assessment.

Legal retention periods, data residency, SLA and provider costs are product decisions still to be agreed. None are implied by the defaults in this code.
