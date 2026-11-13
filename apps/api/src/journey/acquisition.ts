import { Router } from "express";
import type { ClientSession } from "mongoose";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  formEventInput,
  submissionInput,
} from "../../../../packages/core/src/journey.ts";
import { Lead, Tenant, Membership } from "../models.ts";
import {
  Form,
  Attempt,
  Acceptance,
  Identity,
  Touch,
  Consent,
  Followup,
} from "./models.ts";
import { type Config, allowedWebOrigins } from "../config.ts";
import { AppError } from "../errors.ts";
import { transaction } from "../db.ts";
import { digest, lookupHash } from "../security.ts";
import { createLead, timeline } from "../services.ts";
import { rateLimit } from "../rate-limit.ts";
import { channelFor } from "./evidence.ts";
import { resolveSource } from "./source-capture.ts";

export async function ingestLead(
  form: any,
  input: z.infer<typeof submissionInput>,
  config: Config,
  requestId: string,
  session: ClientSession,
) {
  const tenantId = String(form.tenantId);
  const attempt = await Attempt.findOne({
    tenantId,
    formId: form._id,
    attemptId: input.attemptId,
  })
    .session(session)
    .lean();
  if (attempt && attempt.anonymousId !== input.anonymousId)
    throw new AppError(
      409,
      "ATTEMPT_CONFLICT",
      "Refresh the enquiry form before trying again.",
    );
  const source = input.trackingConsent
    ? (attempt?.touch ?? (await resolveSource(form, input.touch, session)))
    : null;
  // Older observations may predate canonical source metadata.
  if (source && !source.tagStatus) {
    source.source = channelFor(
      source.source ?? "Direct",
      source.medium ?? "",
      source.clickIds ?? {},
    );
    source.tagStatus = "browser_tags";
  }
  const identityHash = lookupHash(
    input.email,
    config.DATA_ENCRYPTION_KEY,
    tenantId,
  );
  const identity = await Identity.findOne({
    tenantId,
    identityHash,
    course: form.course,
  })
    .session(session)
    .lean();
  let leadId = identity?.leadId as string | undefined;
  const tenant = await Tenant.findById(tenantId).session(session).lean();
  if (!tenant)
    throw new AppError(
      404,
      "FORM_NOT_FOUND",
      "This enquiry form is unavailable.",
    );
  if (!leadId) {
    const assignment = await Form.findOneAndUpdate(
      { _id: form._id, tenantId, active: true },
      { $inc: { sequence: 1 } },
      { session, returnDocument: "after" },
    ).lean();
    if (!assignment)
      throw new AppError(
        404,
        "FORM_NOT_FOUND",
        "This enquiry form is unavailable.",
      );
    const candidates = assignment.assignees?.length
      ? (assignment.assignees as string[])
      : [String(assignment.ownerId)];
    const members = await Membership.find({
      tenantId,
      userId: { $in: candidates },
      status: "active",
      role: { $in: ["owner", "admin", "counselor"] },
    })
      .session(session)
      .lean();
    const available = candidates.filter((id) =>
      members.some((m) => m.userId === id),
    );
    if (!available.length)
      throw new AppError(
        503,
        "ASSIGNMENT_UNAVAILABLE",
        "This form cannot accept enquiries right now.",
      );
    const ownerId =
      available[(Number(assignment.sequence) - 1) % available.length];
    const auth = {
      userId: ownerId,
      tenantId,
      role: "owner" as const,
      sessionId: "public",
      csrfToken: "",
      authenticatedAt: new Date(),
    };
    const result = await createLead(
      auth,
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        course: String(form.course),
        channel: source?.source ?? "Other",
        campaign: source?.campaign ?? "",
        note: "Enquiry accepted through a hosted form.",
      },
      requestId,
      config,
      session,
    );
    leadId = result.id;
    await Lead.updateOne(
      { _id: leadId, tenantId },
      { $set: { formId: form._id } },
      { session },
    );
    await Identity.create(
      [{ tenantId, identityHash, course: form.course, leadId }],
      { session },
    );
    await Followup.create(
      [
        {
          tenantId,
          leadId,
          assignedTo: ownerId,
          title: "First response to enquiry",
          dueAt: new Date(Date.now() + tenant.firstResponseMinutes * 60000),
          eventKey: `first:${leadId}`,
        },
      ],
      { session },
    );
  } else {
    const existing = await Lead.findOne({
      _id: leadId,
      tenantId,
      erasedAt: { $exists: false },
    })
      .session(session)
      .lean();
    if (!existing)
      throw new AppError(
        409,
        "IDENTITY_UNAVAILABLE",
        "Please contact this workspace to submit your enquiry.",
      );
    await timeline(
      tenantId,
      leadId,
      "enquiry.repeated.v1",
      "Returning enquiry",
      String(form.course),
      "public-form",
      session,
    );
  }
  const now = new Date();
  await Consent.create(
    [
      {
        tenantId,
        leadId,
        formId: form._id,
        version: input.consentVersion,
        purpose: "enquiry",
        granted: true,
        occurredAt: now,
      },
      {
        tenantId,
        leadId,
        formId: form._id,
        version: input.consentVersion,
        purpose: "marketing",
        granted: input.marketingConsent,
        occurredAt: now,
      },
      {
        tenantId,
        leadId,
        formId: form._id,
        version: input.consentVersion,
        purpose: "tracking",
        granted: input.trackingConsent,
        occurredAt: now,
      },
      {
        tenantId,
        leadId,
        formId: form._id,
        version: input.consentVersion,
        purpose: "ad_measurement",
        granted: input.trackingConsent && input.adConsent,
        occurredAt: now,
      },
    ],
    { session, ordered: true },
  );
  if (input.trackingConsent) {
    await Attempt.updateOne(
      { tenantId, formId: form._id, attemptId: input.attemptId },
      {
        $set: {
          anonymousId: input.anonymousId,
          acceptedAt: now,
          leadId,
          trackingConsent: true,
          marketingConsent: input.marketingConsent,
          touch: source,
          expiresAt: new Date(Date.now() + tenant.retentionDays * 86400000),
        },
        $setOnInsert: { submittedAt: now },
      },
      { upsert: true, session },
    );
    await Touch.create(
      [
        {
          tenantId,
          leadId,
          eventKey: `form:${form._id}:${input.attemptId}`,
          ...source,
          occurredAt: attempt?.createdAt ?? now,
          eligible: source?.tagStatus !== "link_unavailable",
        },
      ],
      { session },
    );
  } else if (attempt) {
    await Attempt.deleteOne({ tenantId, _id: attempt._id }, { session });
  }
  return leadId;
}

