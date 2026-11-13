import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { memoryMongoOptions } from "../scripts/mongo-options.ts";
import { createApp } from "../apps/api/src/app.ts";
import { readConfig } from "../apps/api/src/config.ts";
import { connectDatabase } from "../apps/api/src/db.ts";
import { Lead, Tenant, User, Membership } from "../apps/api/src/models.ts";
import {
  MarketingLink,
  Attempt,
  Touch,
  AdSpend,
} from "../apps/api/src/journey/models.ts";
import { passwordHash } from "../apps/api/src/security.ts";
import {
  classifySource,
  readAcquisitionTouch,
} from "../packages/core/src/marketing.ts";

const origin = "http://localhost:3001",
  externalOrigin = "https://landing.example.test";
const password = "Synthetic-marketing-password!";
type Actor = { cookie: string; csrf: string; tenantId: string; userId: string };
let replica: MongoMemoryReplSet, app: ReturnType<typeof createApp>;
let owner: Actor, other: Actor, analyst: Actor, counselor: Actor;
let formId: string, formKey: string, otherFormId: string, otherFormKey: string;
let metaLink: any, googleLink: any, leadId: string;
const mainAttempt = { attemptId: randomUUID(), anonymousId: randomUUID() };
const actor = (response: request.Response): Actor => ({
  cookie: response.headers["set-cookie"][0].split(";")[0],
  csrf: response.body.csrfToken,
  tenantId: response.body.tenants[0].id,
  userId: response.body.user.id,
});
function send(
  a: Actor,
  method: "get" | "post" | "patch",
  path: string,
  body?: unknown,
  key = randomUUID(),
) {
  const req = request(app)
    [method](`/api/v1/tenants/${a.tenantId}${path}`)
    .set("Cookie", a.cookie)
    .set("Origin", origin)
    .set("X-CSRF-Token", a.csrf)
    .set("Idempotency-Key", key);
  return body === undefined ? req : req.send(body as object);
}
function publicPost(
  path: string,
  body: unknown,
  key = formKey,
  browserOrigin = origin,
) {
  return request(app)
    .post(`/api/v1/public/forms/${key}/${path}`)
    .set("Origin", browserOrigin)
    .send(body as object);
}
function submission(
  email: string,
  touch: unknown = {},
  ids = { attemptId: randomUUID(), anonymousId: randomUUID() },
) {
  return {
    ...ids,
    name: "Synthetic Marketing Student",
    email,
    privacyConsent: true,
    marketingConsent: false,
    trackingConsent: true,
    consentVersion: "1",
    touch,
  };
}
function event(
  ids: { attemptId: string; anonymousId: string },
  touch: unknown,
  type = "viewed",
) {
  return {
    attemptId: ids.attemptId,
    anonymousId: ids.anonymousId,
    type,
    path: "/courses/java",
    trackingConsent: true,
    touch,
  };
}
const linkInput = (form: string, preset = "meta") => ({
  name: `Synthetic ${preset} campaign`,
  formId: form,
  preset,
  source: preset,
  medium: preset === "meta" ? "paid_social" : "cpc",
  campaign: "java_pilot",
  accountId: "act_123",
  campaignId: "campaign_1",
  adId: "ad_1",
});

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create(memoryMongoOptions());
  const config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: replica.getUri("marketing_test"),
    DATA_ENCRYPTION_KEY: "ef".repeat(32),
    WEB_ORIGIN: origin,
  });
  await connectDatabase(config.MONGODB_URI);
  app = createApp(config);
  async function register(email: string) {
    return actor(
      await request(app)
        .post("/api/v1/auth/register")
        .set("Origin", origin)
        .send({
          name: "Marketing Owner",
          email,
          password,
          workspaceName: "Marketing Pilot",
        })
        .expect(201),
    );
  }
  owner = await register("marketing-owner@example.test");
  other = await register("other-marketing-owner@example.test");
  for (const role of ["analyst", "counselor"] as const) {
    const email = `${role}-marketing@example.test`,
      userId = randomUUID();
    await User.create({
      _id: userId,
      name: `Marketing ${role}`,
      email,
      passwordHash: await passwordHash(password),
    });
    await Membership.create({ tenantId: owner.tenantId, userId, role });
    const a = actor(
      await request(app)
        .post("/api/v1/auth/login")
        .set("Origin", origin)
        .send({ email, password })
        .expect(200),
    );
    if (role === "analyst") analyst = a;
    else counselor = a;
  }
  for (const a of [owner, other]) {
    const res = await send(a, "post", "/forms", {
      name: "Marketing enquiry",
      course: "Java Full Stack",
      amountMinor: "3500000",
      currency: "INR",
      origins: [origin, externalOrigin],
      assignees: [a.userId],
    }).expect(201);
    if (a === owner) {
      formId = res.body.id;
      formKey = res.body.publicKey;
    } else {
      otherFormId = res.body.id;
      otherFormKey = res.body.publicKey;
    }
  }
  await Tenant.updateOne(
    { _id: owner.tenantId },
    { $set: { retentionDays: 14 } },
  );
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

