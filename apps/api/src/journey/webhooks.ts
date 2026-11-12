import express, { Router } from "express";
import { createHmac, createVerify, X509Certificate } from "node:crypto";
import { z } from "zod";
import { Connection, Lead } from "../models.ts";
import {
  Webhook,
  Command,
  CallRecord,
  Suppression,
  Consent,
} from "./models.ts";
import { unseal, seal, digest, equal, lookupHash } from "../security.ts";
import type { Config } from "../config.ts";
import { AppError } from "../errors.ts";
import { rateLimit } from "../rate-limit.ts";
import { transaction } from "../db.ts";
import { timeline } from "../services.ts";
import { milestone } from "./evidence.ts";
import { importContact } from "./integrations.ts";

export function verifyTimestampedSignature(
  raw: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
  now = Date.now(),
) {
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    secret.length < 16
  )
    return false;
  return equal(
    `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(raw).digest("hex")}`,
    signature,
  );
}
const sns = z.object({
  Type: z.enum([
    "Notification",
    "SubscriptionConfirmation",
    "UnsubscribeConfirmation",
  ]),
  MessageId: z.string().max(100),
  TopicArn: z.string(),
  Message: z.string().max(300000),
  Timestamp: z.iso.datetime(),
  SignatureVersion: z.enum(["1", "2"]),
  Signature: z.string(),
  SigningCertURL: z.url(),
  Subject: z.string().optional(),
  Token: z.string().optional(),
  SubscribeURL: z.url().optional(),
});
async function verifySns(payload: unknown, topicArn: string, region: string) {
  const value = sns.parse(payload);
  if (
    value.TopicArn !== topicArn ||
    Math.abs(Date.now() - Date.parse(value.Timestamp)) > 3600000
  )
    throw new Error("SNS_TOPIC_OR_TIME_MISMATCH");
  const url = new URL(value.SigningCertURL);
  if (
    url.origin !== `https://sns.${region}.amazonaws.com` ||
    !/^\/SimpleNotificationService-[a-fA-F0-9]+\.pem$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("SNS_CERTIFICATE_DENIED");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("SNS_CERTIFICATE_UNAVAILABLE");
  const reader = response.body!.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16000) {
      await reader.cancel();
      throw new Error("SNS_CERTIFICATE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const cert = new X509Certificate(Buffer.concat(chunks));
  if (
    Date.now() < Date.parse(cert.validFrom) ||
    Date.now() > Date.parse(cert.validTo)
  )
    throw new Error("SNS_CERTIFICATE_EXPIRED");
  const fields =
    value.Type === "Notification"
      ? [
          "Message",
          "MessageId",
          ...(value.Subject === undefined ? [] : ["Subject"]),
          "Timestamp",
          "TopicArn",
          "Type",
        ]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ];
  const canonical = fields
    .map(
      (field) =>
        `${field}\n${String(value[field as keyof typeof value] ?? "")}\n`,
    )
    .join("");
  if (
    !createVerify(value.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1")
      .update(canonical)
      .verify(cert.publicKey, value.Signature, "base64")
  )
    throw new Error("SNS_SIGNATURE_INVALID");
  return value;
}
export function integrationWebhookRouter(config: Config) {
  const router = Router();
  router.get("/:connectionId", async (req, res) => {
    const connection = await Connection.findOne({
      _id: String(req.params.connectionId),
      provider: "whatsapp",
      status: { $in: ["test", "active"] },
    })
      .select("+credentialCipher")
      .lean();
    if (!connection?.credentialCipher)
      throw new AppError(404, "NOT_FOUND", "Connection not found.");
    const credentials = unseal<Record<string, string>>(
      connection.credentialCipher,
      config.DATA_ENCRYPTION_KEY,
      connection.tenantId,
    );
    if (
      req.query["hub.mode"] !== "subscribe" ||
      !equal(
        String(req.query["hub.verify_token"] ?? ""),
        credentials.verifyToken ?? "",
      )
    )
      throw new AppError(
        403,
        "VERIFICATION_FAILED",
        "Webhook verification failed.",
      );
    res
      .type("text/plain")
      .send(z.string().max(100).parse(req.query["hub.challenge"]));
  });
  router.post(
    "/:connectionId",
    express.raw({ type: ["application/json", "text/plain"], limit: "512kb" }),
    async (req, res) => {
      await rateLimit(`inbound:${req.params.connectionId}:${req.ip}`, 180);
      const connection = await Connection.findOne({
        _id: String(req.params.connectionId),
        provider: { $in: ["generic_crm", "outpero", "whatsapp", "ses"] },
        status: { $in: ["test", "active", "paused"] },
      })
        .select("+credentialCipher")
        .lean();
      if (!connection?.credentialCipher)
        throw new AppError(404, "NOT_FOUND", "Connection not found.");
      if (!Buffer.isBuffer(req.body))
        throw new AppError(400, "RAW_BODY_REQUIRED", "Use a JSON payload.");
      const credentials = unseal<Record<string, string>>(
        connection.credentialCipher,
        config.DATA_ENCRYPTION_KEY,
        connection.tenantId,
      );
      let payload: any, externalId: string;
      try {
        payload = JSON.parse(req.body.toString("utf8"));
        if (connection.provider === "whatsapp") {
          if (
            !credentials.appSecret ||
            !equal(
              `sha256=${createHmac("sha256", credentials.appSecret).update(req.body).digest("hex")}`,
              req.get("X-Hub-Signature-256") ?? "",
            )
          )
            throw new Error();
          externalId = digest(req.body.toString("utf8"));
        } else if (connection.provider === "ses") {
          const verified = await verifySns(
            payload,
            String(connection.config.snsTopicArn),
            String(connection.config.region),
          );
          externalId = verified.MessageId;
        } else {
          const prefix =
            connection.provider === "outpero" ? "X-Outpero" : "X-RevenuePilot";
          if (
            !verifyTimestampedSignature(
              req.body,
              req.get(`${prefix}-Timestamp`) ?? "",
              req.get(`${prefix}-Signature`) ?? "",
              credentials.webhookSecret ?? "",
            )
          )
            throw new Error();
          externalId = z
            .string()
            .min(1)
            .max(150)
            .parse(
              connection.provider === "outpero"
                ? payload.call_id
                : payload.eventId,
            );
        }
      } catch {
        throw new AppError(
          400,
          "WEBHOOK_VERIFICATION_FAILED",
          "The webhook signature or envelope is invalid.",
        );
      }
      const bodyHash = digest(req.body.toString("utf8"));
      try {
        await Webhook.create({
          tenantId: connection.tenantId,
          connectionId: connection._id,
          externalId,
          bodyHash,
          payloadCipher: seal(
            payload,
            config.DATA_ENCRYPTION_KEY,
            connection.tenantId,
          ),
        });
      } catch (error: any) {
        if (error.code !== 11000) throw error;
        const existing = await Webhook.findOne({
          connectionId: connection._id,
          externalId,
        }).lean();
        if (existing?.bodyHash !== bodyHash)
          throw new AppError(
            409,
            "WEBHOOK_REPLAY_CONFLICT",
            "Event ID was reused with a different body.",
          );
      }
      res.status(202).json({ accepted: true });
    },
  );
  return router;
}
export async function processIntegrationWebhook(id: string, config: Config) {
  const hook = await Webhook.findOne({
    _id: id,
    status: { $in: ["received", "failed", "processing"] },
  })
    .select("+payloadCipher")
    .lean();
  if (!hook) return;
  const connection = await Connection.findOne({
    _id: hook.connectionId,
    tenantId: hook.tenantId,
    status: { $in: ["test", "active"] },
  }).lean();
  if (!connection) throw new Error("CONNECTION_INACTIVE");
  const payload: any = unseal(
    String(hook.payloadCipher),
    config.DATA_ENCRYPTION_KEY,
    hook.tenantId,
  );
  if (connection.provider === "generic_crm") {
    const input = z
      .object({
        eventId: z.string().max(150),
        type: z.literal("contact.upsert.v1"),
        contact: z
          .object({
            externalId: z.string().max(150),
            name: z.string().max(100),
            email: z.string().max(254),
            phone: z.string().max(25),
            source: z.string().max(80).default("Other"),
            campaign: z.string().max(120).default(""),
          })
          .strict(),
      })
      .strict()
      .parse(payload);
    await importContact(connection, input.contact, config);
  } else if (connection.provider === "outpero") {
    const value = z
      .object({
        event: z.literal("call.ended"),
        call_id: z.string().max(150),
        status: z.enum(["completed", "voicemail"]),
        duration_s: z.number().min(0).max(86400),
        ended_at: z.iso.datetime(),
        summary: z.string().max(8000).default(""),
        transcript: z.unknown().optional(),
        pre_call: z
          .object({ revenuepilot_command_id: z.string().max(100) })
          .passthrough(),
      })
      .passthrough()
      .parse(payload);
    const command = await Command.findOne({
      _id: value.pre_call.revenuepilot_command_id,
      tenantId: hook.tenantId,
      connectionId: connection._id,
      kind: "call",
    }).lean();
    if (!command) throw new Error("CALL_COMMAND_NOT_MAPPED");
    await transaction(async (session) => {
      const lead = await Lead.findOne({
        _id: command.leadId,
        tenantId: hook.tenantId,
        erasedAt: { $exists: false },
      })
        .session(session)
        .lean();
      if (!lead) throw new Error("CONTACT_UNAVAILABLE");
      const old = await CallRecord.exists({
        tenantId: hook.tenantId,
        connectionId: connection._id,
        externalId: value.call_id,
      }).session(session);
      if (!old) {
        await CallRecord.create(
          [
            {
              tenantId: hook.tenantId,
              leadId: lead._id,
              connectionId: connection._id,
              commandId: command._id,
              externalId: value.call_id,
              status: value.status,
              durationSeconds: value.duration_s,
              endedAt: new Date(value.ended_at),
              summaryCipher: seal(
                value.summary,
                config.DATA_ENCRYPTION_KEY,
                hook.tenantId,
              ),
              transcriptCipher: seal(
                value.transcript ?? [],
                config.DATA_ENCRYPTION_KEY,
                hook.tenantId,
              ),
            },
          ],
          { session },
        );
        await Lead.updateOne(
          { tenantId: hook.tenantId, _id: lead._id },
          { $max: { lastContactAt: new Date(value.ended_at) } },
          { session },
        );
        await milestone(
          hook.tenantId,
          lead._id,
          "contact_attempted",
          `call:${value.call_id}`,
          "provider_report",
          session,
          new Date(value.ended_at),
        );
        if (value.status === "completed")
          await milestone(
            hook.tenantId,
            lead._id,
            "connected",
            `connected-call:${value.call_id}`,
            "provider_report",
            session,
            new Date(value.ended_at),
          );
        await timeline(
          hook.tenantId,
          lead._id,
          "call.ended.v1",
          `AI call ${value.status}`,
          `${value.duration_s} seconds. Provider-reported evidence.`,
          "provider-worker",
          session,
        );
      }
    });
  } else if (connection.provider === "whatsapp") {
    const value = z
      .object({
        object: z.literal("whatsapp_business_account"),
        entry: z.array(
          z
            .object({
              changes: z.array(
                z
                  .object({
                    value: z
                      .object({
                        metadata: z.object({ phone_number_id: z.string() }),
                        statuses: z
                          .array(
                            z
                              .object({
                                id: z.string(),
                                status: z.enum([
                                  "sent",
                                  "delivered",
                                  "read",
                                  "failed",
                                ]),
                                timestamp: z.string(),
                              })
                              .passthrough(),
                          )
                          .optional(),
                        messages: z
                          .array(
                            z
                              .object({
                                from: z.string(),
                                text: z.object({ body: z.string() }).optional(),
                              })
                              .passthrough(),
                          )
                          .optional(),
                      })
                      .passthrough(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ),
      })
      .parse(payload);
    for (const entry of value.entry)
      for (const change of entry.changes) {
        if (
          change.value.metadata.phone_number_id !==
          connection.config.phoneNumberId
        )
          throw new Error("WHATSAPP_PHONE_MISMATCH");
        for (const status of change.value.statuses ?? []) {
          const command = await Command.findOne({
            tenantId: hook.tenantId,
            connectionId: connection._id,
            "result.providerReference": status.id,
          }).lean();
          if (!command) continue;
          const rank = { sent: 1, delivered: 2, read: 3, failed: 0 }[
            status.status
          ];
          await Command.updateOne(
            {
              _id: command._id,
              tenantId: hook.tenantId,
              $or: [
                { "result.deliveryRank": { $exists: false } },
                { "result.deliveryRank": { $lt: rank } },
              ],
            },
            {
              $set: {
                "result.delivery": status.status,
                "result.deliveryRank": rank,
              },
            },
          );
        }
        for (const message of change.value.messages ?? [])
          if (
            /^(stop|unsubscribe|cancel)$/i.test(message.text?.body.trim() ?? "")
          ) {
            const leads = await Lead.find({
              tenantId: hook.tenantId,
              phoneHash: lookupHash(
                message.from.replace(/\D/g, ""),
                config.DATA_ENCRYPTION_KEY,
                hook.tenantId,
              ),
            })
              .select("_id")
              .lean();
            for (const lead of leads)
              await Suppression.updateOne(
                { tenantId: hook.tenantId, leadId: lead._id },
                { $set: { reason: "whatsapp_stop" } },
                { upsert: true },
              );
          }
      }
  } else if (connection.provider === "ses") {
    if (payload.Type !== "Notification") {
      await Webhook.updateOne(
        { _id: hook._id, tenantId: hook.tenantId },
        { $set: { status: "failed", errorCode: "SNS_CONFIRM_IN_AWS_CONSOLE" } },
      );
      return;
    }
    const event = z
      .object({
        notificationType: z.string().optional(),
        eventType: z.string().optional(),
        mail: z.object({ messageId: z.string() }),
      })
      .passthrough()
      .parse(JSON.parse(payload.Message));
    const command = await Command.findOne({
      tenantId: hook.tenantId,
      connectionId: connection._id,
      "result.providerReference": event.mail.messageId,
    }).lean();
    if (command) {
      const status = event.eventType ?? event.notificationType ?? "unknown";
      await Command.updateOne(
        { _id: command._id, tenantId: hook.tenantId },
        { $set: { "result.delivery": status } },
      );
      if (["Bounce", "Complaint"].includes(status))
        await Suppression.updateOne(
          { tenantId: hook.tenantId, leadId: command.leadId },
          { $set: { reason: `ses_${status.toLowerCase()}` } },
          { upsert: true },
        );
    }
  }
  await Webhook.updateOne(
    { _id: hook._id, tenantId: hook.tenantId },
    {
      $set: { status: "processed", processedAt: new Date() },
      $unset: { payloadCipher: 1 },
    },
  );
}
