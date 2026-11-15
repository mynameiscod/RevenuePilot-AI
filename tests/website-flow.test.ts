import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { memoryMongoOptions } from "../scripts/mongo-options.ts";
import { readConfig } from "../apps/api/src/config.ts";
import { createApp } from "../apps/api/src/app.ts";
import { connectDatabase } from "../apps/api/src/db.ts";
import { Lead, Receipt, RateBucket } from "../apps/api/src/models.ts";
import {
  Appointment,
  Attempt,
  Enrollment,
  Followup,
  Consent,
  Touch,
} from "../apps/api/src/journey/models.ts";
import { digest } from "../apps/api/src/security.ts";
import { createIntake } from "../packages/sdk/src/intake.ts";

const dashboard = "http://localhost:3001",
  website = "https://www.codebegun.example.test";
let mongo: MongoMemoryReplSet,
  server: Server,
  app: ReturnType<typeof createApp>,
  apiOrigin: string;
let owner: any, cookie: string, csrf: string, tenantId: string;
const realFetch = globalThis.fetch;
function admin(method: "get" | "post" | "patch", path: string, body?: unknown) {
  const req = request(app)
    [method](`/api/v1/tenants/${tenantId}${path}`)
    .set("Origin", dashboard)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", randomUUID());
  return body === undefined ? req : req.send(body as object);
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create(memoryMongoOptions());
  const config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: mongo.getUri("website_flow"),
    DATA_ENCRYPTION_KEY: "ac".repeat(32),
    WEB_ORIGIN: dashboard,
    TRUST_PROXY_CIDRS: "127.0.0.1/32,::1/128",
  });
  await connectDatabase(config.MONGODB_URI);
  app = createApp(config);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  apiOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const reg = await request(app)
    .post("/api/v1/auth/register")
    .set("Origin", dashboard)
    .send({
      name: "Website Owner",
      email: "website-owner@example.test",
      password: "Synthetic-website-password!",
      workspaceName: "Website Pilot",
    })
    .expect(201);
  owner = reg.body;
  cookie = reg.headers["set-cookie"][0].split(";")[0];
  csrf = owner.csrfToken;
  tenantId = owner.tenants[0].id;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await mongo?.stop();
});
it("runs the real SDK over HTTP from external website through follow-up, demo, payment, enrollment and refund attribution", async () => {
  const form = (
    await admin("post", "/forms", {
      name: "Existing Java website",
      course: "Java Full Stack",
      amountMinor: "3500000",
      currency: "INR",
      origins: [website],
      assignees: [owner.user.id],
    }).expect(201)
  ).body;
  const link = (
    await admin("post", "/marketing/links", {
      name: "Google Java website",
      formId: form.id,
      preset: "google",
      source: "google",
      medium: "cpc",
      campaign: "java_website",
      accountId: "123",
      campaignId: "456",
      adId: "789",
      landingUrl: `${website}/courses/java-full-stack`,
    }).expect(201)
  ).body;
  const destination = new URL(link.url);
  vi.stubGlobal("window", { location: destination });
  vi.stubGlobal("document", { referrer: "https://www.google.com/" });
  let interrupt = true;
  const requests: any[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const result = await realFetch(url, {
      ...init,
      headers: { ...init.headers, Origin: website },
    });
    expect(result.headers.get("access-control-allow-origin")).toBe(website);
    expect(result.headers.get("cache-control")).toBe("no-store");
    if (url.endsWith("/submit")) {
      requests.push(JSON.parse(String(init.body)));
      if (interrupt) {
        interrupt = false;
        await result.text();
        throw new Error("Synthetic lost acknowledgement after commit");
      }
    }
    return result;
  });
  const bucket = Math.floor(Date.now() / 60000);
  await request(app)
    .get(`/api/v1/public/forms/${form.publicKey}`)
    .set("Origin", website)
    .set("X-Forwarded-For", "198.51.100.1, 203.0.113.10")
    .expect(200);
  expect(
    await RateBucket.exists({
      _id: digest(`form-read:203.0.113.10:${bucket}`),
    }),
  ).toBeTruthy();
  expect(
    await RateBucket.exists({
      _id: digest(`form-read:198.51.100.1:${bucket}`),
    }),
  ).toBeNull();
  const intake = createIntake({ apiOrigin, formKey: form.publicKey });
  const info = await intake.info();
  expect(info.course).toBe("Java Full Stack");
  intake.setConsent({ tracking: true, advertising: false });
  for (const type of ["viewed", "started", "submitted"] as const)
    await intake.record(type);
  expect(await Lead.countDocuments({ tenantId })).toBe(0);
  const input = {
    name: "Website Student",
    email: "website-student@example.test",
    phone: "+919999999999",
    privacyConsent: true as const,
    marketingConsent: false,
    consentVersion: info.consentVersion,
    message: "Graduation year: 2026",
  };
  await expect(intake.submit(input)).rejects.toMatchObject({
    code: "NETWORK_ERROR",
    retryable: true,
  });
  const confirmation = await intake.submit(input);
  expect(requests[1]).toEqual(requests[0]);
  const leads = (await admin("get", "/leads").expect(200)).body.items;
  expect(leads).toHaveLength(1);
  const lead = leads[0];
  expect(lead).toMatchObject({
    channel: "Google Ads",
    campaign: "java_website",
    entryPoint: "website",
    note: "Graduation year: 2026",
    assignedTo: owner.user.id,
  });
  expect(
    await Followup.countDocuments({
      tenantId,
      leadId: lead.id,
      status: "open",
    }),
  ).toBe(1);
  expect(
    await Attempt.countDocuments({ tenantId, acceptedAt: { $exists: true } }),
  ).toBe(1);
  expect(await Touch.countDocuments({ tenantId, leadId: lead.id })).toBe(1);
  expect(
    (
      await Consent.findOne({
        tenantId,
        leadId: lead.id,
        purpose: "marketing",
      }).lean()
    )?.granted,
  ).toBe(false);
  await admin("post", `/leads/${lead.id}/outcomes`, {
    outcome: "no_answer",
    note: "First attempt unanswered",
    nextFollowupAt: new Date(Date.now() + 3600000).toISOString(),
  }).expect(200);
  await admin("post", `/leads/${lead.id}/outcomes`, {
    outcome: "answered",
    note: "Student requested Java counselling",
  }).expect(200);
  const current = (await admin("get", `/leads/${lead.id}`).expect(200)).body
    .lead;
  await admin("patch", `/leads/${lead.id}/stage`, {
    stage: "qualified",
    version: current.version,
    note: "Confirmed course fit",
  }).expect(200);
  const demo = (
    await admin("post", `/leads/${lead.id}/demos`, {
      hostId: owner.user.id,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      durationMinutes: 30,
    }).expect(201)
  ).body;
  await Appointment.updateOne(
    { _id: demo.id, tenantId },
    { $set: { scheduledAt: new Date(Date.now() - 60000) } },
  );
  await admin("patch", `/demos/${demo.id}`, {
    status: "attended",
    outcome: "interested",
    note: "Demo completed",
    version: 1,
  }).expect(200);
  expect(await Enrollment.countDocuments({ tenantId })).toBe(0);
  const paid = (
    await request(app)
      .post("/api/v1/public/checkout/simulate")
      .set("Origin", dashboard)
      .send({ acceptanceToken: confirmation.acceptanceToken })
      .expect(200)
  ).body;
  await request(app)
    .post("/api/v1/public/checkout/simulate")
    .set("Origin", dashboard)
    .send({ acceptanceToken: confirmation.acceptanceToken })
    .expect(200);
  expect(await Receipt.countDocuments({ tenantId, kind: "capture" })).toBe(1);
  expect(
    await Enrollment.countDocuments({
      tenantId,
      evidence: "sandbox",
      status: "confirmed",
    }),
  ).toBe(1);
  let report = (await admin("get", "/journey/analytics").expect(200)).body;
  expect(report.funnel.every((step: any) => step.count === 1)).toBe(true);
  expect(
    report.revenue.find((r: any) => r.model === "first_touch"),
  ).toMatchObject({
    source: "Google Ads",
    netMinor: "3500000",
    evidence: "sandbox",
    roas: null,
  });
  await admin("post", `/orders/${paid.orderId}/sandbox-refund`, {
    cumulativeMinor: "500000",
  }).expect(200);
  expect((await Enrollment.findOne({ tenantId }).lean())?.status).toBe(
    "review_required",
  );
  report = (await admin("get", "/journey/analytics").expect(200)).body;
  expect(
    report.revenue.find((r: any) => r.model === "first_touch").netMinor,
  ).toBe("3000000");
  await request(app)
    .post(`/api/v1/public/forms/${form.publicKey}/submit`)
    .set("Origin", "https://unregistered.example.test")
    .send(requests[0])
    .expect(403);
  await request(app)
    .options(`/api/v1/public/forms/${form.publicKey}/submit`)
    .set("Origin", website)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type")
    .expect(204);
});
