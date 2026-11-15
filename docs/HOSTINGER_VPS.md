# Hostinger VPS installation

## Selected target and observed state

| Item | Evidence supplied by Siva |
| --- | --- |
| VPS / hostname | `2005345` / `srv2005345.hstgr.cloud` |
| IPv4 / OS | `200.97.164.244` / Ubuntu 24.04 LTS |
| Application origin | `https://revenuepilot.codebegun.com` |
| RAM / disk headroom | Terminal: 15 GiB RAM, 14 GiB available; 183 GiB disk free |
| Existing workload | `codebox-piston`, port 2000; must remain running |
| Existing Docker networks | `172.17.0.0/16`, `172.18.0.0/16` |
| New network | `172.30.84.0/24`, checked for collisions before first start |
| DNS / firewall | User added A `revenuepilot` → `200.97.164.244`; UFW permits 22/tcp, 80/tcp, 443/tcp and 443/udp |
| Proposed directory / Compose project | `/opt/revenuepilot` / `revenuepilot-production` |

These are supplied screenshots, not a live server inspection. DNS propagation, application startup and public HTTPS still require verification. The assistant has not logged into or deployed to this VPS. Hostinger browser sign-in is unavailable in this environment; installation commands run in the user's existing SSH/web-console session. Do not paste passwords, environment files, private keys or API tokens into chat or Git.

## Topology

Caddy HTTPS → web/nginx → API and collector. The worker processes the durable queue. `compose.database.yaml` adds a dedicated authenticated MongoDB replica set and authenticated TLS Redis to `compose.production.yaml`; `compose.hostinger.yaml` adds Caddy and persistent certificate volumes.

MongoDB, Redis, API and collector have no published host ports. Web binds only to `127.0.0.1:8081`. Caddy publishes 80/443 TCP and 443 UDP. The private network, database volumes and project name are independent of Piston and the LMS. Mongo is a single-node replica set: transactions work, but there is no high availability. Redis uses AOF persistence and `noeviction`. No host reboot, package upgrade, firewall reset or unrelated service change is part of installation.

The base production Compose file can alternatively use dedicated external TLS database endpoints, without `compose.database.yaml`. The commands below deliberately use the self-managed database overlay on this VPS; they do not purchase a managed service.

## First installation

Run each stage separately. Stop on an error and inspect it before continuing.

1. Confirm the hostname resolves to the selected IP:

   ```bash
   getent ahostsv4 revenuepilot.codebegun.com
   ```

   Expect `200.97.164.244`. The preflight also rejects unexpected IPv6/other addresses. If DNS is still propagating, wait and repeat; do not disable TLS checks or change unrelated DNS records.

2. Fetch the reviewed branch into a new directory. If `/opt/revenuepilot` already exists, inspect it; do not overwrite it. The review branch is currently `feature/uc01-website-flow` in PR #12. Check its latest successful CI and record the commit with `git rev-parse HEAD` before installation. Use an existing approved GitHub credential for a private repo; do not embed tokens in the clone URL or chat.

   ```bash
   git clone --branch feature/uc01-website-flow --single-branch https://github.com/mynameiscod/RevenuePilot-AI.git /opt/revenuepilot
   cd /opt/revenuepilot
   git rev-parse HEAD
   ```

3. Generate private settings once, on the server:

   ```bash
   python3 scripts/setup-hostinger.py
   ```

   Requires Python 3 and OpenSSL (already normally present on Ubuntu). Creates `.env.hostinger` mode 600 and `.hostinger-secrets` mode 700, with fresh database passwords, replica-set key, internal TLS certificates and the stable application encryption key. It prints no secrets, starts no containers and refuses to overwrite existing files. Keep an encrypted off-server backup of both before storing real data. These paths and temporary secret generation directories are excluded from Git and Docker build contexts.

4. Start the private application and database services:

   ```bash
   python3 scripts/hostingerctl.py start
   ```

   The read-only preflight checks settings, Docker/Compose, unused ports, subnet overlap, DNS and basic capacity before building. Services are started only in the RevenuePilot project. Mongo initialization creates the application account with `readWrite` on its own database, starts the replica set and waits for a primary; application startup waits for healthy Mongo and Redis. This stage does not start the public Caddy edge. `start` is a first-install check, not an arbitrary retry/redeployment command: an already-created network or occupied port requires reviewing the existing project state.

5. Create the first owner privately:

   ```bash
   python3 scripts/hostingerctl.py owner
   ```

   Enter your name, owner email, workspace name (default `CodeBegun`) and a new 12–128 character password. Password entry is hidden and passed to the container over stdin, never command arguments/files. Bootstrap uses the normal account-creation transaction through a short-lived listener on container loopback, holds a database lock and refuses if any account already exists. The public API keeps registration disabled. There is no default/demo production login.