describe("source classification without invented paid clicks", () => {
  it("distinguishes paid, organic search, organic social and ambiguous source tags", () => {
    expect(classifySource("google", "organic")).toBe("Organic");
    expect(classifySource("google", "cpc")).toBe("Google Ads");
    expect(
      classifySource("instagram", "social", { fbclid: "shared_link" }),
    ).toBe("Organic Social");
    expect(classifySource("instagram", "paid_social")).toBe("Meta Ads");
    expect(classifySource("youtube", "paid_video")).toBe("YouTube Ads");
    expect(classifySource("facebook", "", { fbclid: "shared_link" })).toBe(
      "Other",
    );
    expect(classifySource("partner", "referral")).toBe("Referral");
    expect(classifySource("newsletter", "email")).toBe("Email");
    expect(classifySource("whatsapp", "messaging")).toBe("Messaging");
    expect(classifySource("Direct")).toBe("Direct");
  });
  it("keeps only permitted URL fields and referrer hostnames, including untagged Google ad clicks", () => {
    const touch = readAcquisitionTouch(
      "?rp_link=ml_test&utm_source=meta&utm_medium=paid_social&utm_id=c1&ad_account_id=a1&ad_id=d1&email=secret-person",
      "https://partner.example.test/person/secret-person?email=secret-person",
      origin,
    );
    expect(touch).toMatchObject({
      marketingKey: "ml_test",
      campaignId: "c1",
      accountId: "a1",
      adId: "d1",
    });
    expect(JSON.stringify(touch)).not.toContain("secret-person");
    const search = readAcquisitionTouch(
      "",
      "https://www.google.com/search?q=private",
      origin,
    );
    expect(search).toMatchObject({ source: "google.com", medium: "organic" });
    const paid = readAcquisitionTouch(
      "?gclid=synthetic",
      "https://www.google.com/",
      origin,
    );
    expect(classifySource(paid.source, paid.medium, paid.clickIds)).toBe(
      "Google Ads",
    );
    expect(
      readAcquisitionTouch("", `${origin}/private?person=secret`, origin)
        .source,
    ).toBe("Direct");
    expect(
      readAcquisitionTouch(
        "",
        "https://partner.example.test/private?person=secret",
        origin,
      ),
    ).toMatchObject({ source: "partner.example.test", medium: "referral" });
    expect(
      readAcquisitionTouch(`?utm_source=${"x".repeat(500)}`).source,
    ).toHaveLength(80);
  });
});

