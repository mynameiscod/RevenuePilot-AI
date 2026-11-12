# API contract — implemented v0.1

Base path: `/api/v1`. Request/response content is JSON. Canonical validated request schemas and response interfaces live in `packages/core/src/contracts.ts`. This document describes implemented endpoints, not future vendor APIs.

## Authentication and errors

Authentication uses an opaque HttpOnly session cookie. Production requires HTTPS and a Secure `__Host-` cookie. The session response contains a `csrfToken`; send it as `X-CSRF-Token` on authenticated writes. Every write must also have the exact configured `Origin`. API tokens/service accounts are not implemented yet.

`GET /auth/session` returns `{ user: { id, name, email, mfaEnabled }, tenants: TenantView[], csrfToken }`. UI local storage contains only a selected workspace ID, never the auth token. Membership and permissions are checked independently of that selection.

Errors use `application/problem+json`: `{ type, status, code, title, requestId, errors?: [{path,message}] }`. Expected statuses: `401` missing/invalid session; `403` origin/CSRF/role/membership denial; `404` scoped object absent; `409` idempotency/version/reference conflict; `422` validation or unsupported adapter; `429` rate limit with `Retry-After`; `500` generic failure without internal details. Unmatched routes currently return a simpler 404 body.

## Endpoints

Below, `T` means `/tenants/:tenantId`. Tenant paths require an active membership. ID substitution never broadens access.

| Method and path               | Permission / request                                       | Result                                                  |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| GET `/public/config`          | Public                                                     | Demo and registration flags                             |
| POST `/auth/register`         | name, email, password (12–128 chars), workspaceName        | 201 session; creates owner and tenant transactionally   |
| POST `/auth/login`            | email, password, optional six-digit code                   | Session or `MFA_REQUIRED` / `MFA_INVALID`               |
| POST `/auth/demo`             | Nonproduction explicit demo mode only                      | Synthetic demo session                                  |
| GET `/auth/session`           | Session                                                    | Current user, memberships and CSRF token                |
| POST `/auth/logout`           | Session + CSRF                                             | 204; invalidates session server-side                    |
| POST `/auth/mfa/setup`        | Session + CSRF + current password                          | Secret and authenticator URI; handle as sensitive       |
| POST `/auth/mfa/confirm`      | Six-digit code                                             | `{enabled:true}`; revokes other sessions                |
| POST `/tenants`               | `{name}`                                                   | 201 updated session with new owner workspace            |
| GET `T/overview?days=30`      | leads.read; days 7,30,90                                   | `Overview`; financial fields filtered by role           |
| GET `T/leads`                 | leads.read; q, stage, page, limit                          | `{items,total,page,limit}`; counselor own records       |
| POST `T/leads`                | leads.write + Idempotency-Key; `LeadInput`                 | 201 `{id}`                                              |
| GET `T/leads/:id`             | leads.read + object scope                                  | `{lead,events}`; latest 100 timeline events             |
| PATCH `T/leads/:id/stage`     | leads.write; `{stage,note,version}`                        | `{updated:true}`; optimistic version check              |
| POST `T/leads/:id/contact`    | leads.write + Idempotency-Key; `{note}`                    | `{updated:true}`; records attempt, not a connected call |
| GET `T/revenue`               | revenue.read; page, limit, optional leadId/kind            | Receipt page with role-safe lead name                   |
| POST `T/revenue`              | revenue.write + Idempotency-Key; `ReceiptInput`            | 201 receipt record                                      |
| GET `T/connections`           | Membership                                                 | Provider catalog and safe configuration DTOs            |
| POST `T/connections`          | connections.write; provider, label, accountId, credentials | 201 `{id,status:'draft',activated:false}`               |
| DELETE `T/connections/:id`    | connections.write                                          | 204; scoped draft deletion and audit                    |
| POST `T/connections/:id/sync` | connections.write                                          | 422 `ADAPTER_NOT_IMPLEMENTED`                           |
| GET / POST `T/sites`          | settings.write; POST name and origins                      | Sites / 201 site with public key                        |
| PUT `T/settings`              | settings.write; full `SettingsInput`                       | Updated session                                         |
| GET `T/members`               | members.read                                               | Read-only member list                                   |
| GET `T/audit`                 | audit.read                                                 | Latest 100 actions and pending outbox count             |
| POST `/collect`               | Site public key + allowlisted Origin; no cookie            | Accepted/duplicate/rejected event IDs                   |

Liveness and readiness are outside the versioned path at `/health/live` and `/health/ready`. API readiness checks MongoDB; it does **not** certify Redis, worker health or vendor availability.

## Example requests

Create a lead with `Origin`, session cookie, `X-CSRF-Token` and a fresh `Idempotency-Key`:

```json
{
  "name": "Example Learner",
  "email": "learner@example.test",
  "course": "Java Full Stack",
  "channel": "Referral",
  "campaign": "Partner enquiry",
  "note": "Requested a course discussion."
}
```

At least one of email/phone is required. Allowed channels: Meta Ads, Google Ads, YouTube Ads, Organic, Referral, Direct, Other. Names/course max 100, campaign 120, notes 1000. Unknown fields are rejected. Contact DTOs are masked for roles without `pii.read`; restricted search cannot probe names.

Change stage using the version from the latest lead response:

```json
{ "stage": "qualified", "note": "Course fit confirmed.", "version": 1 }
```

Stages: `new`, `contacting`, `qualified`, `demo`, `enrolled`, `lost`. Moving between distinct stages is allowed with an evidence note; this release has no configurable workflow rules. No-op updates fail. A `409 VERSION_CONFLICT` requires refresh and a new user decision.

Record a manual capture:

```json
{
  "leadId": "replace-with-workspace-lead-id",
  "kind": "capture",
  "amountMinor": "3500000",
  "currency": "INR",
  "reference": "MANUAL-EXAMPLE-001",
  "note": "Manually entered receipt evidence."
}
```

For a refund use `kind: "refund"`, a distinct reference and `originalReceiptId`. Amount is positive, same currency and no greater than the original's remaining balance. A `3500000` INR amount is ₹35,000. Supported maximum is `9000000000000000` minor units per record.

Idempotency binds tenant, user, route, key and normalized request hash. Replaying the same key/body returns the original result; using that key with a different body returns 409. Keep the same key after an unknown network result. Generate a new one for a genuinely new operation. Keys are retained durably in this release; a retention policy must preserve domain uniqueness.

List endpoints default to page 1, limit 25 (max100), sorted newest creation time then ID. Page is limited to 10000. Filter query types are validated; arbitrary MongoDB operators are not accepted. Cursor pagination is a roadmap item.