export function acquisitionRouter(config: Config) {
  const router = Router();
  router.use("/:publicKey", async (req, res, next) => {
    const publicKey = z.string().min(20).max(100).parse(req.params.publicKey);
    await rateLimit(`form-read:${req.ip}`, 120);
    const form = await Form.findOne({ publicKey, active: true }).lean();
    if (!form)
      throw new AppError(
        404,
        "FORM_NOT_FOUND",
        "This enquiry form is unavailable.",
      );
    const origin = req.get("Origin");
    const origins = new Set([
      ...(form.origins as string[]),
      ...allowedWebOrigins(config),
    ]);
    if (
      (origin && !origins.has(origin)) ||
      (!origin && !["GET", "HEAD"].includes(req.method))
    )
      throw new AppError(
        403,
        "ORIGIN_DENIED",
        "This form is not enabled for this website.",
      );
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.sendStatus(204);
      return;
    }
    res.locals.form = form;
    next();
  });
  router.get("/:publicKey", async (_req, res) => {
    const form = res.locals.form;
    const tenant = await Tenant.findById(form.tenantId).lean();
    res.json({
      name: form.name,
      course: form.course,
      workspaceName: tenant?.name,
      amountMinor: form.amountMinor,
      currency: form.currency,
      consentVersion: form.consentVersion,
      sandboxAvailable: config.NODE_ENV !== "production",
    });
  });
  router.post("/:publicKey/events", async (req, res) => {
    const input = formEventInput.parse(req.body),
      form = res.locals.form;
    await rateLimit(`form-event:${form._id}:${req.ip}`, 60);
    const touch = await resolveSource(form, input.touch);
    const tenant = await Tenant.findById(form.tenantId)
      .select("retentionDays")
      .lean();
    const existing = await Attempt.findOne({
      tenantId: form.tenantId,
      formId: form._id,
      attemptId: input.attemptId,
    }).lean();
    if (existing && existing.anonymousId !== input.anonymousId)
      throw new AppError(
        409,
        "ATTEMPT_CONFLICT",
        "Refresh the enquiry form before trying again.",
      );
    if (
      !existing &&
      (await Acceptance.exists({
        tenantId: form.tenantId,
        formId: form._id,
        attemptId: input.attemptId,
      }))
    ) {
      // A late telemetry request must not recreate an attempt removed at submit
      // when measurement consent was withheld.
      res.status(202).json({ accepted: true, collected: false });
      return;
    }
    const field = {
      viewed: "viewedAt",
      started: "startedAt",
      submitted: "submittedAt",
    }[input.type];
    // Server time is authoritative; retries preserve the earliest observation.
    const scope = {
      tenantId: form.tenantId,
      formId: form._id,
      attemptId: input.attemptId,
      anonymousId: input.anonymousId,
    };
    const update = {
      $min: { [field]: new Date() },
      $setOnInsert: {
        anonymousId: input.anonymousId,
        path: input.path,
        touch,
        trackingConsent: true,
        expiresAt: new Date(
          Date.now() + (tenant?.retentionDays ?? 90) * 86400000,
        ),
      },
    };
    try {
      await Attempt.updateOne(scope, update, { upsert: true });
    } catch (error: any) {
      if (error.code !== 11000) throw error;
      // Concurrent views/starts share one attempt; only its first source wins.
      const retried = await Attempt.updateOne(scope, {
        $min: { [field]: new Date() },
      });
      if (!retried.matchedCount)
        throw new AppError(
          409,
          "ATTEMPT_CONFLICT",
          "Refresh the enquiry form before trying again.",
        );
    }
    res.status(202).json({ accepted: true });
  });
  router.post("/:publicKey/submit", async (req, res) => {
    const input = submissionInput.parse(req.body),
      form = res.locals.form;
    await rateLimit(`form-submit:${form._id}:${req.ip}`, 20, 900000);
    if (input.consentVersion !== form.consentVersion)
      throw new AppError(
        409,
        "CONSENT_CHANGED",
        "Refresh the form and review the current consent text.",
      );
    const scope = {
      tenantId: form.tenantId,
      formId: form._id,
      attemptId: input.attemptId,
    };
    const requestHash = digest(JSON.stringify(input));
    const acceptanceToken = createHmac(
      "sha256",
      Buffer.from(config.DATA_ENCRYPTION_KEY, "hex"),
    )
      .update(
        `accept:${form.tenantId}:${form._id}:${input.attemptId}:${requestHash}`,
      )
      .digest("base64url");
    const replay = async () => {
      const previous = await Acceptance.findOne(scope).lean();
      if (previous && previous.requestHash !== requestHash)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This submission was already received with different details.",
        );
      return !!previous;
    };
    if (!(await replay())) {
      try {
        await transaction(async (session) => {
          const leadId = await ingestLead(
            form,
            input,
            config,
            req.requestId,
            session,
          );
          await Acceptance.create(
            [
              {
                ...scope,
                leadId,
                requestHash,
                tokenHash: digest(acceptanceToken),
                expiresAt: new Date(Date.now() + 86400000),
              },
            ],
            { session },
          );
        });
      } catch (error: any) {
        if (error.code !== 11000 || !(await replay())) {
          // A simultaneous different attempt for the same identity may win. Retry
          // the whole transaction against that committed identity once.
          if (error.code !== 11000) throw error;
          await transaction(async (session) => {
            const leadId = await ingestLead(
              form,
              input,
              config,
              req.requestId,
              session,
            );
            await Acceptance.create(
              [
                {
                  ...scope,
                  leadId,
                  requestHash,
                  tokenHash: digest(acceptanceToken),
                  expiresAt: new Date(Date.now() + 86400000),
                },
              ],
              { session },
            );
          });
        }
      }
    }
    res
      .status(201)
      .json({ accepted: true, acceptanceToken, expiresInSeconds: 86400 });
  });
  return router;
}
