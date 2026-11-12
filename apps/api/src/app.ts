import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import cors from "cors";
import mongoose from "mongoose";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  registrationInput,
  loginInput,
  leadInput,
  stageInput,
  receiptInput,
  settingsInput,
  connectionInput,
  siteInput,
  can,
  stageLabels,
} from "../../../packages/core/src/contracts.ts";
import { providers } from "../../../packages/connectors/src/index.ts";
import type { Config } from "./config.ts";
import {
  User,
  Tenant,
  Membership,
  Session,
  Lead,
  Receipt,
  Event,
  Connection,
  Audit,
  Site,
  Outbox,
} from "./models.ts";
import {
  requireSession,
  requireTenant,
  requirePermission,
  issueSession,
  cookieName,
  sessionView,
  leadScope,
} from "./auth.ts";
import {
  passwordHash,
  passwordMatches,
  seal,
  unseal,
  randomToken,
  base32,
  totpStep,
} from "./security.ts";
import { AppError } from "./errors.ts";
import { transaction } from "./db.ts";
import {
  audit,
  timeline,
  leadView,
  idempotent,
  createLead,
  createReceipt,
  overview,
} from "./services.ts";
import { rateLimit } from "./rate-limit.ts";
import { collectorRouter } from "./collector.ts";

export function errorHandler(
  error: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status =
    error instanceof AppError
      ? error.status
      : error instanceof z.ZodError
        ? 422
        : error.code === 11000
          ? 409
          : error.type === "entity.too.large"
            ? 413
            : error.type === "entity.parse.failed"
              ? 400
              : 500;
  const code =
    error instanceof AppError
      ? error.code
      : status === 422
        ? "VALIDATION_FAILED"
        : status === 409
          ? "DUPLICATE_RECORD"
          : status === 413
            ? "PAYLOAD_TOO_LARGE"
            : status === 400
              ? "INVALID_JSON"
              : "INTERNAL_ERROR";
  if (status >= 500)
    console.error(
      JSON.stringify({
        level: "error",
        requestId: req.requestId,
        code,
        errorType: error.name,
      }),
    );
  if (status === 429) res.set("Retry-After", "60");
  res
    .status(status)
    .type("application/problem+json")
    .json({
      type: `urn:revenuepilot:error:${code.toLowerCase()}`,
      status,
      code,
      title:
        error instanceof AppError
          ? error.message
          : status === 422
            ? "Check the highlighted fields."
            : status === 409
              ? "This record already exists."
              : status === 500
                ? "The request could not be completed."
                : "Invalid request.",
      requestId: req.requestId,
      ...(error instanceof z.ZodError
        ? {
            errors: error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          }
        : {}),
    });
}
export function createApp(config: Config) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set("X-Request-Id", req.requestId);
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(helmet());
  app.get("/health/live", (_req, res) => res.json({ status: "alive" }));
  app.get("/health/ready", async (_req, res) => {
    try {
      await mongoose.connection.db?.admin().ping();
      if (mongoose.connection.readyState !== 1) throw new Error();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "not_ready" });
    }
  });
  app.use(express.json({ limit: "256kb" }));
  app.use("/api/v1/collect", collectorRouter());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(cookieParser());
  app.use("/api", (req, _res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("Origin") !== config.WEB_ORIGIN
    )
      throw new AppError(
        403,
        "ORIGIN_DENIED",
        "This request origin is not allowed.",
      );
    next();
  });
  app.get("/api/v1/public/config", (_req, res) =>
    res.json({
      demo: config.REVENUEPILOT_DEMO === "true",
      registration: config.ALLOW_REGISTRATION === "true",
    }),
  );
  app.post("/api/v1/auth/register", async (req, res) => {
    if (config.ALLOW_REGISTRATION !== "true")
      throw new AppError(
        403,
        "REGISTRATION_DISABLED",
        "Registration is currently disabled.",
      );
    await rateLimit(`register:${req.ip}`, 5, 900000);
    const input = registrationInput.parse(req.body),
      hash = await passwordHash(input.password);
    const userId = randomUUID(),
      tenantId = randomUUID();
    await transaction(async (session) => {
      await User.create(
        [
          {
            _id: userId,
            name: input.name,
            email: input.email,
            passwordHash: hash,
          },
        ],
        { session },
      );
      await Tenant.create([{ _id: tenantId, name: input.workspaceName }], {
        session,
      });
      await Membership.create([{ tenantId, userId, role: "owner" }], {
        session,
      });
      await Audit.create(
        [
          {
            tenantId,
            actorId: userId,
            action: "workspace.created",
            targetId: tenantId,
            requestId: req.requestId,
          },
        ],
        { session },
      );
    });
    res
      .status(201)
      .json(await sessionView(await issueSession(userId, res, config)));
  });
  app.post("/api/v1/auth/login", async (req, res) => {
    await rateLimit(`login-ip:${req.ip}`, 30, 900000);
    const input = loginInput.parse(req.body);
    await rateLimit(`login-email:${input.email}`, 12, 900000);
    const user = await User.findOne({ email: input.email })
      .select("+passwordHash +mfaSecret")
      .lean();
    const valid = user
      ? await passwordMatches(user.passwordHash, input.password)
      : (await passwordHash(input.password), false);
    if (!user || !valid)
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    if (user.mfaEnabled) {
      if (!input.code)
        throw new AppError(
          401,
          "MFA_REQUIRED",
          "Enter the six-digit code from your authenticator.",
        );
      const step = totpStep(
        unseal<string>(user.mfaSecret!, config.DATA_ENCRYPTION_KEY, user._id),
        input.code,
      );
      if (step === undefined || step <= user.lastMfaStep)
        throw new AppError(
          401,
          "MFA_INVALID",
          "The authenticator code is invalid or already used.",
        );
      const result = await User.updateOne(
        { _id: user._id, lastMfaStep: { $lt: step } },
        { $set: { lastMfaStep: step } },
      );
      if (!result.modifiedCount)
        throw new AppError(
          401,
          "MFA_REPLAYED",
          "Use a new authenticator code.",
        );
    }
    res.json(await sessionView(await issueSession(user._id, res, config)));
  });
  if (config.REVENUEPILOT_DEMO === "true" && config.NODE_ENV !== "production")
    app.post("/api/v1/auth/demo", async (req, res) => {
      await rateLimit(`demo:${req.ip}`, 30);
      const user = await User.findOne({
        email: "demo@revenuepilot.test",
      }).lean();
      if (!user)
        throw new AppError(
          503,
          "DEMO_NOT_READY",
          "Demo data has not been seeded.",
        );
      res.json(await sessionView(await issueSession(user._id, res, config)));
    });
  app.use("/api/v1", requireSession(config));
  app.get("/api/v1/auth/session", async (req, res) =>
    res.json(await sessionView(req.auth!)),
  );
  app.post("/api/v1/auth/logout", async (req, res) => {
    await Session.deleteOne({
      _id: req.auth!.sessionId,
      userId: req.auth!.userId,
    });
    res.clearCookie(cookieName(config), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
    });
    res.sendStatus(204);
  });
  app.post("/api/v1/auth/mfa/setup", async (req, res) => {
    await rateLimit(`mfa:${req.auth!.userId}`, 6, 900000);
    const { password } = z
      .object({ password: z.string().max(128) })
      .strict()
      .parse(req.body);
    const user = await User.findById(req.auth!.userId)
      .select("+passwordHash")
      .lean();
    if (!user || !(await passwordMatches(user.passwordHash, password)))
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Your current password is incorrect.",
      );
    if (user.mfaEnabled)
      throw new AppError(
        409,
        "MFA_ALREADY_ENABLED",
        "Two-factor authentication is already enabled.",
      );
    const secret = base32(randomBytes(20));
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          pendingMfaSecret: seal(secret, config.DATA_ENCRYPTION_KEY, user._id),
        },
      },
    );
    res.json({
      secret,
      uri: `otpauth://totp/RevenuePilot:${encodeURIComponent(user.email)}?secret=${secret}&issuer=RevenuePilot&digits=6&period=30`,
    });
  });
  app.post("/api/v1/auth/mfa/confirm", async (req, res) => {
    await rateLimit(`mfa-confirm:${req.auth!.userId}`, 6, 900000);
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(req.body);
    const user = await User.findById(req.auth!.userId)
      .select("+pendingMfaSecret")
      .lean();
    if (!user?.pendingMfaSecret)
      throw new AppError(
        409,
        "MFA_NOT_STARTED",
        "Start authenticator setup first.",
      );
    const step = totpStep(
      unseal<string>(
        user.pendingMfaSecret,
        config.DATA_ENCRYPTION_KEY,
        user._id,
      ),
      code,
    );
    if (step === undefined)
      throw new AppError(
        422,
        "MFA_INVALID",
        "The authenticator code is incorrect.",
      );
    await User.updateOne(
      { _id: user._id, pendingMfaSecret: user.pendingMfaSecret },
      {
        $set: {
          mfaSecret: user.pendingMfaSecret,
          mfaEnabled: true,
          lastMfaStep: step,
        },
        $unset: { pendingMfaSecret: 1 },
      },
    );
    await Session.deleteMany({
      userId: user._id,
      _id: { $ne: req.auth!.sessionId },
    });
    res.json({ enabled: true });
  });
  app.post("/api/v1/tenants", async (req, res) => {
    const { name } = z
      .object({ name: z.string().trim().min(2).max(100) })
      .strict()
      .parse(req.body);
    await rateLimit(`tenant-create:${req.auth!.userId}`, 5, 3600000);
    const id = randomUUID();
    await transaction(async (session) => {
      await Tenant.create([{ _id: id, name }], { session });
      await Membership.create(
        [{ tenantId: id, userId: req.auth!.userId, role: "owner" }],
        { session },
      );
      await audit(
        { ...req.auth!, tenantId: id },
        "workspace.created",
        id,
        req.requestId,
        session,
      );
    });
    res.status(201).json(await sessionView(req.auth!));
  });
  const router = express.Router({ mergeParams: true });
  router.use(requireTenant);
  router.use(async (req, _res, next) => {
    await rateLimit(`api:${req.auth!.tenantId}:${req.auth!.userId}`, 180);
    next();
  });
  router.get("/overview", requirePermission("leads.read"), async (req, res) => {
    const days = z.coerce
      .number()
      .refine((n) => [7, 30, 90].includes(n))
      .parse(req.query.days ?? 30);
    res.json(await overview(req.auth!, days));
  });
  router.get("/leads", requirePermission("leads.read"), async (req, res) => {
    const query = z
      .object({
        q: z.string().max(100).optional(),
        stage: z
          .enum(["all", ...(Object.keys(stageLabels) as ["new"])])
          .optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .strict()
      .parse(req.query);
    const filter: Record<string, unknown> = { ...leadScope(req.auth!) };
    if (query.stage && query.stage !== "all") filter.stage = query.stage;
    if (query.q)
      filter.$or = (
        can(req.auth!.role!, "pii.read")
          ? ["name", "course", "campaign"]
          : ["course", "campaign"]
      ).map((field) => ({
        [field]: {
          $regex: query.q!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        },
      }));
    const [items, total] = await Promise.all([
      Lead.find(filter)
        .select("+contactCipher")
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Lead.countDocuments(filter),
    ]);
    res.json({
      items: items.map((l) =>
        leadView(l, req.auth!.role!, config.DATA_ENCRYPTION_KEY),
      ),
      total,
      page: query.page,
      limit: query.limit,
    });
  });
  router.post("/leads", requirePermission("leads.write"), async (req, res) => {
    const input = leadInput.parse(req.body);
    const lead = await idempotent(
      req.auth!,
      "POST/leads",
      req.get("Idempotency-Key") ?? "",
      input,
      (session) => createLead(req.auth!, input, req.requestId, config, session),
    );
    res.status(201).json(lead);
  });
  router.get(
    "/leads/:leadId",
    requirePermission("leads.read"),
    async (req, res) => {
      const lead = await Lead.findOne({
        ...leadScope(req.auth!),
        _id: String(req.params.leadId),
      })
        .select("+contactCipher")
        .lean();
      if (!lead) throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
      const events = await Event.find({
        tenantId: req.auth!.tenantId,
        leadId: lead._id,
      })
        .sort({ occurredAt: -1 })
        .limit(100)
        .lean();
      res.json({
        lead: leadView(lead, req.auth!.role!, config.DATA_ENCRYPTION_KEY),
        events: events.map((e) => ({
          id: e._id,
          type: e.type,
          title: e.title,
          detail: can(req.auth!.role!, "pii.read") ? e.detail : "",
          occurredAt: e.occurredAt,
        })),
      });
    },
  );
  router.patch(
    "/leads/:leadId/stage",
    requirePermission("leads.write"),
    async (req, res) => {
      const input = stageInput.parse(req.body),
        id = String(req.params.leadId);
      await transaction(async (session) => {
        const before = await Lead.findOne({ ...leadScope(req.auth!), _id: id })
          .session(session)
          .lean();
        if (!before)
          throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
        if (before.version !== input.version)
          throw new AppError(
            409,
            "VERSION_CONFLICT",
            "This lead changed. Refresh before updating its stage.",
          );
        if (before.stage === input.stage)
          throw new AppError(
            422,
            "STAGE_UNCHANGED",
            "Select a different stage.",
          );
        const result = await Lead.updateOne(
          { ...leadScope(req.auth!), _id: id, version: input.version },
          { $set: { stage: input.stage }, $inc: { version: 1 } },
          { session },
        );
        if (!result.modifiedCount)
          throw new AppError(
            409,
            "VERSION_CONFLICT",
            "This lead changed. Refresh before updating.",
          );
        await timeline(
          req.auth!.tenantId!,
          id,
          "lead.stage_changed.v1",
          `${stageLabels[before.stage]} → ${stageLabels[input.stage]}`,
          input.note,
          req.auth!.userId,
          session,
        );
        await audit(
          req.auth!,
          "lead.stage_changed",
          id,
          req.requestId,
          session,
        );
      });
      res.json({ updated: true });
    },
  );
  router.post(
    "/leads/:leadId/contact",
    requirePermission("leads.write"),
    async (req, res) => {
      const { note } = z
          .object({ note: z.string().trim().min(3).max(1000) })
          .strict()
          .parse(req.body),
        id = String(req.params.leadId);
      await idempotent(
        req.auth!,
        `POST/leads/${id}/contact`,
        req.get("Idempotency-Key") ?? "",
        { note },
        async (session) => {
          const lead = await Lead.findOneAndUpdate(
            { ...leadScope(req.auth!), _id: id },
            { $set: { lastContactAt: new Date() }, $inc: { version: 1 } },
            { session, returnDocument: "after" },
          ).lean();
          if (!lead)
            throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
          await timeline(
            req.auth!.tenantId!,
            id,
            "contact.recorded.v1",
            "Contact attempt recorded",
            note,
            req.auth!.userId,
            session,
          );
          await audit(
            req.auth!,
            "lead.contact_recorded",
            id,
            req.requestId,
            session,
          );
          return { updated: true };
        },
      );
      res.json({ updated: true });
    },
  );
  router.get(
    "/revenue",
    requirePermission("revenue.read"),
    async (req, res) => {
      const { page, limit, leadId, kind } = z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          leadId: z.string().max(100).optional(),
          kind: z.enum(["capture", "refund"]).optional(),
        })
        .strict()
        .parse(req.query);
      const filter = {
          tenantId: req.auth!.tenantId,
          ...(leadId ? { leadId } : {}),
          ...(kind ? { kind } : {}),
        },
        [items, total] = await Promise.all([
          Receipt.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
          Receipt.countDocuments(filter),
        ]);
      const leads = await Lead.find({
        tenantId: req.auth!.tenantId,
        _id: { $in: items.map((r) => r.leadId) },
      }).lean();
      res.json({
        items: items.map((r) => {
          const lead = leads.find((l) => l._id === r.leadId);
          return {
            id: r._id,
            leadId: r.leadId,
            leadName: can(req.auth!.role!, "pii.read")
              ? (lead?.name ?? "Unknown lead")
              : `${lead?.name.charAt(0) ?? ""}•••`,
            course: lead?.course ?? "",
            kind: r.kind,
            amountMinor: r.amountMinor,
            currency: r.currency,
            reference: r.reference,
            createdAt: r.createdAt,
            channel: r.channel,
            originalReceiptId: r.originalReceiptId,
            evidence: r.evidence,
          };
        }),
        total,
        page,
        limit,
      });
    },
  );
  router.post(
    "/revenue",
    requirePermission("revenue.write"),
    async (req, res) => {
      const input = receiptInput.parse(req.body);
      res
        .status(201)
        .json(
          await idempotent(
            req.auth!,
            "POST/revenue",
            req.get("Idempotency-Key") ?? "",
            input,
            (session) =>
              createReceipt(req.auth!, input, req.requestId, session),
          ),
        );
    },
  );
  router.get("/connections", async (req, res) => {
    const items = await Connection.find({ tenantId: req.auth!.tenantId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      providers,
      items: items.map((c) => ({
        id: c._id,
        provider: c.provider,
        label: c.label,
        accountId: c.accountId,
        configuredFields: c.credentialKeys,
        status: c.status,
        updatedAt: c.updatedAt,
      })),
    });
  });
  router.post(
    "/connections",
    requirePermission("connections.write"),
    async (req, res) => {
      const input = connectionInput.parse(req.body),
        provider = providers.find((p) => p.id === input.provider);
      if (
        !provider ||
        Object.keys(input.credentials).some(
          (k) => !provider.credentialFields.some((f) => f.key === k),
        )
      )
        throw new AppError(
          422,
          "INVALID_PROVIDER_CONFIG",
          "Choose a supported provider and credential fields.",
        );
      const id = randomUUID();
      await transaction(async (session) => {
        await Connection.create(
          [
            {
              _id: id,
              tenantId: req.auth!.tenantId,
              provider: input.provider,
              label: input.label,
              accountId: input.accountId,
              credentialCipher: Object.keys(input.credentials).length
                ? seal(
                    input.credentials,
                    config.DATA_ENCRYPTION_KEY,
                    req.auth!.tenantId!,
                  )
                : undefined,
              credentialKeys: Object.keys(input.credentials),
            },
          ],
          { session },
        );
        await audit(
          req.auth!,
          "connection.draft_created",
          id,
          req.requestId,
          session,
        );
      });
      res.status(201).json({ id, status: "draft", activated: false });
    },
  );
  router.delete(
    "/connections/:connectionId",
    requirePermission("connections.write"),
    async (req, res) => {
      const id = String(req.params.connectionId);
      await transaction(async (session) => {
        const result = await Connection.deleteOne(
          { tenantId: req.auth!.tenantId, _id: id },
          { session },
        );
        if (!result.deletedCount)
          throw new AppError(
            404,
            "CONNECTION_NOT_FOUND",
            "Connection not found.",
          );
        await audit(
          req.auth!,
          "connection.deleted",
          id,
          req.requestId,
          session,
        );
      });
      res.sendStatus(204);
    },
  );
  router.post(
    "/connections/:connectionId/sync",
    requirePermission("connections.write"),
    async (req, _res) => {
      if (
        !(await Connection.exists({
          tenantId: req.auth!.tenantId,
          _id: String(req.params.connectionId),
        }))
      )
        throw new AppError(
          404,
          "CONNECTION_NOT_FOUND",
          "Connection not found.",
        );
      throw new AppError(
        422,
        "ADAPTER_NOT_IMPLEMENTED",
        "This provider is configuration-only. No external request was made.",
      );
    },
  );
  router.get("/sites", requirePermission("settings.write"), async (req, res) =>
    res.json({
      items: await Site.find({ tenantId: req.auth!.tenantId }).lean(),
    }),
  );
  router.post(
    "/sites",
    requirePermission("settings.write"),
    async (req, res) => {
      const input = siteInput.parse(req.body),
        id = randomUUID(),
        publicKey = `pk_${randomToken()}`;
      await transaction(async (session) => {
        await Site.create(
          [{ _id: id, tenantId: req.auth!.tenantId, ...input, publicKey }],
          { session },
        );
        await audit(req.auth!, "site.created", id, req.requestId, session);
      });
      res.status(201).json({ id, publicKey, ...input });
    },
  );
  router.put(
    "/settings",
    requirePermission("settings.write"),
    async (req, res) => {
      const input = settingsInput.parse(req.body);
      await transaction(async (session) => {
        await Tenant.updateOne(
          { _id: req.auth!.tenantId },
          { $set: input },
          { session },
        );
        await audit(
          req.auth!,
          "workspace.settings_changed",
          req.auth!.tenantId!,
          req.requestId,
          session,
        );
      });
      res.json(await sessionView(req.auth!));
    },
  );
  router.get(
    "/members",
    requirePermission("members.read"),
    async (req, res) => {
      const members = await Membership.find({
        tenantId: req.auth!.tenantId,
        status: "active",
      }).lean();
      const users = await User.find({
        _id: { $in: members.map((m) => m.userId) },
      }).lean();
      res.json({
        items: members.map((m) => ({
          id: m._id,
          role: m.role,
          name: users.find((u) => u._id === m.userId)?.name,
          email: users.find((u) => u._id === m.userId)?.email,
        })),
      });
    },
  );
  router.get("/audit", requirePermission("audit.read"), async (req, res) =>
    res.json({
      items: await Audit.find({ tenantId: req.auth!.tenantId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      pendingEvents: await Outbox.countDocuments({
        tenantId: req.auth!.tenantId,
        processedAt: { $exists: false },
      }),
    }),
  );
  app.use("/api/v1/tenants/:tenantId", router);
  app.use((_req, res) =>
    res.status(404).json({ code: "NOT_FOUND", title: "Endpoint not found." }),
  );
  app.use(errorHandler);
  return app;
}
