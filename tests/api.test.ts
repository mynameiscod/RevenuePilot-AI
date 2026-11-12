import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { memoryMongoOptions } from "../scripts/mongo-options.ts";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app.ts";
import { readConfig } from "../apps/api/src/config.ts";
import { connectDatabase } from "../apps/api/src/db.ts";
import {
  User,
  Tenant,
  Membership,
  Lead,
  Receipt,
  Idempotency,
  Connection,
  Event,
  Outbox,
  WebEvent,
  Audit,
} from "../apps/api/src/models.ts";
import { passwordHash, totp } from "../apps/api/src/security.ts";
import { drainOutbox, projectOutbox } from "../apps/worker/src/project.ts";
import type { Role, SessionView } from "../packages/core/src/contracts.ts";

const origin = "http://localhost:3001",
  key = "ab".repeat(32),
  password = "synthetic-password-123!";
type Actor = { cookie: string; csrf: string; tenantId: string; userId: string };
let replica: MongoMemoryReplSet,
  app: ReturnType<typeof createApp>,
  a: Actor,
  b: Actor,
  viewer: Actor,
  counselor: Actor,
  leadId: string,
  captureId: string;
const leadBody = {
  name: "Synthetic Student",
  email: "student@example.test",
  phone: "+910000000001",
  course: "Java Full Stack",
  channel: "Meta Ads",
  campaign: "Synthetic campaign",
  note: "Synthetic lead",
};
function auth(response: request.Response): Actor {
  const body = response.body as SessionView;
  return {
    cookie: response.headers["set-cookie"][0].split(";")[0],
    csrf: body.csrfToken,
    tenantId: body.tenants[0].id,
    userId: body.user.id,
  };
}
function send(
  actor: Actor,
  method: "get" | "post" | "patch" | "put" | "delete",
  path: string,
  data?: unknown,
  idempotencyKey = randomUUID(),
) {
  const req = request(app)
    [method](`/api/v1/tenants/${actor.tenantId}${path}`)
    .set("Cookie", actor.cookie)
    .set("Origin", origin)
    .set("X-CSRF-Token", actor.csrf)
    .set("Idempotency-Key", idempotencyKey);
  return data === undefined ? req : req.send(data as object);
}
async function createActor(email: string, role: Role, tenantId: string) {
  const userId = randomUUID();
  await User.create({
    _id: userId,
    name: `Test ${role}`,
    email,
    passwordHash: await passwordHash(password),
  });
  await Membership.create({ tenantId, userId, role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ email, password })
    .expect(200);
  return auth(res);
}
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create(memoryMongoOptions());
  const config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: replica.getUri("revenuepilot_test"),
    DATA_ENCRYPTION_KEY: key,
    WEB_ORIGIN: origin,
  });
  await connectDatabase(config.MONGODB_URI);
  app = createApp(config);
  a = auth(
    await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .send({
        name: "Tenant A Owner",
        email: "owner-a@example.test",
        password,
        workspaceName: "Tenant A",
      })
      .expect(201),
  );
  b = auth(
    await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .send({
        name: "Tenant B Owner",
        email: "owner-b@example.test",
        password,
        workspaceName: "Tenant B",
      })
      .expect(201),
  );
  viewer = await createActor("viewer@example.test", "viewer", a.tenantId);
  counselor = await createActor(
    "counselor@example.test",
    "counselor",
    a.tenantId,
  );
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});

