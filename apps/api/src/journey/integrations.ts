import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { AuthContext } from "../auth.ts";
import { requirePermission } from "../auth.ts";
import {
  Connection,
  User,
  Lead,
  Membership,
  Tenant,
  Receipt,
} from "../models.ts";
import {
  AdSpend,
  Form,
  Identity,
  IntegrationLink,
  Followup,
  Consent,
  Suppression,
  Command,
  Milestone,
  Touch,
  Usage,
  SyncRun,
  Webhook,
} from "./models.ts";
import { seal, unseal, digest, lookupHash } from "../security.ts";
import { AppError } from "../errors.ts";
import { transaction } from "../db.ts";
import { audit, createLead, idempotent, timeline } from "../services.ts";
import { reserveUsage } from "./entitlements.ts";
import {
  validateConnection,
  requiredCredentials,
} from "../../../../packages/connectors/src/settings.ts";
import {
  providerJson,
  ProviderError,
} from "../../../../packages/connectors/src/http.ts";
import {
  pullSpend,
  pullContacts,
  googleToken,
  submitConversion,
  type ProviderContext,
} from "../../../../packages/connectors/src/adapters/marketing.ts";
import {
  analyzeText,
  checkSes,
  sendMessage,
  startCall,
} from "../../../../packages/connectors/src/adapters/actions.ts";
import {
  stripeClient,
  assertPaymentMode,
} from "../../../../packages/connectors/src/adapters/payments.ts";
import { leadInput } from "../../../../packages/core/src/contracts.ts";
import { channelFor } from "./evidence.ts";
import { adapterFor } from "../../../../packages/connectors/src/runtime.ts";

