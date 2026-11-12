# Security model

RevenuePilot 0.2 is a pilot implementation with explicit live-activation gates, not a production or compliance certification. Never put real credentials, contact records or tokenized URLs in issues, screenshots or commits. Report sensitive findings privately to the repository owner.

| Boundary                | Implemented control                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication          | Argon2id passwords; random opaque session tokens stored as hashes; eight-hour expiry; server logout/revocation; current membership checked on every tenant request                              |
| Browser writes          | Exact Origin, local-only hostname aliases on same port, session CSRF token, HttpOnly/SameSite cookie; Secure __Host cookie in production                                                        |
| Accounts                | Hashed single-use verification/reset/invite tokens, generic password recovery, expiry checks, session revocation, no reset-based MFA bypass                                                     |
| MFA                     | Password-confirmed setup, encrypted TOTP secret, time-step replay guard, ten hashed one-time recovery codes, atomic recovery consumption                                                        |
| Privileged live actions | Verified email + MFA + login within 15 minutes + installation live flag + matching checked configuration version + explicit confirmation                                                        |
| Tenant authorization    | Immutable tenant IDs; tenant/object/assignee filters; owner-only billing and privileged membership changes; transaction-safe seats and last owner                                               |
| Data protection         | AES-256-GCM random nonces with tenant/user associated context; tenant-keyed HMAC contact indexes; hidden secret columns; safe DTOs                                                              |
| Acquisition             | Origin-bound public keys, rate limits, strict input, honeypot, server-side tenant/price/assignment, accepted-attempt deduplication                                                              |
| Webhooks                | Raw-byte Stripe/Razorpay/Meta HMAC, timestamped generic/Outpero HMAC, SES SNS signed certificate validation restricted to configured regional AWS host/topic; unique connection/event body hash |
| Outbound execution      | Host allowlist, HTTPS, no redirects, bounded response/time, capability dispatch, approved payload/config version, consent/suppression, quiet hours, monthly/daily caps, no unknown-result retry |
| AI                      | PII pattern redaction, bounded transcript/output, structured schema validation, untrusted-input instruction, no tools or automatic lead/payment/consent edits                                   |
| Money                   | Server prices, safe integer minor units, transaction-safe capture/refund, exact provider evidence matching, no redirect trust, separate test/live and SaaS/tenant billing                       |
| Privacy                 | Purpose-specific ledger, self-service withdrawal on confirmation link, WhatsApp STOP/SES suppression, operator evidence, retention, password-confirmed local erasure and scoped export          |
| App and diagnostics     | React escaped text, local fonts, CSP/frame restrictions, request IDs, generic errors, no request-body/credential logging                                                                        |

Roles:

| Capability                          | Owner | Admin | Counselor | Finance | Analyst | Viewer |
| ----------------------------------- | ----- | ----- | --------- | ------- | ------- | ------ |
| Read leads                          | All   | All   | Assigned  | Masked  | Masked  | Masked |
| Edit leads / demos                  | Yes   | Yes   | Assigned  | No      | No      | No     |
| Read contact PII / call text        | Yes   | Yes   | Assigned  | No      | No      | No     |
| Revenue read                        | Yes   | Yes   | No        | Yes     | Yes     | No     |
| Revenue write                       | Yes   | Yes   | No        | Yes     | No      | No     |
| Connectors/settings/privacy         | Yes   | Yes   | No        | No      | No      | No     |
| Members/audit                       | Yes   | Yes   | No        | No      | No      | No     |
| SaaS billing / manage owners-admins | Yes   | No    | No        | No      | No      | No     |

## Important boundaries

Public origin checks are not authentication against non-browser clients. Browser source tags and form telemetry remain untrusted observations. Signed provider events prove the configured sender, not a user's intent; payment evidence is read back from the provider before recording cash.

No provider message/call is sent automatically upon form submission. A worker rechecks consent just before execution. A request already in flight when consent is withdrawn or a connection is paused cannot be recalled. No automatic provider failover is allowed. Provider acceptance does not prove delivery or a completed call. Suppressed contacts remain blocked even if a later individual consent purpose is granted; removal requires separate reviewed operational handling.

Local account-mail preview exists only outside production and is scoped to the signed-in requester. Production mail uses installation-owned SES credentials, while tenant marketing SES keys remain separately scoped. Demo mode forbids live-provider execution. Production also forbids demo mode and non-HTTPS app origins.

Names, notes, manual references and event text can contain PII even though contact/call/secret fields are encrypted. Encryption at the database/storage/backup layer and restricted operator access are required. Erasure pseudonymizes local data while preserving financial/audit evidence; backups and external copies require separate procedures. Consent decisions may be superseded in the ledger; application audit is append-only through the API, not tamper-proof against a database administrator.

AI redaction is a best-effort identifier filter, not a proof of anonymization. A reviewer must select appropriate content and provider data terms. Imported CRM contacts do not inherit invented marketing consent. Account-only health checks do not certify every scope or webhook contract.

## Remaining infrastructure/release requirements

See [OPERATIONS.md](docs/OPERATIONS.md). Before customer production: private authenticated MongoDB/Redis with TLS, secret management and key version/rotation migration, encrypted recoverable backups, deliberate trusted-proxy/client-IP configuration, real provider certification, infrastructure restore drill, measured load/per-tenant fairness, image scanning/digest pinning, branch protections and independent security review. API currently ignores forwarded IPs, so proxy-based IP limits may be shared; configure trust only for the actual controlled proxy.

No OAuth authorization UI/state/PKCE flow is claimed; administrators supply scoped provider credentials. No SSO, regional residency guarantees, managed secrets/KMS rotation, legal retention certification or tested production SLA is claimed. The included local Compose stack is not safe for public exposure without the production controls above.