describe("real MongoDB API workflows", () => {
  it("reports readiness and returns a secure server-side session", async () => {
    await request(app).get("/health/ready").expect(200);
    const session = await request(app)
      .get("/api/v1/auth/session")
      .set("Cookie", a.cookie)
      .expect(200);
    expect(session.body.user.email).toBe("owner-a@example.test");
    expect(JSON.stringify(session.body)).not.toMatch(
      /passwordHash|tokenHash|mfaSecret/,
    );
  });
  it("requires origin and CSRF checks for mutations", async () => {
    for (const localOrigin of [origin, "http://127.0.0.1:3001"]) {
      const denied = await request(app)
        .post(`/api/v1/tenants/${a.tenantId}/leads`)
        .set("Cookie", a.cookie)
        .set("Origin", localOrigin)
        .send(leadBody)
        .expect(403);
      expect(denied.body.code).toBe("CSRF_INVALID");
    }
    await request(app)
      .post(`/api/v1/tenants/${a.tenantId}/leads`)
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .set("Origin", "https://hostile.example.test")
      .send(leadBody)
      .expect(403);
  });
  it("creates a lead, durable outbox and audit in one transaction", async () => {
    const res = await send(a, "post", "/leads", leadBody).expect(201);
    leadId = res.body.id;
    expect(
      await Lead.countDocuments({ _id: leadId, tenantId: a.tenantId }),
    ).toBe(1);
    expect(await Outbox.countDocuments({ tenantId: a.tenantId })).toBe(1);
    expect(
      await Audit.countDocuments({
        tenantId: a.tenantId,
        action: "lead.created",
      }),
    ).toBe(1);
    const stored = await Lead.findById(leadId).select("+contactCipher").lean();
    expect(stored?.contactCipher).not.toContain(leadBody.email);
    expect(
      JSON.stringify(await Idempotency.find({ tenantId: a.tenantId }).lean()),
    ).not.toContain(leadBody.email);
  });
  it("blocks tenant hopping through paths, headers and object IDs", async () => {
    await request(app)
      .get(`/api/v1/tenants/${a.tenantId}/leads/${leadId}`)
      .set("Cookie", b.cookie)
      .set("X-Tenant-Id", a.tenantId)
      .expect(404);
    await send(b, "get", `/leads/${leadId}`).expect(404);
    const list = await send(b, "get", "/leads").expect(200);
    expect(list.body.total).toBe(0);
    await send(b, "patch", `/leads/${leadId}/stage`, {
      stage: "qualified",
      note: "Forged tenant mutation",
      version: 1,
    }).expect(404);
  });
  it("uses current membership roles and conjunctive counselor scope", async () => {
    await send(viewer, "post", "/leads", leadBody).expect(403);
    await send(viewer, "get", "/revenue").expect(403);
    await send(viewer, "get", "/audit").expect(403);
    const masked = await send(viewer, "get", `/leads/${leadId}`).expect(200);
    expect(masked.body.lead.email).toBe("");
    expect(masked.body.lead.name).not.toBe(leadBody.name);
    await send(counselor, "get", `/leads/${leadId}`).expect(404);
    await send(counselor, "get", `/leads?assignedTo=${a.userId}`).expect(422);
    const own = await send(counselor, "post", "/leads", {
      ...leadBody,
      name: "Counselor-owned example",
    }).expect(201);
    expect(
      (await send(counselor, "get", "/leads").expect(200)).body.total,
    ).toBe(1);
    await Membership.updateOne(
      { tenantId: a.tenantId, userId: counselor.userId },
      { $set: { status: "revoked" } },
    );
    await send(counselor, "get", `/leads/${own.body.id}`).expect(404);
  });
  it("makes repeated HTTP operations idempotent and rejects conflicting bodies", async () => {
    const operation = randomUUID(),
      input = { ...leadBody, name: "One logical enquiry" };
    const first = await send(a, "post", "/leads", input, operation).expect(201),
      second = await send(a, "post", "/leads", input, operation).expect(201);
    expect(first.body.id).toBe(second.body.id);
    expect(
      await Lead.countDocuments({ tenantId: a.tenantId, name: input.name }),
    ).toBe(1);
    await send(
      a,
      "post",
      "/leads",
      { ...input, name: "A different body" },
      operation,
    ).expect(409);
  });
  it("rejects unknown input fields and operator injection", async () => {
    await send(a, "post", "/leads", {
      ...leadBody,
      tenantId: b.tenantId,
    }).expect(422);
    await send(a, "get", "/leads?q[$ne]=anything").expect(422);
  });
  it("uses optimistic concurrency without inventing contact evidence", async () => {
    await send(a, "patch", `/leads/${leadId}/stage`, {
      stage: "qualified",
      note: "Qualification recorded",
      version: 1,
    }).expect(200);
    await send(a, "patch", `/leads/${leadId}/stage`, {
      stage: "enrolled",
      note: "Stale mutation",
      version: 1,
    }).expect(409);
    const detail = await send(a, "get", `/leads/${leadId}`).expect(200);
    expect(detail.body.lead.stage).toBe("qualified");
    expect(detail.body.lead.lastContactAt).toBeUndefined();
    await send(a, "post", `/leads/${leadId}/contact`, {
      note: "Attempted a synthetic call",
    }).expect(200);
    expect(
      (await send(a, "get", `/leads/${leadId}`).expect(200)).body.lead
        .lastContactAt,
    ).toBeTruthy();
  });
  it("projects each outbox event once even with repeated delivery", async () => {
    await drainOutbox();
    const count = await Event.countDocuments({ tenantId: a.tenantId });
    const item = await Outbox.findOne({ tenantId: a.tenantId }).lean();
    await Promise.all([projectOutbox(item!._id), projectOutbox(item!._id)]);
    expect(await Event.countDocuments({ tenantId: a.tenantId })).toBe(count);
    expect(
      await Outbox.countDocuments({ processedAt: { $exists: false } }),
    ).toBe(0);
  });
  it("records one capture on duplicate requests and retains exact minor units", async () => {
    const operation = randomUUID(),
      body = {
        leadId,
        kind: "capture",
        amountMinor: "100001",
        currency: "INR",
        reference: "SYN-CAPTURE-1",
        note: "Synthetic manual evidence",
      };
    const first = await send(a, "post", "/revenue", body, operation).expect(
      201,
    );
    captureId = first.body.id;
    await send(a, "post", "/revenue", body, operation).expect(201);
    expect(await Receipt.countDocuments({ tenantId: a.tenantId })).toBe(1);
    await send(a, "post", "/revenue", body).expect(409);
    await send(a, "post", "/revenue", {
      ...body,
      amountMinor: "1000.01",
      reference: "INVALID",
    }).expect(422);
    expect(
      (await send(a, "get", "/overview").expect(200)).body.cashByCurrency.INR
        .net,
    ).toBe("100001");
  });
  it("validates refund ownership/currency and prevents concurrent over-refunds", async () => {
    const base = {
      leadId,
      kind: "refund",
      amountMinor: "70000",
      currency: "INR",
      originalReceiptId: captureId,
      reference: "SYN-REFUND-1",
      note: "Synthetic partial refund",
    };
    await send(b, "post", "/revenue", base).expect(404);
    await send(a, "post", "/revenue", { ...base, currency: "USD" }).expect(422);
    const results = await Promise.all([
      send(a, "post", "/revenue", base),
      send(a, "post", "/revenue", { ...base, reference: "SYN-REFUND-2" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const totals = (await send(a, "get", "/overview").expect(200)).body
      .cashByCurrency.INR;
    expect(totals).toEqual({ gross: "100001", refunds: "70000", net: "30001" });
    const ledger = await send(
      a,
      "get",
      `/revenue?leadId=${leadId}&kind=capture`,
    ).expect(200);
    expect(ledger.body.total).toBe(1);
  });
  it("keeps provider credentials encrypted, tenant-bound and inactive", async () => {
    const res = await send(a, "post", "/connections", {
      provider: "meta",
      label: "Synthetic account",
      accountId: "synthetic",
      credentials: { accessToken: "PRIVATE-TEST-ONLY" },
    }).expect(201);
    const stored = await Connection.findById(res.body.id)
      .select("+credentialCipher")
      .lean();
    expect(stored?.credentialCipher).not.toContain("PRIVATE-TEST-ONLY");
    const list = await send(a, "get", "/connections").expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(
      /PRIVATE-TEST-ONLY|credentialCipher/,
    );
    expect(list.body.items[0].status).toBe("draft");
    await send(a, "post", `/connections/${res.body.id}/sync`, {}).expect(422);
    await send(b, "delete", `/connections/${res.body.id}`).expect(404);
  });
  it("accepts consented telemetry only for an allowed site and deduplicates it", async () => {
    const site = await send(a, "post", "/sites", {
      name: "Test website",
      origins: ["https://capture.example.test"],
    }).expect(201);
    const event = {
      eventId: "event_1",
      type: "form.started.v1",
      occurredAt: new Date().toISOString(),
      sessionId: "session_1",
      anonymousId: "anon_1",
      consent: "granted",
      path: "/java",
      payload: { formId: "java-form", attemptId: "attempt_1" },
    };
    const body = { siteKey: site.body.publicKey, events: [event] };
    await request(app)
      .post("/api/v1/collect")
      .set("Origin", "https://evil.example.test")
      .send(body)
      .expect(403);
    const first = await request(app)
      .post("/api/v1/collect")
      .set("Origin", "https://capture.example.test")
      .send(body)
      .expect(202);
    expect(first.body.acceptedIds).toEqual(["event_1"]);
    const duplicate = await request(app)
      .post("/api/v1/collect")
      .set("Origin", "https://capture.example.test")
      .send(body)
      .expect(202);
    expect(duplicate.body.duplicateIds).toEqual(["event_1"]);
    expect(await WebEvent.countDocuments({ tenantId: a.tenantId })).toBe(1);
    expect(await WebEvent.countDocuments({ tenantId: b.tenantId })).toBe(0);
    await request(app)
      .post("/api/v1/collect")
      .set("Origin", "https://capture.example.test")
      .send({ ...body, events: [{ ...event, type: "payment.captured.v1" }] })
      .expect(422);
    await request(app)
      .post("/api/v1/collect")
      .set("Origin", "https://capture.example.test")
      .send({ ...body, events: [{ ...event, tenantId: b.tenantId }] })
      .expect(422);
  });
  it("enables TOTP and blocks OTP reuse", async () => {
    const setup = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .set("Origin", origin)
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ password })
      .expect(200);
    const nowStep = Math.floor(Date.now() / 30000),
      code = totp(setup.body.secret, nowStep);
    await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .set("Origin", origin)
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ code })
      .expect(200);
    const noMfa = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ email: "owner-a@example.test", password })
      .expect(401);
    expect(noMfa.body.code).toBe("MFA_REQUIRED");
    const nextCode = totp(setup.body.secret, nowStep + 1);
    await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ email: "owner-a@example.test", password, code: nextCode })
      .expect(200);
    await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ email: "owner-a@example.test", password, code: nextCode })
      .expect(401);
  });
  it("revokes sessions on logout", async () => {
    await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", origin)
      .set("Cookie", b.cookie)
      .set("X-CSRF-Token", b.csrf)
      .send({})
      .expect(204);
    await request(app)
      .get("/api/v1/auth/session")
      .set("Cookie", b.cookie)
      .expect(401);
  });
});