describe("marketing source to accepted lead", () => {
  it("creates scoped immutable campaign links idempotently and validates destination origins", async () => {
    const input = linkInput(formId),
      key = randomUUID();
    const response = await send(
      owner,
      "post",
      "/marketing/links",
      input,
      key,
    ).expect(201);
    metaLink = response.body;
    expect(
      (await send(owner, "post", "/marketing/links", input, key).expect(201))
        .body,
    ).toEqual(metaLink);
    const url = new URL(metaLink.url);
    metaLink.key = url.searchParams.get("rp_link");
    expect(url.pathname).toBe(`/enquire/${formKey}`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "java_pilot",
      utm_id: "campaign_1",
      ad_id: "ad_1",
      ad_account_id: "act_123",
    });
    expect(
      await MarketingLink.countDocuments({ tenantId: owner.tenantId }),
    ).toBe(1);
    await send(owner, "post", "/marketing/links", {
      ...input,
      formId: otherFormId,
    }).expect(404);
    await send(owner, "post", "/marketing/links", {
      ...input,
      source: "google",
    }).expect(422);
    await send(owner, "post", "/marketing/links", {
      ...input,
      medium: "organic",
    }).expect(422);
    for (const landingUrl of [
      "https://untrusted.example.test/java",
      `${externalOrigin}/java?email=secret`,
      `${externalOrigin}/java#private`,
      "https://name:secret@landing.example.test/java",
    ]) {
      await send(owner, "post", "/marketing/links", {
        ...input,
        landingUrl,
      }).expect(422);
    }
    googleLink = (
      await send(owner, "post", "/marketing/links", {
        ...linkInput(formId, "google"),
        accountId: "",
        campaignId: "",
        adId: "",
        landingUrl: `${externalOrigin}/java`,
      }).expect(201)
    ).body;
    googleLink.key = new URL(googleLink.url).searchParams.get("rp_link");
    await send(owner, "patch", `/marketing/links/${metaLink.id}`, {
      active: true,
      campaign: "rewrite_history",
    }).expect(422);
  });

  it("deduplicates concurrent observations, retains first source and links server-accepted enquiries", async () => {
    const touch = {
      marketingKey: metaLink.key,
      source: "google",
      medium: "organic",
      campaign: "forged",
      adId: "forged",
      clickIds: { fbclid: "synthetic-click" },
    };
    const observations = await Promise.all([
      publicPost("events", event(mainAttempt, touch)),
      publicPost("events", event(mainAttempt, touch)),
    ]);
    expect(observations.map((r) => r.status)).toEqual([202, 202]);
    await publicPost(
      "events",
      event(mainAttempt, { marketingKey: googleLink.key }, "started"),
    ).expect(202);
    const input = submission(
      "source-first@example.test",
      { marketingKey: googleLink.key },
      mainAttempt,
    );
    const accepted = await publicPost("submit", input).expect(201);
    expect(
      (await publicPost("submit", input).expect(201)).body.acceptanceToken,
    ).toBe(accepted.body.acceptanceToken);
    const lead = await Lead.findOne({ tenantId: owner.tenantId }).lean();
    leadId = lead!._id;
    expect(lead).toMatchObject({ channel: "Meta Ads", campaign: "java_pilot" });
    expect(await Touch.countDocuments({ tenantId: owner.tenantId })).toBe(1);
    expect(
      await Touch.findOne({ tenantId: owner.tenantId }).lean(),
    ).toMatchObject({
      source: "Meta Ads",
      sourceDetail: "meta",
      medium: "paid_social",
      campaignId: "campaign_1",
      adId: "ad_1",
      marketingLinkId: metaLink.id,
      tagStatus: "managed_link",
    });
    const attempt = await Attempt.findOne({ tenantId: owner.tenantId }).lean();
    expect(+attempt!.expiresAt! - +attempt!.createdAt!).toBeGreaterThan(
      13.9 * 86400000,
    );
    expect(+attempt!.expiresAt! - +attempt!.createdAt!).toBeLessThan(
      14.1 * 86400000,
    );
    const report = (await send(owner, "get", "/marketing").expect(200)).body;
    expect(report.totals).toMatchObject({
      leads: 1,
      trackedLeads: 1,
      observedVisits: 1,
      acceptedEnquiries: 1,
      incompletePaidTags: 0,
    });
    expect(report.links.find((l: any) => l.id === metaLink.id)).toMatchObject({
      visits: 1,
      starts: 1,
      acceptedEnquiries: 1,
      newLeads: 1,
    });
    const history = (
      await send(owner, "get", `/leads/${leadId}/journey`).expect(200)
    ).body.sources;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ source: "Meta Ads", adId: "ad_1" });
    expect(JSON.stringify(history)).not.toContain("synthetic-click");
  });

  it("records returning source touches without inflating new leads or rewriting the first source", async () => {
    await publicPost(
      "submit",
      submission("source-first@example.test", { marketingKey: googleLink.key }),
    ).expect(201);
    const report = (await send(owner, "get", "/marketing").expect(200)).body;
    expect(report.totals).toMatchObject({ leads: 1, acceptedEnquiries: 2 });
    expect(report.links.find((l: any) => l.id === googleLink.id)).toMatchObject(
      { acceptedEnquiries: 1, newLeads: 0 },
    );
    expect(report.recentLeads[0]).toMatchObject({
      source: "Meta Ads",
      marketingLinkId: metaLink.id,
    });
    expect(
      await Touch.countDocuments({ tenantId: owner.tenantId, leadId }),
    ).toBe(2);
    await publicPost(
      "submit",
      submission("missing-ad-ids@example.test", {
        marketingKey: googleLink.key,
      }),
    ).expect(201);
    expect(
      (await send(owner, "get", "/marketing").expect(200)).body.totals
        .incompletePaidTags,
    ).toBe(1);
  });

  it("accepts enquiries without tracking and removes an earlier observation when consent is withheld", async () => {
    const without = submission("no-measurement@example.test", {
      marketingKey: metaLink.key,
    });
    await publicPost("submit", { ...without, trackingConsent: false }).expect(
      201,
    );
    expect(
      await Attempt.countDocuments({
        tenantId: owner.tenantId,
        attemptId: without.attemptId,
      }),
    ).toBe(0);
    const withdrawn = submission("measurement-withdrawn@example.test", {
      marketingKey: metaLink.key,
    });
    await publicPost("events", event(withdrawn, withdrawn.touch)).expect(202);
    await publicPost("submit", { ...withdrawn, trackingConsent: false }).expect(
      201,
    );
    expect(
      (
        await publicPost(
          "events",
          event(withdrawn, withdrawn.touch, "started"),
        ).expect(202)
      ).body.collected,
    ).toBe(false);
    expect(
      await Attempt.countDocuments({
        tenantId: owner.tenantId,
        attemptId: withdrawn.attemptId,
      }),
    ).toBe(0);
    const report = (await send(owner, "get", "/marketing").expect(200)).body;
    expect(
      report.recentLeads.filter(
        (l: any) => l.evidence === "no_tracking_consent",
      ),
    ).toHaveLength(2);
    expect(
      report.recentLeads
        .filter((l: any) => l.evidence === "no_tracking_consent")
        .every((l: any) => l.source === "Other" && !l.campaignId),
    ).toBe(true);
  });

  it("rejects anonymous identity swaps and does not permit another tenant's link to supply a source", async () => {
    await publicPost(
      "events",
      event(
        { ...mainAttempt, anonymousId: randomUUID() },
        { marketingKey: metaLink.key },
      ),
    ).expect(409);
    const foreign = submission("foreign-source@example.test", {
      marketingKey: metaLink.key,
      source: "Meta Ads",
      accountId: "act_123",
    });
    await publicPost("submit", foreign, otherFormKey).expect(201);
    const foreignTouch = await Touch.findOne({
      tenantId: other.tenantId,
    }).lean();
    expect(foreignTouch).toMatchObject({
      source: "Other",
      tagStatus: "link_unavailable",
      eligible: false,
      accountId: "",
    });
    expect(foreignTouch?.marketingLinkId).toBeUndefined();
    await send(other, "patch", `/marketing/links/${metaLink.id}`, {
      active: false,
    }).expect(404);
    expect(
      (await send(other, "get", "/marketing").expect(200)).body.links,
    ).toHaveLength(0);
    await send(
      { ...other, tenantId: owner.tenantId },
      "get",
      "/marketing",
    ).expect(404);
  });

  it("pauses new link capture while preserving already observed attribution", async () => {
    const historical = submission("observed-before-pause@example.test", {
      marketingKey: metaLink.key,
    });
    await publicPost("events", event(historical, historical.touch)).expect(202);
    await send(owner, "patch", `/marketing/links/${metaLink.id}`, {
      active: false,
    }).expect(200);
    await publicPost("submit", historical).expect(201);
    await publicPost(
      "submit",
      submission("observed-after-pause@example.test", {
        marketingKey: metaLink.key,
        source: "Meta Ads",
      }),
    ).expect(201);
    expect(
      await Touch.countDocuments({
        tenantId: owner.tenantId,
        marketingLinkId: metaLink.id,
      }),
    ).toBe(2);
    const report = (await send(owner, "get", "/marketing").expect(200)).body;
    expect(
      report.recentLeads.filter((l: any) => l.evidence === "link_unavailable"),
    ).toHaveLength(1);
    expect(report.links.find((l: any) => l.id === metaLink.id)).toMatchObject({
      active: false,
      newLeads: 2,
    });
    await send(owner, "patch", `/marketing/links/${metaLink.id}`, {
      active: true,
    }).expect(200);
  });

  it("permits external form origins, denies unlisted origins and applies analyst masking and write boundaries", async () => {
    await request(app)
      .options(`/api/v1/public/forms/${formKey}/events`)
      .set("Origin", externalOrigin)
      .expect("Access-Control-Allow-Origin", externalOrigin)
      .expect(204);
    await request(app)
      .options(`/api/v1/public/forms/${formKey}/events`)
      .set("Origin", "https://untrusted.example.test")
      .expect(403);
    const external = submission("external-source@example.test", {
      source: "google",
      medium: "organic",
    });
    await publicPost("submit", external, formKey, externalOrigin).expect(201);
    const report = (await send(analyst, "get", "/marketing?days=7").expect(200))
      .body;
    expect(report.forms).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(
      "external-source@example.test",
    );
    expect(JSON.stringify(report)).not.toContain("Synthetic Marketing Student");
    expect(report.recentLeads.some((l: any) => l.source === "Organic")).toBe(
      true,
    );
    await send(analyst, "post", "/marketing/links", linkInput(formId)).expect(
      403,
    );
    await send(analyst, "patch", `/marketing/links/${metaLink.id}`, {
      active: false,
    }).expect(403);
    await send(counselor, "get", "/marketing").expect(403);
    await send(owner, "get", "/marketing?days=999").expect(422);
  });

  it("shows unfinished observed visits without fabricating a lead or a drop-off reason", async () => {
    const ids = { attemptId: randomUUID(), anonymousId: randomUUID() };
    const before = await Lead.countDocuments({ tenantId: owner.tenantId });
    await publicPost(
      "events",
      event(ids, { marketingKey: metaLink.key }),
    ).expect(202);
    await publicPost(
      "events",
      event(ids, { marketingKey: metaLink.key }, "started"),
    ).expect(202);
    const report = (await send(owner, "get", "/marketing").expect(200)).body;
    expect(
      report.sources.find((row: any) => row.source === "Meta Ads"),
    ).toMatchObject({
      visits: 3,
      starts: 2,
      submissions: 0,
      acceptedEnquiries: 2,
      unacceptedVisits: 1,
    });
    expect(
      report.links.find((row: any) => row.id === metaLink.id).unacceptedVisits,
    ).toBe(1);
    expect(await Lead.countDocuments({ tenantId: owner.tenantId })).toBe(
      before,
    );
  });

  it("deduplicates imported ad costs across connections and keeps currency, test and exact-ID joins distinct", async () => {
    const spend = {
      tenantId: owner.tenantId,
      accountId: "act_123",
      source: "Meta Ads",
      campaign: "Provider label",
      campaignId: "campaign_1",
      adId: "ad_1",
      date: new Date().toISOString().slice(0, 10),
      currency: "INR",
      amountMinor: "1000",
      clicks: 10,
      impressions: 100,
      evidence: "provider_verified",
    };
    await AdSpend.create({
      ...spend,
      connectionId: randomUUID(),
      updatedAt: new Date(Date.now() - 10000),
    });
    await AdSpend.create({
      ...spend,
      connectionId: randomUUID(),
      accountId: "123",
      amountMinor: "5000",
      clicks: 50,
    });
    await AdSpend.create({
      ...spend,
      connectionId: randomUUID(),
      currency: "USD",
      amountMinor: "2000",
    });
    await AdSpend.create({
      ...spend,
      connectionId: randomUUID(),
      evidence: "provider_test",
      amountMinor: "3000",
    });
    await AdSpend.create({
      ...spend,
      connectionId: randomUUID(),
      adId: "different_ad",
      amountMinor: "4000",
    });
    await AdSpend.create({
      ...spend,
      tenantId: other.tenantId,
      connectionId: randomUUID(),
      amountMinor: "999999",
    });
    const report = (await send(owner, "get", "/marketing").expect(200)).body;
    expect(report.advertising).toHaveLength(4);
    expect(
      report.advertising.find(
        (a: any) =>
          a.currency === "INR" &&
          a.evidence === "provider_verified" &&
          a.adId === "ad_1",
      ),
    ).toMatchObject({
      spendMinor: "5000",
      clicks: 50,
      impressions: 100,
      observedDays: 1,
      matchingSourceLeads: 2,
    });
    expect(
      report.advertising.find((a: any) => a.adId === "different_ad")
        .matchingSourceLeads,
    ).toBe(0);
    expect(
      report.advertising.find((a: any) => a.evidence === "provider_test")
        .spendMinor,
    ).toBe("3000");
    expect(JSON.stringify(report)).not.toContain("999999");
  });
});