export async function connectorContext(
  connectionId: string,
  tenantId: string,
  config: Config,
  active = true,
) {
  const connection = await Connection.findOne({
    _id: connectionId,
    tenantId,
    ...(active ? { status: { $in: ["test", "active"] } } : {}),
  })
    .select("+credentialCipher")
    .lean();
  if (!connection?.credentialCipher)
    throw new AppError(
      422,
      "CONNECTION_NOT_READY",
      "Configure and activate this connection first.",
    );
  const credentials = unseal<Record<string, string>>(
    connection.credentialCipher,
    config.DATA_ENCRYPTION_KEY,
    tenantId,
  );
  let settings: any;
  try {
    settings = validateConnection(
      connection.provider,
      connection.config,
      credentials,
    );
  } catch {
    throw new AppError(
      422,
      "INVALID_PROVIDER_CONFIG",
      "Check the provider settings and required credentials.",
    );
  }
  if (
    active &&
    connection.mode === "live" &&
    config.ALLOW_LIVE_PROVIDERS !== "true"
  )
    throw new AppError(
      403,
      "LIVE_EXECUTION_DISABLED",
      "Live provider execution is disabled for this installation.",
    );
  return {
    connection,
    context: {
      provider: connection.provider,
      mode: connection.mode,
      settings,
      credentials,
    } as ProviderContext,
  };
}
async function privilegedLive(auth: AuthContext, config: Config) {
  const user = await User.findById(auth.userId).lean();
  if (!user?.emailVerifiedAt || !user.mfaEnabled)
    throw new AppError(
      403,
      "VERIFIED_MFA_REQUIRED",
      "Verify your email and enable two-factor authentication before enabling live execution.",
    );
  if (Date.now() - +auth.authenticatedAt > 15 * 60000)
    throw new AppError(
      403,
      "RECENT_LOGIN_REQUIRED",
      "Sign in again before enabling live execution.",
    );
  if (config.ALLOW_LIVE_PROVIDERS !== "true")
    throw new AppError(
      403,
      "LIVE_EXECUTION_DISABLED",
      "The installation operator must enable live provider execution first.",
    );
}
async function health(context: ProviderContext) {
  const c = context,
    settings = c.settings;
  if (c.provider === "stripe") {
    assertPaymentMode(c.provider, c.credentials, c.mode);
    await stripeClient(c.credentials).balance.retrieve();
  } else if (c.provider === "razorpay") {
    assertPaymentMode(c.provider, c.credentials, c.mode);
    await providerJson("https://api.razorpay.com/v1/payments?count=1", {
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.credentials.keyId}:${c.credentials.keySecret}`).toString("base64")}`,
      },
    });
  } else if (c.provider === "meta")
    await providerJson(
      `https://graph.facebook.com/${settings.apiVersion}/${settings.adAccountId}?fields=id,name`,
      { headers: { Authorization: `Bearer ${c.credentials.accessToken}` } },
    );
  else if (c.provider === "google_ads") {
    const token = await googleToken(c);
    await providerJson(
      `https://googleads.googleapis.com/${settings.apiVersion}/customers/${settings.customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "developer-token": c.credentials.developerToken,
          ...(settings.loginCustomerId
            ? { "login-customer-id": settings.loginCustomerId }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "SELECT customer.id FROM customer LIMIT 1",
        }),
      },
    );
  } else if (c.provider === "hubspot")
    await providerJson(
      "https://api.hubapi.com/crm/objects/2026-03/contacts?limit=1",
      { headers: { Authorization: `Bearer ${c.credentials.accessToken}` } },
    );
  else if (c.provider === "whatsapp")
    await providerJson(
      `https://graph.facebook.com/${settings.apiVersion}/${settings.phoneNumberId}?fields=id,display_phone_number`,
      { headers: { Authorization: `Bearer ${c.credentials.accessToken}` } },
    );
  else if (c.provider === "openai")
    await providerJson(
      `https://api.openai.com/v1/models/${encodeURIComponent(settings.model)}`,
      { headers: { Authorization: `Bearer ${c.credentials.apiKey}` } },
    );
  else if (c.provider === "anthropic")
    await providerJson(
      `https://api.anthropic.com/v1/models/${encodeURIComponent(settings.model)}`,
      {
        headers: {
          "x-api-key": c.credentials.apiKey,
          "anthropic-version": "2023-06-01",
        },
      },
    );
  else if (c.provider === "ses")
    return { status: "credentials_verified", ...(await checkSes(c)) };
  else
    return {
      status: "configuration_validated",
      note: "This provider requires a signed inbound test and a manually approved outbound test to verify delivery.",
    };
  return { status: "credentials_verified" };
}
export async function importContact(
  connection: any,
  input: unknown,
  config: Config,
) {
  const value = z
    .object({
      externalId: z.string().min(1).max(150),
      name: z.string(),
      email: z.string(),
      phone: z.string(),
      source: z.string(),
      campaign: z.string(),
    })
    .strict()
    .parse(input);
  const canonical = leadInput.parse({
    name: value.name,
    email: value.email,
    phone: value.phone,
    course: "Imported enquiry",
    channel: channelFor(value.source),
    campaign: value.campaign,
    note: "Imported contact; communication consent must be recorded separately.",
  });
  return transaction(async (session) => {
    const existing = await IntegrationLink.findOne({
      tenantId: connection.tenantId,
      connectionId: connection._id,
      externalId: value.externalId,
    })
      .session(session)
      .lean();
    if (existing) return { imported: false, leadId: existing.leadId };
    const form = await Form.findOne({
      tenantId: connection.tenantId,
      _id: connection.config.importFormId,
      active: true,
    })
      .session(session)
      .lean();
    if (!form)
      throw new AppError(
        422,
        "IMPORT_FORM_REQUIRED",
        "Choose an active intake form for course and ownership mapping.",
      );
    if (
      !(await Membership.exists({
        tenantId: connection.tenantId,
        userId: form.ownerId,
        status: "active",
        role: { $in: ["owner", "admin", "counselor"] },
      }).session(session))
    )
      throw new AppError(
        422,
        "IMPORT_OWNER_INACTIVE",
        "The import form owner is not active.",
      );
    const identityHash = lookupHash(
      value.email || value.phone.replace(/[ ()-]/g, ""),
      config.DATA_ENCRYPTION_KEY,
      connection.tenantId,
    );
    const identity = await Identity.findOne({
      tenantId: connection.tenantId,
      identityHash,
      course: form.course,
    })
      .session(session)
      .lean();
    let leadId = identity?.leadId;
    if (!leadId) {
      const auth = {
        tenantId: connection.tenantId,
        userId: String(form.ownerId),
        role: "owner" as const,
        sessionId: "connector",
        csrfToken: "",
        authenticatedAt: new Date(),
      };
      const result = await createLead(
        auth,
        { ...canonical, course: String(form.course) },
        `import:${connection._id}`,
        config,
        session,
      );
      leadId = result.id;
      await Identity.create(
        [
          {
            tenantId: connection.tenantId,
            identityHash,
            course: form.course,
            leadId,
          },
        ],
        { session },
      );
      await Followup.create(
        [
          {
            tenantId: connection.tenantId,
            leadId,
            assignedTo: form.ownerId,
            title: "Review imported enquiry and consent",
            dueAt: new Date(),
            eventKey: `import:${leadId}`,
          },
        ],
        { session },
      );
    }
    await IntegrationLink.create(
      [
        {
          tenantId: connection.tenantId,
          connectionId: connection._id,
          externalId: value.externalId,
          leadId,
        },
      ],
      { session },
    );
    return { imported: true, leadId };
  });
}
export async function synchronize(
  connectionId: string,
  tenantId: string,
  input: {
    kind: "spend" | "contacts";
    since?: string;
    until?: string;
    cursor?: string;
  },
  config: Config,
) {
  const { connection, context } = await connectorContext(
    connectionId,
    tenantId,
    config,
  );
  const run = await SyncRun.create({
    tenantId,
    connectionId,
    kind: input.kind,
    status: "running",
    imported: 0,
    rejected: 0,
  });
  let imported = 0,
    rejected = 0;
  const rejectionIds: string[] = [];
  try {
    const adapter = adapterFor(context);
    const result =
      input.kind === "spend"
        ? await adapter.pullSpend(input.since!, input.until!, input.cursor)
        : await adapter.pullContacts(input.cursor);
    for (const item of result.items) {
      try {
        if (input.kind === "spend") {
          const row = item as Awaited<
            ReturnType<typeof pullSpend>
          >["items"][number];
          await AdSpend.updateOne(
            {
              tenantId,
              connectionId,
              campaignId: row.campaignId,
              adId: row.adId,
              date: row.date,
              currency: row.currency,
            },
            {
              $set: {
                ...row,
                accountId: String(
                  connection.config.adAccountId ??
                    connection.config.customerId ??
                    "",
                ).replace(/^act_/, ""),
                evidence:
                  connection.mode === "live"
                    ? "provider_verified"
                    : "provider_test",
              },
            },
            { upsert: true },
          );
          imported++;
        } else {
          const importedRow = await importContact(connection, item, config);
          if (importedRow.imported) imported++;
        }
      } catch {
        rejected++;
        if (rejectionIds.length < 100)
          rejectionIds.push(
            String((item as any).externalId ?? (item as any).adId),
          );
      }
    }
    await SyncRun.updateOne(
      { tenantId, _id: run._id },
      {
        $set: {
          status: rejected ? "partial" : "completed",
          imported,
          rejected,
          rejectionIds,
          cursor: result.nextCursor,
          finishedAt: new Date(),
        },
      },
    );
    return {
      runId: run._id,
      imported,
      rejected,
      rejectionIds,
      nextCursor: result.nextCursor,
      complete: !result.nextCursor,
    };
  } catch (error) {
    await SyncRun.updateOne(
      { tenantId, _id: run._id },
      {
        $set: {
          status: "failed",
          errorCode:
            error instanceof ProviderError ? error.code : "SYNC_FAILED",
          finishedAt: new Date(),
        },
      },
    );
    throw new AppError(
      502,
      "SYNC_FAILED",
      "Provider sync failed. Review connection health and the sync history.",
    );
  }
}
const commandInput = z
  .object({
    connectionId: z.string().max(100),
    leadId: z.string().max(100),
    kind: z.enum(["call", "message", "analysis", "conversion"]),
    text: z.string().max(8000).optional(),
    milestoneId: z.string().max(100).optional(),
    notBefore: z.iso.datetime().optional(),
  })
  .strict();
