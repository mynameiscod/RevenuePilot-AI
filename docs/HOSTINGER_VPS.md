# Selected Hostinger VPS deployment

## Target and current state

Siva selected the VPS in his Hostinger screenshot and chose `revenuepilot.codebegun.com` on 15 November 2026 (IST).

| Item | Selected target / evidence |
| --- | --- |
| Hostinger VPS ID | `2005345` |
| Hostname shown | `srv2005345.hstgr.cloud` |
| IPv4 shown | `200.97.164.244` |
| OS shown | Ubuntu 24.04 LTS |
| Plan shown | KVM 4; 24 GB RAM and 200 GB disk displayed |
| Application origin | `https://revenuepilot.codebegun.com` |
| Proposed installation directory | `/opt/revenuepilot` |
| Compose project | `revenuepilot-production` |

Screenshot information is not a live host inspection. The selected VPS has **not been changed or deployed to**. Hostinger sign-in is restricted in the available cloud browser, and no server-management connection is configured in this session. No root password, private SSH key or API token belongs in chat or Git.

## Prepared topology

Public HTTPS → dedicated Caddy edge → RevenuePilot web/nginx → private API and collector. The worker uses the same dedicated MongoDB replica set and Redis endpoints. The API, collector and databases have no public port mappings. Web remains bound only to loopback port 8081; Caddy uses the private Docker network directly. Only edge ports 80/443 are added.

`compose.hostinger.yaml` overlays `compose.production.yaml`. It is intended for a VPS where 80/443 and the proposed Docker subnet are free. It must not displace another application's reverse proxy, database or containers. If an existing proxy owns those ports, adapt its routing after inspection instead of starting the edge overlay or stopping the existing service. No LMS change is part of this deployment.

**Database prerequisite:** this profile does not create a database. Supply dedicated, persistent, authenticated TLS MongoDB replica-set and Redis endpoints. A managed service or independently provisioned private database stack can supply them. Use publicly trusted service certificates or an explicitly installed private CA; never disable certificate validation. No database purchase or shared LMS resource is implied.

## Installation contract

These steps describe the prepared release procedure once secure server-management access is available. They are not a record of actions already performed.

1. Inventory current containers, services, listeners, routing, firewall and available capacity. Confirm this is the selected VPS and preserve existing workloads. Verify backups and the absence of any directory/network/project-name collision before creating resources.
2. Pin the reviewed RevenuePilot commit and image digests after CI and image scanning. Fetch through an approved read-only Git credential or transfer the reviewed archive; no credential in a URL or shell history. The paired website change is separate and is not deployed by this stack.
3. Install Docker Engine and its Compose plugin from Docker's official Ubuntu packages only if absent. No reinstall, reboot, firewall replacement or host-wide upgrade is bundled here.
4. Provision/verify the dedicated MongoDB replica set and Redis; record backup and restore evidence. Copy `deploy/hostinger/hostinger.env.example` to `.env.hostinger` on the host with mode 600; fill credentials and a generated stable encryption key securely. Keep a recoverable encrypted copy of that key outside the server. Never generate a replacement key on redeploy.
5. Inspect the current DNS zone before any edit. The intended record is **A `revenuepilot` → `200.97.164.244`**. Existing A/AAAA/CNAME, proxy/CDN configuration and certificate policy need review; email and verification records are preserved. No DNS changes have been made. This initial profile expects direct DNS to the selected IPv4.
6. Run the read-only `python3 scripts/hostinger-preflight.py --env .env.hostinger` on the target. It checks required private settings without printing them, Docker/Compose, port/subnet collisions, DNS and basic free memory/disk. It intentionally stops on occupied edge ports or an existing overlapping network. It is a first-install check, not a redeployment command or proof of database connectivity/capacity.
7. Validate the merged Compose configuration with `docker compose --env-file .env.hostinger -f compose.production.yaml -f compose.hostinger.yaml config --quiet`. Never print the expanded configuration into CI/chat because it contains secrets. Validate the Caddyfile before starting the edge. The container's `/data` and `/config` volumes persist certificate state.
8. Start API/collector/worker/web, verify authenticated database access and real worker/Redis operation, then bring up the edge after DNS/ports/firewall verification. Only TCP 80/443 and optional UDP 443 are application ingress. Restrict administrative access without changing or locking out the existing SSH session. Do not publish MongoDB, Redis, API or collector ports.
9. Complete owner bootstrap behind a temporary access restriction. Registration and live providers/mail default off. Create the CodeBegun owner, enable MFA, establish account recovery and disable registration before opening the pilot. Verify secure cookies, origin checks and actual visitor IP separation behind Caddy/nginx; do not trust arbitrary forwarded headers or CDN ranges by guess.
10. Verify the real HTTPS page, valid certificate, login, lead capture, task assignment and report separation using synthetic staging records. Mongo readiness alone does not verify Redis or worker operation. Test backup restore, logs/alerts and restart persistence on this topology before real leads.
11. Create the five course forms with actual counselors and exact website origins. Then configure the paired website build and run its `check:revenuepilot`. Release it separately only after [WEBSITE_FLOW.md](WEBSITE_FLOW.md) passes. Website master pushes can trigger its existing deployment webhook.
12. Keep live calls, messages, ad feedback and payments off until each required provider/account is certified and enabled explicitly. A published login screen is not certification of the full marketing-to-payment production flow.

## Rollback and operational boundaries

Retain the prior reviewed images, configuration, database backups and stable encryption key. Roll back application images with compatible schemas; preserve database and edge volumes. Never run `down --volumes`, delete data, stop unrelated containers, reset firewall rules or reuse an existing application's network to resolve a collision. Keep pending payment webhooks/workers available if rolling back the website after checkout activation.

The edge profile uses the [official Caddy image](https://hub.docker.com/_/caddy) and [standard reverse-proxy forwarding behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults). It provides certificate automation when DNS and ingress are correct; it does not provide high availability, a backup system or database provisioning. Monitor certificate expiry, available disk, API errors, worker backlog and unknown provider outcomes. Set achievable recovery targets after a measured restore.

**Remaining execution blockers:** secure management access; actual host/DNS inventory; dedicated database/queue provisioning and credentials; owner/bootstrap recovery; production browser and provider certification. The hostname is selected, but the site is not live.
