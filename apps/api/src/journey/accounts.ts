import { Router } from "express";
import type { ClientSession } from "mongoose";
import { z } from "zod";
import {
  User,
  Membership,
  Session,
  Lead,
  Event,
  Outbox,
  Receipt,
  Idempotency,
} from "../models.ts";
import {
  CallRecord,
  Mail,
  Token,
  Usage,
  Consent,
  Suppression,
  Touch,
  Attempt,
  Acceptance,
  Identity,
  Followup,
  Appointment,
  Command,
  PaymentOrder,
  Enrollment,
} from "./models.ts";
import { type Config } from "../config.ts";
import { AppError } from "../errors.ts";
import {
  randomToken,
  digest,
  seal,
  unseal,
  passwordHash,
  passwordMatches,
} from "../security.ts";
import { transaction } from "../db.ts";
import { audit, leadView } from "../services.ts";
import { requirePermission } from "../auth.ts";
import { rateLimit } from "../rate-limit.ts";
import { lockTenant } from "./entitlements.ts";
import { planLimits } from "../../../../packages/core/src/journey.ts";
import { roles } from "../../../../packages/core/src/contracts.ts";

export async function queueAccountLink(
  kind: "verify" | "reset" | "invite",
  userId: string,
  email: string,
  tenantId: string,
  config: Config,
  session: ClientSession,
  role?: string,
) {
  const token = randomToken();
  await Token.updateMany(
    { tenantId, userId, email, kind, usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } },
    { session },
  );
  await Token.create(
    [
      {
        tenantId,
        userId,
        email,
        kind,
        role,
        tokenHash: digest(token),
        expiresAt: new Date(
          Date.now() + (kind === "invite" ? 72 : 1) * 3600000,
        ),
      },
    ],
    { session },
  );
  const title =
    kind === "verify"
      ? "Verify your RevenuePilot email"
      : kind === "reset"
        ? "Reset your RevenuePilot password"
        : "Your RevenuePilot workspace invitation";
  const body = `${title}\n\nOpen ${config.WEB_ORIGIN}/account/${kind}#${token}\n\nThis link can be used once. If you did not request it, you can ignore this email.`;
  await Mail.create(
    [
      {
        tenantId,
        userId,
        recipient: email,
        subject: title,
        bodyCipher: seal(body, config.DATA_ENCRYPTION_KEY, tenantId),
      },
    ],
    { session },
  );
}
export function publicAccountRouter(config: Config) {
  const router = Router();
  router.post("/forgot-password", async (req, res) => {
    const { email } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase().trim()),
      })
      .strict()
      .parse(req.body);
    await rateLimit(`reset-ip:${req.ip}`, 10, 900000);
    await rateLimit(`reset-email:${digest(email)}`, 3, 3600000);
    const user = await User.findOne({ email }).lean();
    if (user) {
      const membership = await Membership.findOne({
        userId: user._id,
        status: "active",
      }).lean();
      if (membership)
        await transaction((session) =>
          queueAccountLink(
            "reset",
            user._id,
            email,
            membership.tenantId,
            config,
            session,
          ),
        );
    }
    res
      .status(202)
      .json({
        accepted: true,
        message:
          "If an account exists, a reset link will be sent when email delivery is configured.",
      });
  });
  router.post("/reset-password", async (req, res) => {
    await rateLimit(`reset-use:${req.ip}`, 10, 900000);
    const input = z
      .object({
        token: z.string().min(30).max(100),
        password: z.string().min(12).max(128),
      })
      .strict()
      .parse(req.body);
    const hash = await passwordHash(input.password);
    await transaction(async (session) => {
      const token = await Token.findOneAndUpdate(
        {
          tokenHash: digest(input.token),
          kind: "reset",
          expiresAt: { $gt: new Date() },
          usedAt: { $exists: false },
        },
        { $set: { usedAt: new Date() } },
        { session, returnDocument: "after" },
      ).lean();
      if (!token)
        throw new AppError(
          422,
          "TOKEN_EXPIRED",
          "This link has expired or was already used.",
        );
      await User.updateOne(
        { _id: token.userId, email: token.email },
        { $set: { passwordHash: hash } },
        { session },
      );
      await Session.deleteMany({ userId: token.userId }, { session });
      await Token.updateMany(
        { userId: token.userId, kind: "reset", usedAt: { $exists: false } },
        { $set: { usedAt: new Date() } },
        { session },
      );
      await audit(
        {
          userId: String(token.userId),
          tenantId: token.tenantId,
          sessionId: "reset",
          csrfToken: "",
          authenticatedAt: new Date(),
        },
        "account.password_reset",
        String(token.userId),
        req.requestId,
        session,
      );
    });
    res.json({
      updated: true,
      message:
        "Password updated. Sign in again; two-factor authentication remains enabled if previously configured.",
    });
  });
  router.post("/verify-email", async (req, res) => {
    await rateLimit(`verify-use:${req.ip}`, 10, 900000);
    const { token: value } = z
      .object({ token: z.string().min(30).max(100) })
      .strict()
      .parse(req.body);
    await transaction(async (session) => {
      const token = await Token.findOneAndUpdate(
        {
          tokenHash: digest(value),
          kind: "verify",
          expiresAt: { $gt: new Date() },
          usedAt: { $exists: false },
        },
        { $set: { usedAt: new Date() } },
        { session, returnDocument: "after" },
      ).lean();
      if (!token)
        throw new AppError(
          422,
          "TOKEN_EXPIRED",
          "This link has expired or was already used.",
        );
      await User.updateOne(
        { _id: token.userId, email: token.email },
        { $set: { emailVerifiedAt: new Date() } },
        { session },
      );
    });
    res.json({ verified: true });
  });
  return router;
}
export function sessionAccountRouter(config: Config) {
  const router = Router();
  router.post("/verify-email/request", async (req, res) => {
    await rateLimit(`verify-request:${req.auth!.userId}`, 3, 3600000);
    const user = await User.findById(req.auth!.userId).lean();
    const member = await Membership.findOne({
      userId: req.auth!.userId,
      status: "active",
    }).lean();
    if (user && member && !user.emailVerifiedAt)
      await transaction((session) =>
        queueAccountLink(
          "verify",
          user._id,
          user.email,
          member.tenantId,
          config,
          session,
        ),
      );
    res.status(202).json({ accepted: true });
  });
  router.get("/sessions", async (req, res) => {
    const sessions = await Session.find({
      userId: req.auth!.userId,
      expiresAt: { $gt: new Date() },
    })
      .select("_id authenticatedAt expiresAt")
      .lean();
    res.json({
      items: sessions.map((s) => ({
        id: s._id,
        authenticatedAt: s.authenticatedAt,
        expiresAt: s.expiresAt,
        current: s._id === req.auth!.sessionId,
      })),
    });
  });
  router.delete("/sessions/:id", async (req, res) => {
    await Session.deleteOne({
      _id: String(req.params.id),
      userId: req.auth!.userId,
    });
    res.sendStatus(204);
  });
  router.post("/invites/accept", async (req, res) => {
    const { token: value } = z
      .object({ token: z.string().min(30).max(100) })
      .strict()
      .parse(req.body);
    const user = await User.findById(req.auth!.userId).lean();
    await transaction(async (session) => {
      const token = await Token.findOne({
        tokenHash: digest(value),
        kind: "invite",
        email: user!.email,
        expiresAt: { $gt: new Date() },
        usedAt: { $exists: false },
      })
        .session(session)
        .lean();
      if (!token)
        throw new AppError(
          422,
          "INVITATION_UNAVAILABLE",
          "Sign in using the invited email address and a current invitation link.",
        );
      const tenant = await lockTenant(token.tenantId, session);
      const existing = await Membership.findOne({
        tenantId: tenant._id,
        userId: user!._id,
      })
        .session(session)
        .lean();
      if (existing?.status === "active")
        throw new AppError(
          409,
          "ALREADY_MEMBER",
          "You already belong to this workspace.",
        );
      if (
        (await Membership.countDocuments({
          tenantId: tenant._id,
          status: "active",
        }).session(session)) >=
        planLimits[tenant.plan as keyof typeof planLimits].seats
      )
        throw new AppError(
          429,
          "SEAT_LIMIT",
          "This workspace has no available seats.",
        );
      await Membership.updateOne(
        { tenantId: tenant._id, userId: user!._id },
        { $set: { role: token.role, status: "active" } },
        { upsert: true, session },
      );
      await Token.updateOne(
        { _id: token._id, tenantId: tenant._id },
        { $set: { usedAt: new Date() } },
        { session },
      );
      await User.updateOne(
        { _id: user!._id },
        { $set: { emailVerifiedAt: new Date() } },
        { session },
      );
      await audit(
        { ...req.auth!, tenantId: tenant._id },
        "member.invitation_accepted",
        user!._id,
        req.requestId,
        session,
      );
    });
    res.json({ accepted: true });
  });
  return router;
}
export function tenantAccountRouter(config: Config) {
  const router = Router({ mergeParams: true });
  router.get(
    "/account/usage",
    requirePermission("settings.write"),
    async (req, res) => {
      const tenant = await (
        await import("../models.ts")
      ).Tenant.findById(req.auth!.tenantId).lean();
      const [usage, seats, invites] = await Promise.all([
        Usage.find({
          tenantId: tenant!._id,
          period: new Date().toISOString().slice(0, 7),
        }).lean(),
        Membership.countDocuments({ tenantId: tenant!._id, status: "active" }),
        Token.countDocuments({
          tenantId: tenant!._id,
          kind: "invite",
          usedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        }),
      ]);
      res.json({
        plan: tenant!.plan,
        billingStatus: tenant!.billingStatus,
        limits: planLimits[tenant!.plan as keyof typeof planLimits],
        usage,
        seats,
        pendingInvites: invites,
        retentionDays: tenant!.retentionDays,
      });
    },
  );
  router.get(
    "/account/invites",
    requirePermission("members.read"),
    async (req, res) => {
      res.json({
        items: await Token.find({
          tenantId: req.auth!.tenantId,
          kind: "invite",
          usedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        })
          .select("_id email role expiresAt")
          .lean(),
      });
    },
  );
  router.post(
    "/account/invites",
    requirePermission("settings.write"),
    async (req, res) => {
      const input = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((s) => s.toLowerCase().trim()),
          role: z.enum(["admin", "analyst", "counselor", "finance", "viewer"]),
        })
        .strict()
        .parse(req.body);
      if (input.role === "admin" && req.auth!.role !== "owner")
        throw new AppError(
          403,
          "OWNER_REQUIRED",
          "Only an owner can invite administrators.",
        );
      await rateLimit(`invite:${req.auth!.tenantId}`, 30, 3600000);
      await transaction(async (session) => {
        const tenant = await lockTenant(req.auth!.tenantId!, session);
        const user = await User.findOne({ email: input.email })
          .session(session)
          .lean();
        if (
          user &&
          (await Membership.exists({
            tenantId: tenant._id,
            userId: user._id,
            status: "active",
          }).session(session))
        )
          throw new AppError(
            409,
            "ALREADY_MEMBER",
            "This person already belongs to the workspace.",
          );
        const existing = await Token.findOne({
          tenantId: tenant._id,
          kind: "invite",
          email: input.email,
          usedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        })
          .session(session)
          .lean();
        const active = await Membership.countDocuments({
          tenantId: tenant._id,
          status: "active",
        }).session(session);
        const pending = await Token.countDocuments({
          tenantId: tenant._id,
          kind: "invite",
          usedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        }).session(session);
        if (
          !existing &&
          active + pending >=
            planLimits[tenant.plan as keyof typeof planLimits].seats
        )
          throw new AppError(
            429,
            "SEAT_LIMIT",
            "The workspace seat allowance is reached.",
          );
        await Token.updateMany(
          {
            tenantId: tenant._id,
            kind: "invite",
            email: input.email,
            usedAt: { $exists: false },
          },
          { $set: { usedAt: new Date() } },
          { session },
        );
        await queueAccountLink(
          "invite",
          req.auth!.userId,
          input.email,
          tenant._id,
          config,
          session,
          input.role,
        );
        await audit(
          req.auth!,
          "member.invited",
          tenant._id,
          req.requestId,
          session,
        );
      });
      res.status(202).json({ accepted: true });
    },
  );
  router.delete(
    "/account/invites/:id",
    requirePermission("settings.write"),
    async (req, res) => {
      await transaction(async (session) => {
        await Token.updateOne(
          {
            tenantId: req.auth!.tenantId,
            _id: String(req.params.id),
            kind: "invite",
          },
          { $set: { usedAt: new Date() } },
          { session },
        );
        await audit(
          req.auth!,
          "member.invitation_revoked",
          String(req.params.id),
          req.requestId,
          session,
        );
      });
      res.sendStatus(204);
    },
  );
  router.patch(
    "/account/members/:id",
    requirePermission("settings.write"),
    async (req, res) => {
      const input = z
        .object({ role: z.enum(roles), status: z.enum(["active", "revoked"]) })
        .strict()
        .parse(req.body);
      await transaction(async (session) => {
        const tenant = await lockTenant(req.auth!.tenantId!, session);
        const member = await Membership.findOne({
          _id: String(req.params.id),
          tenantId: tenant._id,
        })
          .session(session)
          .lean();
        if (!member)
          throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
        if (
          req.auth!.role !== "owner" &&
          [member.role, input.role].some((r) => ["owner", "admin"].includes(r))
        )
          throw new AppError(
            403,
            "OWNER_REQUIRED",
            "Only an owner can manage administrators and owners.",
          );
        if (
          member.status === "active" &&
          member.role === "owner" &&
          (input.status !== "active" || input.role !== "owner") &&
          (await Membership.countDocuments({
            tenantId: tenant._id,
            status: "active",
            role: "owner",
          }).session(session)) <= 1
        )
          throw new AppError(
            409,
            "LAST_OWNER",
            "The workspace must retain an active owner.",
          );
        if (
          member.status !== "active" &&
          input.status === "active" &&
          (await Membership.countDocuments({
            tenantId: tenant._id,
            status: "active",
          }).session(session)) >=
            planLimits[tenant.plan as keyof typeof planLimits].seats
        )
          throw new AppError(
            429,
            "SEAT_LIMIT",
            "The workspace seat allowance is reached.",
          );
        await Membership.updateOne(
          { _id: member._id, tenantId: tenant._id },
          { $set: input },
          { session },
        );
        await audit(
          req.auth!,
          "member.access_changed",
          member._id,
          req.requestId,
          session,
        );
      });
      res.json({ updated: true });
    },
  );
  router.get(
    "/account/local-mail",
    requirePermission("settings.write"),
    async (req, res) => {
      if (config.NODE_ENV === "production")
        throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
      const rows = await Mail.find({
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
      })
        .select("+bodyCipher")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      res.json({
        localOnly: true,
        items: rows.map((m) => ({
          id: m._id,
          recipient: m.recipient,
          subject: m.subject,
          status: m.status,
          body: m.bodyCipher
            ? unseal<string>(
                String(m.bodyCipher),
                config.DATA_ENCRYPTION_KEY,
                m.tenantId,
              )
            : "Message content has been removed after delivery or retention.",
        })),
      });
    },
  );
  router.get(
    "/privacy/leads/:id/export",
    requirePermission("settings.write"),
    async (req, res) => {
      const scope = {
        tenantId: req.auth!.tenantId!,
        _id: String(req.params.id),
      };
      const lead = await Lead.findOne(scope).select("+contactCipher").lean();
      if (!lead) throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
      const related = { tenantId: scope.tenantId, leadId: lead._id };
      const [consent, activities, demos, receipts, enrollments] =
        await Promise.all([
          Consent.find(related).lean(),
          Event.find(related).limit(500).lean(),
          Appointment.find(related).lean(),
          Receipt.find(related).lean(),
          Enrollment.find(related).lean(),
        ]);
      await transaction((session) =>
        audit(
          req.auth!,
          "privacy.lead_exported",
          lead._id,
          req.requestId,
          session,
        ),
      );
      res.json({
        exportedAt: new Date().toISOString(),
        lead: leadView(lead, "owner", config.DATA_ENCRYPTION_KEY),
        consent,
        activities,
        demos,
        receipts,
        enrollments,
        activitiesLimit: 500,
      });
    },
  );
  router.post(
    "/privacy/leads/:id/erase",
    requirePermission("settings.write"),
    async (req, res) => {
      const { password } = z
        .object({ password: z.string().min(1).max(128) })
        .strict()
        .parse(req.body);
      await rateLimit(`erase:${req.auth!.userId}`, 6, 900000);
      const user = await User.findById(req.auth!.userId)
        .select("+passwordHash")
        .lean();
      if (!user || !(await passwordMatches(user.passwordHash, password)))
        throw new AppError(
          401,
          "INVALID_CREDENTIALS",
          "Confirm your current password.",
        );
      await transaction(async (session) => {
        const tenantId = req.auth!.tenantId!,
          leadId = String(req.params.id),
          scope = { tenantId, leadId };
        const lead = await Lead.findOne({ tenantId, _id: leadId })
          .session(session)
          .lean();
        if (!lead) throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
        if (
          await Command.exists({ ...scope, status: "running" }).session(session)
        )
          throw new AppError(
            409,
            "ACTION_IN_PROGRESS",
            "An action is in progress. Retry erasure after it finishes.",
          );
        await Lead.updateOne(
          { tenantId, _id: leadId },
          {
            $set: {
              name: "Erased contact",
              contactCipher: seal(
                { email: "", phone: "" },
                config.DATA_ENCRYPTION_KEY,
                tenantId,
              ),
              note: "",
              lossReason: "",
              campaign: "",
              erasedAt: new Date(),
            },
            $unset: { emailHash: 1, phoneHash: 1 },
          },
          { session },
        );
        await Suppression.updateOne(
          scope,
          { $set: { reason: "erasure_requested" } },
          { upsert: true, session },
        );
        await Consent.updateMany(
          scope,
          { $set: { granted: false } },
          { session },
        );
        await Touch.deleteMany(scope, { session });
        await CallRecord.updateMany(
          scope,
          { $unset: { summaryCipher: 1, transcriptCipher: 1 } },
          { session },
        );
        await Attempt.deleteMany(scope, { session });
        await Acceptance.deleteMany(scope, { session });
        await Identity.deleteMany(scope, { session });
        await Event.updateMany(
          scope,
          {
            $set: {
              detail: "",
              title: "Activity retained after contact erasure",
            },
          },
          { session },
        );
        await Outbox.updateMany(
          { tenantId, "payload.leadId": leadId },
          {
            $set: {
              "payload.detail": "",
              "payload.title": "Activity retained after contact erasure",
            },
          },
          { session },
        );
        await Appointment.updateMany(
          scope,
          { $set: { note: "" } },
          { session },
        );
        await Followup.updateMany(
          scope,
          { $set: { status: "cancelled", outcome: "erased" } },
          { session },
        );
        await Command.updateMany(
          scope,
          {
            $set: { status: "cancelled", errorCode: "CONTACT_ERASED" },
            $unset: { payloadCipher: 1, result: 1 },
          },
          { session },
        );
        await Receipt.updateMany(
          scope,
          { $set: { note: "Contact erased; financial record retained." } },
          { session },
        );
        await audit(
          req.auth!,
          "privacy.lead_erased",
          leadId,
          req.requestId,
          session,
        );
      });
      res.json({
        erased: true,
        retained:
          "Pseudonymized financial and audit evidence. External provider copies require a separate deletion request.",
      });
    },
  );
  return router;
}