const capability = {
  call: ["outpero"],
  message: ["whatsapp", "ses"],
  analysis: ["openai", "anthropic"],
  conversion: ["meta", "google_ads"],
};
export async function consentGranted(
  tenantId: string,
  leadId: string,
  purpose: string,
) {
  const record = await Consent.findOne({ tenantId, leadId, purpose })
    .sort({ occurredAt: -1, createdAt: -1, _id: -1 })
    .lean();
  return record?.granted === true;
}
async function allowedCommand(tenantId: string, leadId: string, kind: string) {
  if (await Suppression.exists({ tenantId, leadId }))
    throw new AppError(
      409,
      "CONTACT_SUPPRESSED",
      "Contact is suppressed; no outbound action can run.",
    );
  const purposes =
    kind === "conversion"
      ? ["tracking", "ad_measurement"]
      : kind === "analysis"
        ? ["ai_analysis"]
        : ["marketing"];
  for (const purpose of purposes)
    if (!(await consentGranted(tenantId, leadId, purpose)))
      throw new AppError(
        422,
        "CONSENT_REQUIRED",
        `Recorded ${purpose.replaceAll("_", " ")} consent is required.`,
      );
}
export function integrationRouter(config: Config) {
  const router = Router({ mergeParams: true });
  router.use(
    ["/integrations", "/commands", "/consent"],
    requirePermission("connections.write"),
  );
  router.get("/integrations", async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const [connections, commands, syncs, webhooks] = await Promise.all([
      Connection.find({ tenantId }).lean(),
      Command.find({ tenantId }).sort({ createdAt: -1 }).limit(100).lean(),
      SyncRun.find({ tenantId }).sort({ createdAt: -1 }).limit(30).lean(),
      Webhook.find({ tenantId })
        .sort({ createdAt: -1 })
        .limit(30)
        .select("-bodyHash")
        .lean(),
    ]);
    res.json({
      connections: connections.map((c) => ({
        id: c._id,
        provider: c.provider,
        label: c.label,
        accountId: c.accountId,
        mode: c.mode,
        status: c.status,
        config: c.config,
        health: c.health,
        version: c.version,
        credentialKeys: c.credentialKeys,
      })),
      commands,
      syncs,
      webhooks,
      liveExecution: config.ALLOW_LIVE_PROVIDERS === "true",
    });
  });
  router.post("/integrations/webhooks/:id/retry", async (req, res) => {
    await transaction(async (session) => {
      const result = await Webhook.updateOne(
        {
          tenantId: req.auth!.tenantId,
          _id: String(req.params.id),
          status: "failed",
          payloadCipher: { $exists: true },
        },
        {
          $set: { status: "received", attempts: 0 },
          $unset: { errorCode: 1, leaseUntil: 1 },
        },
        { session },
      );
      if (!result.modifiedCount)
        throw new AppError(
          409,
          "WEBHOOK_NOT_RETRYABLE",
          "This event is processing, already complete, or its payload has expired.",
        );
      await audit(
        req.auth!,
        "webhook.replay_requested",
        String(req.params.id),
        req.requestId,
        session,
      );
    });
    res.json({ queued: true });
  });
  router.put("/integrations/:id/configure", async (req, res) => {
    const input = z
      .object({
        version: z.number().int().min(1),
        mode: z.enum(["test", "live"]),
        settings: z.record(z.string(), z.unknown()),
        credentials: z
          .record(z.string().max(80), z.string().max(8000))
          .default({}),
      })
      .strict()
      .parse(req.body);
    const connection = await Connection.findOne({
      _id: String(req.params.id),
      tenantId: req.auth!.tenantId,
    })
      .select("+credentialCipher")
      .lean();
    if (!connection)
      throw new AppError(404, "CONNECTION_NOT_FOUND", "Connection not found.");
    const permitted =
      requiredCredentials[
        connection.provider as keyof typeof requiredCredentials
      ];
    if (Object.keys(input.credentials).some((k) => !permitted.includes(k)))
      throw new AppError(
        422,
        "INVALID_CREDENTIAL_FIELD",
        "Use only credential fields supported by this provider.",
      );
    const existing = connection.credentialCipher
      ? unseal<Record<string, string>>(
          connection.credentialCipher,
          config.DATA_ENCRYPTION_KEY,
          connection.tenantId,
        )
      : {};
    const credentials = { ...existing, ...input.credentials };
    let settings: any;
    try {
      settings = validateConnection(
        connection.provider,
        input.settings,
        credentials,
      );
      if (["stripe", "razorpay"].includes(connection.provider))
        assertPaymentMode(connection.provider, credentials, input.mode);
    } catch {
      throw new AppError(
        422,
        "INVALID_PROVIDER_CONFIG",
        "Check provider settings, credential names and test/live key mode.",
      );
    }
    if (
      settings.importFormId &&
      !(await Form.exists({
        _id: settings.importFormId,
        tenantId: connection.tenantId,
      }))
    )
      throw new AppError(
        422,
        "IMPORT_FORM_REQUIRED",
        "Select an intake form from this workspace.",
      );
    await transaction(async (session) => {
      const changed = await Connection.updateOne(
        {
          tenantId: connection.tenantId,
          _id: connection._id,
          version: input.version,
        },
        {
          $set: {
            config: settings,
            mode: input.mode,
            status: "draft",
            health: {},
            credentialKeys: Object.keys(credentials),
            credentialCipher: seal(
              credentials,
              config.DATA_ENCRYPTION_KEY,
              connection.tenantId,
            ),
            ...(["meta", "google_ads"].includes(connection.provider)
              ? { accountId: settings.adAccountId ?? settings.customerId }
              : {}),
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (!changed.modifiedCount)
        throw new AppError(
          409,
          "CONNECTION_CHANGED",
          "Refresh this connection before saving.",
        );
      await audit(
        req.auth!,
        "connection.configured",
        connection._id,
        req.requestId,
        session,
      );
    });
    res.json({ configured: true, status: "draft" });
  });
  router.post("/integrations/:id/check", async (req, res) => {
    const { connection, context } = await connectorContext(
      String(req.params.id),
      req.auth!.tenantId!,
      config,
      false,
    );
    try {
      const result = {
        ...(await health(context)),
        checkedAt: new Date().toISOString(),
        version: connection.version,
      };
      await Connection.updateOne(
        {
          tenantId: connection.tenantId,
          _id: connection._id,
          version: connection.version,
        },
        { $set: { health: result } },
      );
      res.json(result);
    } catch {
      throw new AppError(
        502,
        "CONNECTION_CHECK_FAILED",
        "Provider access could not be verified. Check credentials, scopes, account and API version.",
      );
    }
  });
  router.post("/integrations/:id/activate", async (req, res) => {
    const { confirmed } = z
      .object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    const { connection } = await connectorContext(
      String(req.params.id),
      req.auth!.tenantId!,
      config,
      false,
    );
    if (connection.mode === "live") await privilegedLive(req.auth!, config);
    if (
      connection.health?.version !== connection.version ||
      Date.now() - Date.parse(String(connection.health?.checkedAt)) > 3600000 ||
      !connection.health?.checkedAt
    )
      throw new AppError(
        422,
        "RECENT_CHECK_REQUIRED",
        "Check this connection before activating it.",
      );
    await transaction(async (session) => {
      const changed = await Connection.updateOne(
        {
          _id: connection._id,
          tenantId: connection.tenantId,
          version: connection.version,
        },
        { $set: { status: connection.mode === "live" ? "active" : "test" } },
        { session },
      );
      if (!changed.matchedCount)
        throw new AppError(
          409,
          "CONNECTION_CHANGED",
          "Refresh and check this connection again.",
        );
      await audit(
        req.auth!,
        "connection.activated",
        connection._id,
        req.requestId,
        session,
      );
    });
    res.json({ activated: confirmed });
  });
  router.post("/integrations/:id/pause", async (req, res) => {
    await transaction(async (session) => {
      await Connection.updateOne(
        { _id: String(req.params.id), tenantId: req.auth!.tenantId },
        { $set: { status: "paused" } },
        { session },
      );
      await Command.updateMany(
        {
          tenantId: req.auth!.tenantId,
          connectionId: String(req.params.id),
          status: "queued",
        },
        { $set: { status: "pending_approval" } },
        { session },
      );
      await audit(
        req.auth!,
        "connection.paused",
        String(req.params.id),
        req.requestId,
        session,
      );
    });
    res.json({ paused: true });
  });
  router.post("/integrations/:id/sync", async (req, res) => {
    const input = z
      .object({
        kind: z.enum(["spend", "contacts"]),
        since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        cursor: z.string().max(1000).optional(),
      })
      .strict()
      .parse(req.body);
    if (
      input.kind === "spend" &&
      (!input.since ||
        !input.until ||
        !Number.isFinite(Date.parse(input.since)) ||
        !Number.isFinite(Date.parse(input.until)) ||
        Date.parse(input.until) < Date.parse(input.since) ||
        Date.parse(input.until) - Date.parse(input.since) > 31 * 86400000)
    )
      throw new AppError(
        422,
        "INVALID_SYNC_RANGE",
        "Choose a date range of up to 31 days.",
      );
    res.json(
      await synchronize(
        String(req.params.id),
        req.auth!.tenantId!,
        input,
        config,
      ),
    );
  });
  router.post("/commands", async (req, res) => {
    const input = commandInput.parse(req.body),
      operation = req.get("Idempotency-Key") ?? "";
    const { connection, context } = await connectorContext(
      input.connectionId,
      req.auth!.tenantId!,
      config,
    );
    if (!(capability[input.kind] as string[]).includes(connection.provider))
      throw new AppError(
        422,
        "CAPABILITY_UNAVAILABLE",
        "This connection does not support that action.",
      );
    if (
      !(await Lead.exists({
        _id: input.leadId,
        tenantId: connection.tenantId,
        erasedAt: { $exists: false },
      }))
    )
      throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
    await allowedCommand(connection.tenantId, input.leadId, input.kind);
    if (input.kind === "analysis" && !input.text?.trim())
      throw new AppError(
        422,
        "TEXT_REQUIRED",
        "Provide conversation evidence for review.",
      );
    if (
      input.kind === "conversion" &&
      !(await Milestone.exists({
        _id: input.milestoneId,
        tenantId: connection.tenantId,
        leadId: input.leadId,
        type: { $in: ["lead_accepted", "qualified", "enrollment_confirmed"] },
      }))
    )
      throw new AppError(
        422,
        "MILESTONE_REQUIRED",
        "Select a recorded conversion milestone.",
      );
    const result = await idempotent(
      req.auth!,
      "POST/commands",
      operation,
      input,
      async (session) => {
        await reserveUsage(connection.tenantId, "commands", session);
        const [command] = await Command.create(
          [
            {
              tenantId: connection.tenantId,
              leadId: input.leadId,
              connectionId: connection._id,
              connectionVersion: connection.version,
              kind: input.kind,
              payloadCipher: seal(
                {
                  text: input.text,
                  milestoneId: input.milestoneId,
                  preview:
                    input.kind === "message"
                      ? (context.settings.templateBody ?? context.settings.body)
                      : undefined,
                },
                config.DATA_ENCRYPTION_KEY,
                connection.tenantId,
              ),
              status: "pending_approval",
              requestedBy: req.auth!.userId,
              idempotencyKey: operation,
              requestHash: digest(JSON.stringify(input)),
              notBefore: input.notBefore
                ? new Date(input.notBefore)
                : new Date(),
            },
          ],
          { session },
        );
        await audit(
          req.auth!,
          "command.requested",
          String(command._id),
          req.requestId,
          session,
        );
        return { id: command._id, status: "pending_approval" };
      },
    );
    res.status(201).json(result);
  });
  router.get("/commands/:id/preview", async (req, res) => {
    const command = await Command.findOne({
      _id: String(req.params.id),
      tenantId: req.auth!.tenantId,
    })
      .select("+payloadCipher")
      .lean();
    if (!command)
      throw new AppError(404, "COMMAND_NOT_FOUND", "Action not found.");
    const { payloadCipher, ...safeCommand } = command;
    res.json({
      command: safeCommand,
      payload: command.payloadCipher
        ? unseal(
            String(command.payloadCipher),
            config.DATA_ENCRYPTION_KEY,
            command.tenantId,
          )
        : {},
      caution:
        "Provider acceptance does not confirm delivery, a completed call, or attributed conversion.",
    });
  });
  router.post("/commands/:id/approve", async (req, res) => {
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    const command = await Command.findOne({
      _id: String(req.params.id),
      tenantId: req.auth!.tenantId,
      status: "pending_approval",
    }).lean();
    if (!command)
      throw new AppError(
        409,
        "COMMAND_CHANGED",
        "This action is no longer awaiting approval.",
      );
    const { connection } = await connectorContext(
      String(command.connectionId),
      command.tenantId,
      config,
    );
    if (connection.mode === "live") await privilegedLive(req.auth!, config);
    if (connection.version !== command.connectionVersion)
      throw new AppError(
        409,
        "CONFIGURATION_CHANGED",
        "Provider settings changed. Create a new action for review.",
      );
    await allowedCommand(
      command.tenantId,
      String(command.leadId),
      String(command.kind),
    );
    await transaction(async (session) => {
      const changed = await Command.updateOne(
        {
          _id: command._id,
          tenantId: command.tenantId,
          status: "pending_approval",
        },
        { $set: { status: "queued", approvedBy: req.auth!.userId } },
        { session },
      );
      if (!changed.modifiedCount)
        throw new AppError(
          409,
          "COMMAND_CHANGED",
          "Refresh this action before approving it.",
        );
      await audit(
        req.auth!,
        "command.approved",
        command._id,
        req.requestId,
        session,
      );
    });
    res.json({ queued: true });
  });
  router.post("/commands/:id/cancel", async (req, res) => {
    await transaction(async (session) => {
      const result = await Command.updateOne(
        {
          _id: String(req.params.id),
          tenantId: req.auth!.tenantId,
          status: { $in: ["queued", "pending_approval"] },
        },
        { $set: { status: "cancelled" } },
        { session },
      );
      if (!result.modifiedCount)
        throw new AppError(
          409,
          "COMMAND_CHANGED",
          "This action cannot be cancelled in its current state.",
        );
      await audit(
        req.auth!,
        "command.cancelled",
        String(req.params.id),
        req.requestId,
        session,
      );
    });
    res.json({ cancelled: true });
  });
  router.post("/consent/:leadId", async (req, res) => {
    const input = z
      .object({
        purpose: z.enum([
          "marketing",
          "tracking",
          "ad_measurement",
          "ai_analysis",
        ]),
        granted: z.boolean(),
        evidence: z.string().trim().min(10).max(300),
      })
      .strict()
      .parse(req.body);
    if (
      !(await Lead.exists({
        tenantId: req.auth!.tenantId,
        _id: String(req.params.leadId),
        erasedAt: { $exists: false },
      }))
    )
      throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
    await transaction(async (session) => {
      await Consent.create(
        [
          {
            tenantId: req.auth!.tenantId,
            leadId: String(req.params.leadId),
            version: `operator:${req.auth!.userId}`,
            purpose: input.purpose,
            granted: input.granted,
            occurredAt: new Date(),
          },
        ],
        { session },
      );
      await timeline(
        req.auth!.tenantId!,
        String(req.params.leadId),
        "consent.recorded.v1",
        `${input.purpose} consent ${input.granted ? "recorded" : "withdrawn"}`,
        input.evidence,
        req.auth!.userId,
        session,
      );
      await audit(
        req.auth!,
        "consent.recorded",
        String(req.params.leadId),
        req.requestId,
        session,
      );
    });
    res.json({ recorded: true });
  });
  return router;
}

export async function executeCommand(id: string, config: Config) {
  const command = await Command.findOneAndUpdate(
    { _id: id, status: "queued", notBefore: { $lte: new Date() } },
    { $set: { status: "running", leaseUntil: new Date(Date.now() + 120000) } },
    { returnDocument: "after" },
  )
    .select("+payloadCipher")
    .lean();
  if (!command) return;
  let networkStarted = false;
  try {
    const { connection, context } = await connectorContext(
      String(command.connectionId),
      command.tenantId,
      config,
    );
    const adapter = adapterFor(context);
    if (connection.version !== command.connectionVersion)
      throw new ProviderError("CONFIGURATION_CHANGED");
    const lead = await Lead.findOne({
      _id: command.leadId,
      tenantId: command.tenantId,
      erasedAt: { $exists: false },
    })
      .select("+contactCipher")
      .lean();
    if (!lead) throw new ProviderError("CONTACT_UNAVAILABLE");
    await allowedCommand(command.tenantId, lead._id, String(command.kind));
    const tenant = await Tenant.findById(command.tenantId).lean();
    if (["call", "message"].includes(String(command.kind))) {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: tenant!.timezone,
          hour: "2-digit",
          hourCycle: "h23",
        }).format(new Date()),
      );
      if (hour < 9 || hour >= 20) {
        await Command.updateOne(
          { _id: command._id, status: "running" },
          {
            $set: {
              status: "queued",
              notBefore: new Date(Date.now() + 15 * 60000),
            },
            $unset: { leaseUntil: 1 },
          },
        );
        return;
      }
    }
    await transaction(async (session) => {
      const metric = `provider:${connection._id}:${new Date().toISOString().slice(0, 10)}`;
      const count = await Usage.findOneAndUpdate(
        { tenantId: command.tenantId, period: "daily", metric },
        { $inc: { count: 1 } },
        { upsert: true, returnDocument: "after", session },
      );
      if (Number(count?.count) > context.settings.dailyActionLimit)
        throw new AppError(
          429,
          "DAILY_ACTION_LIMIT",
          "The connection's daily action allowance is reached.",
        );
    });
    const contact = unseal<{ email: string; phone: string }>(
      lead.contactCipher,
      config.DATA_ENCRYPTION_KEY,
      lead.tenantId,
    );
    const payload = unseal<{ text?: string; milestoneId?: string }>(
      String(command.payloadCipher),
      config.DATA_ENCRYPTION_KEY,
      command.tenantId,
    );
    let result: any;
    if (
      connection.mode === "test" &&
      ["call", "message", "analysis"].includes(String(command.kind))
    ) {
      result = {
        disposition: "local_simulation_no_external_request",
        note: "No call, message, or AI request was sent. Live execution requires explicit activation.",
      };
    } else if (command.kind === "conversion") {
      const milestone = await Milestone.findOne({
        _id: payload.milestoneId,
        tenantId: command.tenantId,
        leadId: lead._id,
      }).lean();
      if (
        !milestone ||
        !["lead_accepted", "qualified", "enrollment_confirmed"].includes(
          String(milestone.type),
        )
      )
        throw new ProviderError("MILESTONE_UNAVAILABLE");
      if (
        connection.mode === "live" &&
        ["sandbox", "provider_test"].includes(String(milestone.evidence))
      )
        throw new ProviderError("SYNTHETIC_CONVERSION_DENIED");
      const touch = await Touch.findOne({
        tenantId: command.tenantId,
        leadId: lead._id,
        eligible: true,
        source: {
          $in:
            connection.provider === "meta"
              ? ["Meta Ads"]
              : ["Google Ads", "YouTube Ads"],
        },
        occurredAt: {
          $lte: milestone.occurredAt,
          $gte: new Date(+new Date(milestone.occurredAt!) - 30 * 86400000),
        },
      })
        .sort({ occurredAt: -1 })
        .lean();
      const receipt =
        milestone.type === "enrollment_confirmed"
          ? await Receipt.findOne({
              tenantId: command.tenantId,
              leadId: lead._id,
              kind: "capture",
              paymentOrderId: String(milestone.eventKey).replace(
                /^enrollment:/,
                "",
              ),
            }).lean()
          : null;
      if (
        milestone.type === "enrollment_confirmed" &&
        (!receipt || receipt.refundedMinor !== "0")
      )
        throw new ProviderError("CONVERSION_REQUIRES_UNREFUNDED_PAYMENT");
      networkStarted = true;
      result = await adapter.submitConversion({
        id: milestone._id,
        stage: milestone.type as
          "lead_accepted" | "qualified" | "enrollment_confirmed",
        occurredAt: new Date(milestone.occurredAt!).toISOString(),
        email: contact.email,
        phone: contact.phone,
        clickIds: touch?.clickIds ?? {},
        touchTime: touch?.occurredAt ? +touch.occurredAt : undefined,
        ...(receipt
          ? { amountMinor: receipt.amountMinor, currency: receipt.currency }
          : {}),
      });
    } else {
      networkStarted = true;
      if (command.kind === "analysis")
        result = await adapter.analyze(
          (payload.text ?? "").replaceAll(lead.name, "[contact]"),
        );
      else if (command.kind === "message") result = await adapter.send(contact);
      else if (command.kind === "call")
        result = await adapter.call(
          { name: lead.name, phone: contact.phone },
          command._id,
        );
      else throw new ProviderError("CAPABILITY_UNAVAILABLE");
    }
    await transaction(async (session) => {
      await Command.updateOne(
        { _id: command._id, tenantId: command.tenantId, status: "running" },
        {
          $set: { status: "succeeded", result, completedAt: new Date() },
          $inc: { attempts: 1 },
          $unset: { payloadCipher: 1, leaseUntil: 1 },
        },
        { session },
      );
      await timeline(
        command.tenantId,
        lead._id,
        "provider.action.v1",
        result.disposition === "local_simulation_no_external_request"
          ? `${command.kind} simulated locally`
          : `${command.kind} accepted by provider`,
        String(result.disposition ?? "Analysis available for review"),
        "provider-worker",
        session,
      );
      await audit(
        {
          tenantId: command.tenantId,
          userId: "provider-worker",
          sessionId: "worker",
          csrfToken: "",
          authenticatedAt: new Date(),
        },
        "command.completed",
        command._id,
        command._id,
        session,
      );
    });
  } catch (error) {
    const code =
      error instanceof ProviderError || error instanceof AppError
        ? error.code
        : "ACTION_FAILED";
    const unknown =
      networkStarted && (!(error instanceof ProviderError) || error.ambiguous);
    await Command.updateOne(
      { _id: command._id, tenantId: command.tenantId, status: "running" },
      {
        $set: {
          status: unknown ? "unknown" : "failed",
          errorCode: code,
          completedAt: new Date(),
        },
        $inc: { attempts: 1 },
        $unset: { leaseUntil: 1 },
      },
    );
  }
}
