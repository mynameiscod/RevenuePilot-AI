import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID, createHmac } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { memoryMongoOptions } from "../scripts/mongo-options.ts";
import { createApp } from "../apps/api/src/app.ts";
import { readConfig } from "../apps/api/src/config.ts";
import { connectDatabase } from "../apps/api/src/db.ts";
import { Lead, Receipt, Connection, Tenant } from "../apps/api/src/models.ts";
import {
  Acceptance,
  Appointment,
  Attempt,
  Enrollment,
  Followup,
  PaymentOrder,
  Usage,
  Webhook,
  AdSpend,
  Touch,
  Consent,
  Command,
} from "../apps/api/src/journey/models.ts";
import { seal } from "../apps/api/src/security.ts";
import { attributionWeights } from "../apps/api/src/journey/analytics.ts";
import { settleOrder } from "../apps/api/src/journey/payments.ts";
const origin = "http://localhost:3001",
  encryptionKey = "cd".repeat(32);
let replica: MongoMemoryReplSet,
  app: ReturnType<typeof createApp>,
  cookie: string,
  csrf: string,
  tenantId: string,
  ownerId: string,
  formKey: string,
  formId: string,
  leadId: string,
  acceptanceToken: string,
  orderId: string;
const input = {
  attemptId: randomUUID(),
  anonymousId: randomUUID(),
  name: "Synthetic Journey",
  email: "journey@example.test",
  phone: "+910000000002",
  privacyConsent: true,
  marketingConsent: true,
  trackingConsent: true,
  consentVersion: "1",
  touch: {
    source: "Meta Ads",
    medium: "paid",
    campaign: "Java pilot",
    adId: "ad_test",
    clickIds: {},
  },
  website: "",
};
const send = (
  method: "get" | "post" | "patch" | "put",
  path: string,
  body?: unknown,
  key = randomUUID(),
) => {
  const req = request(app)
    [method](`/api/v1/tenants/${tenantId}${path}`)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", key);
  return body === undefined ? req : req.send(body as object);
};
const publicPost = (path: string, body: unknown) =>
  request(app)
    .post(`/api/v1/public${path}`)
    .set("Origin", origin)
    .send(body as object);
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create(memoryMongoOptions());
  const config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: replica.getUri("journey_test"),
    DATA_ENCRYPTION_KEY: encryptionKey,
    WEB_ORIGIN: origin,
  });
  await connectDatabase(config.MONGODB_URI);
  app = createApp(config);
  const owner = await request(app)
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({
      name: "Journey Owner",
      email: "journey-owner@example.test",
      password: "Synthetic-test-password!",
      workspaceName: "Journey Pilot",
    })
    .expect(201);
  cookie = owner.headers["set-cookie"][0].split(";")[0];
  csrf = owner.body.csrfToken;
  tenantId = owner.body.tenants[0].id;
  ownerId = owner.body.user.id;
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});
describe("independent acquisition-to-enrollment journey", () => {
  it("creates a priced form and rejects untrusted browser origins", async () => {
    const form = await send("post", "/forms", {
      name: "Java enquiry",
      course: "Java Full Stack",
      amountMinor: "100001",
      currency: "INR",
      origins: [origin],
      assignees: [ownerId],
    }).expect(201);
    formId = form.body.id;
    formKey = form.body.publicKey;
    await request(app)
      .post(`/api/v1/public/forms/${formKey}/submit`)
      .set("Origin", "https://hostile.example.test")
      .send(input)
      .expect(403);
    await publicPost(`/forms/${formKey}/submit`, {
      ...input,
      tenantId: "forged",
    }).expect(422);
  });
  it("distinguishes observed form attempts from server-accepted leads", async () => {
    const event = {
      attemptId: input.attemptId,
      anonymousId: input.anonymousId,
      type: "started",
      path: "/java",
      trackingConsent: true,
      touch: input.touch,
    };
    await publicPost(`/forms/${formKey}/events`, event).expect(202);
    await publicPost(`/forms/${formKey}/events`, event).expect(202);
    expect(await Attempt.countDocuments({ tenantId })).toBe(1);
    expect(await Lead.countDocuments({ tenantId })).toBe(0);
    const accepted = await publicPost(`/forms/${formKey}/submit`, input).expect(
      201,
    );
    acceptanceToken = accepted.body.acceptanceToken;
    expect(accepted.body.leadId).toBeUndefined();
    leadId = (await Lead.findOne({ tenantId }).lean())!._id;
    expect(
      await Followup.countDocuments({ tenantId, leadId, status: "open" }),
    ).toBe(1);
    expect(
      (await Attempt.findOne({ tenantId }).lean())?.acceptedAt,
    ).toBeTruthy();
  });
  it("deduplicates simultaneous retries and returning enquiries without exposing customer IDs", async () => {
    const retried = await publicPost(`/forms/${formKey}/submit`, input).expect(
      201,
    );
    expect(retried.body.acceptanceToken).toBe(acceptanceToken);
    await publicPost(`/forms/${formKey}/submit`, {
      ...input,
      name: "Changed payload",
    }).expect(409);
    const repeat = { ...input, attemptId: randomUUID() };
    const responses = await Promise.all([
      publicPost(`/forms/${formKey}/submit`, repeat),
      publicPost(`/forms/${formKey}/submit`, repeat),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body.acceptanceToken).toBe(
      responses[1].body.acceptanceToken,
    );
    expect(await Lead.countDocuments({ tenantId })).toBe(1);
    expect(await Acceptance.countDocuments({ tenantId })).toBe(2);
  });
  it("accepts functional enquiries without tracking consent and enforces lead quotas atomically", async () => {
    await publicPost(`/forms/${formKey}/submit`, {
      ...input,
      attemptId: randomUUID(),
      email: "private@example.test",
      trackingConsent: false,
      marketingConsent: false,
    }).expect(201);
    expect(await Attempt.countDocuments({ tenantId })).toBe(2);
    await Usage.updateOne(
      { tenantId, metric: "leads" },
      { $set: { count: 1000 } },
    );
    await publicPost(`/forms/${formKey}/submit`, {
      ...input,
      attemptId: randomUUID(),
      email: "over-limit@example.test",
    }).expect(429);
    expect(await Lead.countDocuments({ tenantId })).toBe(2);
    await Usage.updateOne(
      { tenantId, metric: "leads" },
      { $set: { count: 2 } },
    );
  });
  it("records contact outcomes, schedules demos and rejects overlapping host bookings", async () => {
    await send("post", `/leads/${leadId}/outcomes`, {
      outcome: "answered",
      note: "Synthetic student connected",
    }).expect(200);
    const lead = await Lead.findById(leadId).lean();
    await send("patch", `/leads/${leadId}/stage`, {
      stage: "qualified",
      version: lead!.version,
      note: "Meets course prerequisites",
    }).expect(200);
    const scheduledAt = new Date(Date.now() + 3600000).toISOString();
    const demo = await send("post", `/leads/${leadId}/demos`, {
      hostId: ownerId,
      scheduledAt,
      durationMinutes: 30,
    }).expect(201);
    await send("post", `/leads/${leadId}/demos`, {
      hostId: ownerId,
      scheduledAt: new Date(Date.parse(scheduledAt) + 15 * 60000).toISOString(),
      durationMinutes: 30,
    }).expect(409);
    const outcome = {
      status: "attended",
      outcome: "interested",
      note: "Synthetic attendance confirmed",
      version: 1,
    };
    await send("patch", `/demos/${demo.body.id}`, outcome).expect(422);
    await Appointment.updateOne(
      { _id: demo.body.id },
      { $set: { scheduledAt: new Date(Date.now() - 60000) } },
    );
    await send("patch", `/demos/${demo.body.id}`, outcome).expect(200);
    await send("patch", `/demos/${demo.body.id}`, outcome).expect(409);
  });
  it("creates one sandbox capture and enrollment for concurrent payment confirmations", async () => {
    const results = await Promise.all([
      publicPost("/checkout/simulate", { acceptanceToken }),
      publicPost("/checkout/simulate", { acceptanceToken }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    orderId = results[0].body.orderId;
    expect(await Receipt.countDocuments({ tenantId, kind: "capture" })).toBe(1);
    expect(
      await Enrollment.countDocuments({
        tenantId,
        orderId,
        evidence: "sandbox",
      }),
    ).toBe(1);
    const returning = await publicPost(`/forms/${formKey}/submit`, {
      ...input,
      attemptId: randomUUID(),
    }).expect(201);
    const sameOffer = await publicPost("/checkout/simulate", {
      acceptanceToken: returning.body.acceptanceToken,
    }).expect(200);
    expect(sameOffer.body.orderId).toBe(orderId);
    expect(await Receipt.countDocuments({ tenantId, kind: "capture" })).toBe(1);
    const report = await send("get", "/journey/analytics").expect(200);
    expect(
      report.body.funnel.find((r: any) => r.type === "enrollment_confirmed")
        .count,
    ).toBe(1);
    const linear = report.body.revenue.filter((r: any) => r.model === "linear");
    expect(
      linear.reduce((sum: bigint, r: any) => sum + BigInt(r.netMinor), 0n),
    ).toBe(100001n);
    expect(linear[0].roas).toBeNull();
  });
  it("reconciles cumulative refunds once and flags enrollment for review", async () => {
    await send("post", `/orders/${orderId}/sandbox-refund`, {
      cumulativeMinor: "33333",
    }).expect(200);
    await send("post", `/orders/${orderId}/sandbox-refund`, {
      cumulativeMinor: "33333",
    }).expect(200);
    await send("post", `/orders/${orderId}/sandbox-refund`, {
      cumulativeMinor: "100002",
    }).expect(422);
    expect(await Receipt.countDocuments({ tenantId, kind: "refund" })).toBe(1);
    expect(
      (await Enrollment.findOne({ tenantId, orderId }).lean())?.status,
    ).toBe("review_required");
    await send("post", `/orders/${orderId}/sandbox-refund`, {
      cumulativeMinor: "100001",
    }).expect(200);
    const stale = await send("post", `/orders/${orderId}/sandbox-refund`, {
      cumulativeMinor: "33333",
    }).expect(200);
    expect(stale.body.status).toBe("refunded");
    const order = await PaymentOrder.findById(orderId).lean();
    await expect(
      settleOrder(
        orderId,
        tenantId,
        {
          orderId,
          externalId: String(order!.externalId),
          paymentId: String(order!.externalPaymentId),
          amountMinor: "1",
          currency: "INR",
          paid: true,
          live: false,
          refundedMinor: "0",
        },
        "forged",
        true,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_EVIDENCE_MISMATCH" });
  });
  it("conserves minor units across first, last and linear models and incremental refunds", () => {
    const touches = ["Meta Ads", "Google Ads", "Meta Ads"].map((source, i) => ({
      _id: `touch${i}`,
      source,
      occurredAt: new Date(i * 1000),
    }));
    for (const model of ["first_touch", "last_touch", "linear"]) {
      const full = attributionWeights("100001", touches, model),
        previous = attributionWeights("33333", touches, model),
        current = attributionWeights("33334", touches, model);
      expect(
        Object.values(full).reduce((sum, value) => sum + BigInt(value), 0n),
      ).toBe(100001n);
      expect(
        Object.keys(current).reduce(
          (sum, source) =>
            sum + BigInt(current[source]) - BigInt(previous[source] ?? "0"),
          0n,
        ),
      ).toBe(1n);
    }
  });
  it("joins ad spend only by exact IDs, deduplicates duplicate connections and separates test cash", async () => {
    await Touch.updateMany(
      { tenantId },
      {
        $set: {
          accountId: "123",
          campaignId: "campaign-1",
          adId: "ad-1",
          source: "Meta Ads",
        },
      },
    );
    const row = {
      tenantId,
      accountId: "123",
      source: "Meta Ads",
      campaign: "Java",
      campaignId: "campaign-1",
      adId: "ad-1",
      date: new Date().toISOString().slice(0, 10),
      currency: "INR",
      amountMinor: "20000",
      clicks: 12,
      impressions: 500,
      evidence: "provider_verified",
    };
    await AdSpend.create([
      { ...row, connectionId: "connection-1" },
      { ...row, connectionId: "connection-2" },
    ]);
    const report = await send("get", "/journey/analytics").expect(200);
    expect(report.body.advertising).toHaveLength(1);
    const live = report.body.campaigns.find(
      (r: any) => r.model === "linear" && r.evidence === "provider_verified",
    );
    expect(live.spendMinor).toBe("20000");
    expect(live.netMinor).toBe("0");
    const test = report.body.campaigns.find(
      (r: any) => r.model === "linear" && r.evidence === "sandbox",
    );
    expect(test.spendMinor).toBe("0");
    expect(test.roas).toBeNull();
  });
  it("lets the contact withdraw optional consent using the opaque confirmation link", async () => {
    const cmd = await Command.create({
      tenantId,
      leadId,
      idempotencyKey: randomUUID(),
      status: "queued",
    });
    await publicPost("/checkout/withdraw-consent", { acceptanceToken }).expect(
      200,
    );
    expect((await Command.findById(cmd._id).lean())?.status).toBe("cancelled");
    const consent = await Consent.findOne({
      tenantId,
      leadId,
      purpose: "marketing",
    })
      .sort({ occurredAt: -1 })
      .lean();
    expect(consent?.granted).toBe(false);
    await Acceptance.updateOne(
      {
        tokenHash: (await import("../apps/api/src/security.ts")).digest(
          acceptanceToken,
        ),
      },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await publicPost("/checkout/status", { acceptanceToken }).expect(404);
  });
  it("authenticates exact raw webhook bytes and rejects conflicting replays", async () => {
    const secret = "synthetic-webhook-secret-only";
    const connection = await Connection.create({
      tenantId,
      provider: "razorpay",
      label: "Synthetic webhook",
      accountId: "test-webhook",
      status: "test",
      mode: "test",
      credentialCipher: seal(
        {
          keyId: "rzp_test_synthetic",
          keySecret: "synthetic",
          webhookSecret: secret,
        },
        encryptionKey,
        tenantId,
      ),
    });
    const path = `/api/v1/webhooks/payments/${connection._id}`,
      body = JSON.stringify({ event: "payment_link.paid", payload: {} });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    await request(app)
      .post(path)
      .set("Content-Type", "application/json")
      .send(body)
      .expect(400);
    for (let i = 0; i < 2; i++)
      await request(app)
        .post(path)
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", "event-synthetic")
        .send(body)
        .expect(202);
    expect(await Webhook.countDocuments({ connectionId: connection._id })).toBe(
      1,
    );
    const changed = JSON.stringify({ event: "refund.processed", payload: {} });
    await request(app)
      .post(path)
      .set("Content-Type", "application/json")
      .set(
        "X-Razorpay-Signature",
        createHmac("sha256", secret).update(changed).digest("hex"),
      )
      .set("X-Razorpay-Event-Id", "event-synthetic")
      .send(changed)
      .expect(409);
  });
});
