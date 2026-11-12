import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { Config } from "../../api/src/config.ts";
import { Connection, Tenant, Lead } from "../../api/src/models.ts";
import {
  Webhook,
  Command,
  Mail,
  CallRecord,
  Attempt,
  Milestone,
  Consent,
  Touch,
  Suppression,
} from "../../api/src/journey/models.ts";
import { processPaymentWebhook } from "../../api/src/journey/payments.ts";
import { processIntegrationWebhook } from "../../api/src/journey/webhooks.ts";
import {
  executeCommand,
  consentGranted,
} from "../../api/src/journey/integrations.ts";
import { unseal, seal, digest } from "../../api/src/security.ts";
import { reserveUsage } from "../../api/src/journey/entitlements.ts";
import { transaction } from "../../api/src/db.ts";
import { processBillingWebhook } from "../../api/src/journey/billing.ts";

export async function processWebhook(id: string, config: Config) {
  const hook = await Webhook.findOneAndUpdate(
    { _id: id, status: { $in: ["received", "failed"] }, attempts: { $lt: 8 } },
    {
      $set: { status: "processing", leaseUntil: new Date(Date.now() + 120000) },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after" },
  ).lean();
  if (!hook) return;
  try {
    if (hook.connectionId === "platform-billing") {
      await processBillingWebhook(id, config);
      return;
    }
    const connection = await Connection.findOne({
      tenantId: hook.tenantId,
      _id: hook.connectionId,
    }).lean();
    if (!connection) throw new Error("CONNECTION_UNAVAILABLE");
    if (["stripe", "razorpay"].includes(connection.provider))
      await processPaymentWebhook(id, config);
    else await processIntegrationWebhook(id, config);
  } catch (error: any) {
    await Webhook.updateOne(
      { _id: id, tenantId: hook.tenantId },
      {
        $set: {
          status: "failed",
          errorCode: /^[A-Z_]{3,80}$/.test(String(error.code ?? error.message))
            ? String(error.code ?? error.message)
            : "WEBHOOK_PROCESSING_FAILED",
        },
        $unset: { leaseUntil: 1 },
      },
    );
    throw new Error("WEBHOOK_PROCESSING_FAILED");
  }
}
export async function recoverExpiredWork() {
  const now = new Date();
  // A crashed outbound request may have succeeded remotely. Never resend it.
  await Command.updateMany(
    { status: "running", leaseUntil: { $lt: now } },
    {
      $set: { status: "unknown", errorCode: "WORKER_INTERRUPTED" },
      $unset: { leaseUntil: 1 },
    },
  );
  await Mail.updateMany(
    { status: "sending", updatedAt: { $lt: new Date(Date.now() - 120000) } },
    { $set: { status: "unknown" } },
  );
  // Inbound projection is idempotent and can safely resume.
  await Webhook.updateMany(
    { status: "processing", leaseUntil: { $lt: now } },
    {
      $set: { status: "failed", errorCode: "WORKER_INTERRUPTED" },
      $unset: { leaseUntil: 1 },
    },
  );
}
export async function deliverAccountMail(config: Config) {
  if (
    config.ALLOW_ACCOUNT_EMAIL !== "true" ||
    !config.ACCOUNT_EMAIL_FROM ||
    config.REVENUEPILOT_DEMO === "true"
  )
    return;
  const mail = await Mail.findOneAndUpdate(
    { status: "pending", createdAt: { $gt: new Date(Date.now() - 3600000) } },
    { $set: { status: "sending" } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  )
    .select("+bodyCipher")
    .lean();
  if (!mail) return;
  const client = new SESv2Client({
    region: config.AWS_REGION,
    maxAttempts: 1,
    requestHandler: { requestTimeout: 15000 },
  });
  try {
    const body = unseal<string>(
      String(mail.bodyCipher),
      config.DATA_ENCRYPTION_KEY,
      mail.tenantId,
    );
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: config.ACCOUNT_EMAIL_FROM,
        Destination: { ToAddresses: [String(mail.recipient)] },
        Content: {
          Simple: {
            Subject: { Data: String(mail.subject), Charset: "UTF-8" },
            Body: { Text: { Data: body, Charset: "UTF-8" } },
          },
        },
      }),
    );
    await Mail.updateOne(
      { _id: mail._id, tenantId: mail.tenantId },
      {
        $set: { status: "sent", sentAt: new Date() },
        $unset: { bodyCipher: 1 },
      },
    );
  } catch {
    await Mail.updateOne(
      { _id: mail._id, tenantId: mail.tenantId },
      { $set: { status: "unknown" } },
    );
  } finally {
    client.destroy();
  }
}
export async function prepareConversionApprovals(config: Config) {
  const connections = Connection.find({
    provider: { $in: ["meta", "google_ads"] },
    status: { $in: ["test", "active"] },
  })
    .lean()
    .cursor();
  for await (const connection of connections) {
    if (!connection.config.pixelId && !connection.config.conversionActionId)
      continue;
    const milestones = Milestone.find({
      tenantId: connection.tenantId,
      type: { $in: ["lead_accepted", "qualified", "enrollment_confirmed"] },
      occurredAt: { $gte: new Date(Date.now() - 7 * 86400000) },
    })
      .sort({ occurredAt: 1, _id: 1 })
      .lean()
      .cursor();
    for await (const milestone of milestones) {
      if (
        !(await consentGranted(
          connection.tenantId,
          String(milestone.leadId),
          "ad_measurement",
        )) ||
        !(await consentGranted(
          connection.tenantId,
          String(milestone.leadId),
          "tracking",
        ))
      )
        continue;
      if (
        connection.mode === "live" &&
        ["sandbox", "provider_test"].includes(String(milestone.evidence))
      )
        continue;
      if (
        await Suppression.exists({
          tenantId: connection.tenantId,
          leadId: milestone.leadId,
        })
      )
        continue;
      if (
        !(await Touch.exists({
          tenantId: connection.tenantId,
          leadId: milestone.leadId,
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
        }))
      )
        continue;
      const key = `conversion_${connection._id}_${milestone._id}`;
      if (
        await Command.exists({
          tenantId: connection.tenantId,
          idempotencyKey: key,
        })
      )
        continue;
      try {
        await transaction(async (session) => {
          await reserveUsage(connection.tenantId, "commands", session);
          await Command.create(
            [
              {
                tenantId: connection.tenantId,
                connectionId: connection._id,
                connectionVersion: connection.version,
                leadId: milestone.leadId,
                kind: "conversion",
                status: "pending_approval",
                requestedBy: "conversion-planner",
                idempotencyKey: key,
                requestHash: digest(key),
                payloadCipher: seal(
                  { milestoneId: milestone._id },
                  config.DATA_ENCRYPTION_KEY,
                  connection.tenantId,
                ),
                notBefore: new Date(),
              },
            ],
            { session },
          );
        });
      } catch (error: any) {
        if (error.code === "PLAN_LIMIT") break;
        if (error.code !== 11000) throw error;
      }
    }
  }
}
export async function applyRetention() {
  const tenants = await Tenant.find({}).select("_id retentionDays").lean();
  for (const tenant of tenants) {
    const before = new Date(Date.now() - tenant.retentionDays * 86400000);
    await Attempt.deleteMany({
      tenantId: tenant._id,
      createdAt: { $lt: before },
    });
    await CallRecord.updateMany(
      { tenantId: tenant._id, endedAt: { $lt: before } },
      { $unset: { summaryCipher: 1, transcriptCipher: 1 } },
    );
    await Webhook.updateMany(
      { tenantId: tenant._id, createdAt: { $lt: before } },
      { $unset: { payloadCipher: 1 } },
    );
    await Mail.deleteMany({ tenantId: tenant._id, createdAt: { $lt: before } });
    await Command.updateMany(
      {
        tenantId: tenant._id,
        createdAt: { $lt: before },
        status: { $in: ["succeeded", "failed", "cancelled", "unknown"] },
      },
      { $unset: { payloadCipher: 1, "result.analysis": 1 } },
    );
  }
}
let maintenanceAt = 0;
export async function maintainJourney(config: Config) {
  await recoverExpiredWork();
  if (Date.now() - maintenanceAt > 60000) {
    maintenanceAt = Date.now();
    await prepareConversionApprovals(config);
    await applyRetention();
  }
  await deliverAccountMail(config);
}
export async function drainJourney(config: Config) {
  await maintainJourney(config);
  const hooks = await Webhook.find({
    status: { $in: ["received", "failed"] },
    attempts: { $lt: 8 },
  })
    .sort({ createdAt: 1 })
    .limit(10)
    .lean();
  for (const hook of hooks)
    await processWebhook(hook._id, config).catch(() => {});
  const commands = await Command.find({
    status: "queued",
    notBefore: { $lte: new Date() },
  })
    .sort({ createdAt: 1 })
    .limit(10)
    .lean();
  for (const command of commands) await executeCommand(command._id, config);
}