6. Publish and verify HTTPS:

   ```bash
   python3 scripts/hostingerctl.py publish
   python3 scripts/hostingerctl.py status
   ```

   Publication requires an owner and disabled public registration/live-provider flags. Caddy requests the public certificate; the script verifies the real HTTPS certificate, application HTML and private-mode public configuration. It only prints success after verification. If certificate issuance is still pending, inspect DNS/ingress/edge logs locally and run `python3 scripts/hostingerctl.py verify` again. Do not disable certificate verification.

7. Open `https://revenuepilot.codebegun.com`, sign in with the owner credentials you just created, enable MFA and retain recovery codes privately. There is initially no email delivery or live payment/calling/messaging execution. Configure and verify account mail before relying on email verification, password reset or staff invitations. Bootstrap does not fake a verified email.

If startup fails, keep the generated credentials and all data volumes. Run `python3 scripts/hostingerctl.py status` and share only service status or a sanitized error. Do not rerun setup after removing secrets, issue global Docker cleanup, stop Piston, or use `down --volumes` on the VPS.

## Required checks before real leads

A published login is the infrastructure milestone, not completion of the production marketing journey.

- Verify owner login, secure cookies, MFA/recovery, exact origin restrictions and real visitor IP handling behind Caddy/nginx. The private proxy trust range must match only the dedicated network.
- Create CodeBegun forms, assign actual counselors, allow the exact website origins, and exercise lead intake, duplicate retry, tasks, follow-up, demo and reporting with synthetic records.
- Install the separately reviewed website integration only after API readiness. The `cbwebsite` master deployment webhook is independent; this stack does not publish it. Follow [WEBSITE_FLOW.md](WEBSITE_FLOW.md) for the complete release and acceptance checklist.
- Certify each real provider before enabling live calls, messages, conversion feedback or payments. Confirmed payments, enrollment and refunds must be verified with the selected real provider; demo results are not production payment evidence.
- Establish an encrypted off-server database/configuration backup schedule, retention and a measured restore. Preserve the stable encryption key and private database CA alongside recoverable data; replacing the key makes stored credentials/PII unreadable. The automated CI restore is synthetic proof of the mechanism, not a backup of this VPS.
- Monitor disk, RAM, API errors, worker backlog, Redis AOF health, failed webhooks, certificates and unknown provider outcomes. Record the recovery target and an operator for failures. Database certificates expire after 365 days; plan renewal before expiry. Caddy renews its public certificate automatically when DNS and ingress remain valid; internal database certificates require separate renewal.

## Validation and operations

CI verifies the actual production overlay with generated TLS material: private owner bootstrap and repeat refusal, closed registration/demo checkout, authenticated login, lead/contact flow, signed CRM webhook through Redis/BullMQ, collector routing, restricted application database privileges, unauthenticated Redis rejection, database/queue restart persistence and authenticated backup/restore into an isolated namespace. The Caddyfile is separately validated. CI does not issue a certificate for the real domain or connect to the VPS.

`hostingerctl.py verify` is a first-pilot verification and expects registration, email and live providers to remain disabled. After deliberate provider rollout, use the provider acceptance checks and deployment health checks appropriate to that configuration.

Retain known-good application images, source commit, configuration and database backups for upgrades. Review migrations before rolling back; preserve all database and edge volumes. Never replace existing workloads, reset the firewall, delete data or reuse LMS credentials/network to resolve an installation error. Keep workers/webhook handling available when rolling back a website with pending payments.

## Updating an existing private pilot

Keep the existing `.env.hostinger`, `.hostinger-secrets` and Docker volumes. Do not run first-install setup/owner bootstrap again. Use a tested commit from the approved RevenuePilot branch (record the previous `git rev-parse HEAD` for rollback). Fetch and check out that exact commit in the existing `/opt/revenuepilot` checkout only after reviewing any local source changes.

For this additive manual-enrollment release, rebuild application images before restarting only application services:

```bash
docker compose --env-file .env.hostinger -f compose.production.yaml -f compose.database.yaml -f compose.hostinger.yaml config --quiet
docker compose --env-file .env.hostinger -f compose.production.yaml -f compose.database.yaml -f compose.hostinger.yaml build api collector worker web
docker compose --env-file .env.hostinger -f compose.production.yaml -f compose.database.yaml -f compose.hostinger.yaml up -d --no-deps --wait --wait-timeout 240 api collector worker web
python3 scripts/hostingerctl.py verify
python3 scripts/hostingerctl.py status
```

Run each command only after the previous succeeds. This does not recreate MongoDB, Redis, Caddy, Piston or LMS services. A brief application interruption is possible. New enrollment fields are additive; existing order and receipt indexes are unchanged. A rollback must keep the new records and expose their evidence, not discard them. Retain a tested backup before any production update.
