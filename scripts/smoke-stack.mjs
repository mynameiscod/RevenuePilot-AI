// Exercises the built nginx/API/collector/MongoDB/Redis/worker stack in isolation.
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
const origin = "http://localhost:3001";
const sdk = await fetch(`${origin}/revenuepilot-sdk.js`, {
  headers: { Origin: "https://landing.example.test" },
});
assert.equal(sdk.status, 200);
assert.equal(sdk.headers.get("access-control-allow-origin"), "*");
assert.match(sdk.headers.get("content-type"), /javascript/);
assert.match(await sdk.text(), /createIntake/);
let cookie = "",
  csrf = "",
  tenantId = "";
async function api(path, body, expected = 200, method = body ? "POST" : "GET") {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: HTTP ${response.status}`,
  );
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return response.status === 204 ? null : response.json();
}
const registration = await api(
  "/auth/register",
  {
    name: "Stack Owner",
    email: "stack-owner@example.test",
    password: "Synthetic-stack-password!",
    workspaceName: "Stack Test",
  },
  201,
);
csrf = registration.csrfToken;
tenantId = registration.tenants[0].id;
const t = `/tenants/${tenantId}`;
const form = await api(
  `${t}/forms`,
  {
    name: "Full journey",
    course: "Java Full Stack",
    amountMinor: "3500000",
    currency: "INR",
    origins: [origin],
    assignees: [registration.user.id],
  },
  201,
);
const enquiry = await api(
  `/public/forms/${form.publicKey}/submit`,
  {
    attemptId: randomUUID(),
    anonymousId: randomUUID(),
    name: "Stack Student",
    email: "stack-student@example.test",
    phone: "+910000000001",
    privacyConsent: true,
    marketingConsent: true,
    trackingConsent: true,
    consentVersion: "1",
    touch: { source: "meta", medium: "paid_social", campaign: "Stack test" },
  },
  201,
);
const lead = (await api(`${t}/leads`)).items[0];
await api(`${t}/leads/${lead.id}/outcomes`, {
  outcome: "answered",
  note: "Synthetic stack conversation",
});
await api("/public/checkout/simulate", {
  acceptanceToken: enquiry.acceptanceToken,
});
const report = await api(`${t}/journey/analytics`);
assert.equal(
  report.funnel.find((r) => r.type === "enrollment_confirmed").count,
  1,
);
const secret = "synthetic-stack-signing-secret";
const connection = await api(
  `${t}/connections`,
  { provider: "generic_crm", label: "Stack CRM" },
  201,
);
await api(
  `${t}/integrations/${connection.id}/configure`,
  {
    version: 1,
    mode: "test",
    settings: { importFormId: form.id },
    credentials: { webhookSecret: secret },
  },
  200,
  "PUT",
);
await api(`${t}/integrations/${connection.id}/check`, {});
await api(`${t}/integrations/${connection.id}/activate`, { confirmed: true });
const body = JSON.stringify({
  eventId: randomUUID(),
  type: "contact.upsert.v1",
  contact: {
    externalId: "stack-crm-lead",
    name: "Worker Student",
    email: "worker-student@example.test",
    phone: "",
    source: "Other",
    campaign: "Stack webhook",
  },
});
const timestamp = String(Math.floor(Date.now() / 1000));
const webhook = await fetch(
  `${origin}/api/v1/webhooks/integrations/${connection.id}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RevenuePilot-Timestamp": timestamp,
      "X-RevenuePilot-Signature": `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`,
    },
    body,
  },
);
assert.equal(webhook.status, 202);
let processed = false;
for (let i = 0; i < 30; i++) {
  const integrations = await api(`${t}/integrations`);
  if (integrations.webhooks.some((w) => w.status === "processed")) {
    processed = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(processed, "Redis/BullMQ worker must process the durable webhook");
assert.equal((await api(`${t}/leads`)).total, 2);
const site = await api(
  `${t}/sites`,
  { name: "Stack site", origins: [origin] },
  201,
);
const telemetry = await fetch(`${origin}/api/v1/collect`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({
    siteKey: site.publicKey,
    events: [
      {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        sessionId: randomUUID(),
        anonymousId: randomUUID(),
        path: "/synthetic",
        consent: "granted",
        type: "page.viewed.v1",
        payload: {},
      },
    ],
  }),
});
assert.equal(
  telemetry.status,
  202,
  "Collector must accept consented events through nginx",
);
assert.equal((await telemetry.json()).acceptedIds.length, 1);
console.log(
  "Built-stack smoke passed: registration, intake, contact, sandbox payment/enrollment, signed webhook, Redis worker and collector routing.",
);
