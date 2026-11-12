import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import { z } from "zod";
import {
  can,
  leadInput,
  receiptInput,
  stages,
  stageLabels,
  type LeadView,
  type Overview,
  type Role,
} from "../../../packages/core/src/contracts.ts";
import {
  Lead,
  Receipt,
  Audit,
  Outbox,
  Idempotency,
  Connection,
  WebEvent,
  Tenant,
} from "./models.ts";
import { digest, lookupHash, seal, unseal } from "./security.ts";
import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { leadScope, type AuthContext } from "./auth.ts";
import type { Config } from "./config.ts";

export async function audit(
  auth: AuthContext,
  action: string,
  targetId: string,
  requestId: string,
  session: ClientSession,
) {
  await Audit.create(
    [
      {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action,
        targetId,
        requestId,
      },
    ],
    { session },
  );
}
export async function timeline(
  tenantId: string,
  leadId: string,
  type: string,
  title: string,
  detail: string,
  actorId: string,
  session: ClientSession,
) {
  await Outbox.create(
    [
      {
        tenantId,
        kind: "timeline",
        payload: {
          leadId,
          type,
          title,
          detail,
          actorId,
          occurredAt: new Date().toISOString(),
        },
      },
    ],
    { session },
  );
}
export function leadView(lead: any, role: Role, key: string): LeadView {
  const contact =
    can(role, "pii.read") && lead.contactCipher
      ? unseal<{ email: string; phone: string }>(
          lead.contactCipher,
          key,
          lead.tenantId,
        )
      : { email: "", phone: "" };
  return {
    id: lead._id,
    name: can(role, "pii.read") ? lead.name : `${lead.name.charAt(0)}•••`,
    email: contact.email,
    phone: contact.phone,
    course: lead.course,
    channel: lead.channel,
    campaign: lead.campaign,
    stage: lead.stage,
    assignedTo: lead.assignedTo,
    version: lead.version,
    createdAt: new Date(lead.createdAt).toISOString(),
    updatedAt: new Date(lead.updatedAt).toISOString(),
    lastContactAt: lead.lastContactAt?.toISOString(),
    note: can(role, "pii.read") ? lead.note : "",
  };
}
export async function idempotent<T>(
  auth: AuthContext,
  route: string,
  key: string,
  input: unknown,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw new AppError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Provide an Idempotency-Key of 8–100 letters, numbers, hyphens or underscores.",
    );
  const scope = {
      tenantId: auth.tenantId!,
      principalId: auth.userId,
      route,
      key,
    },
    requestHash = digest(JSON.stringify(input));
  const replay = async () => {
    const record = await Idempotency.findOne(scope).lean();
    if (!record) return undefined;
    if (record.requestHash !== requestHash)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This operation key was already used with a different request.",
      );
    return record.response as T;
  };
  const existing = await replay();
  if (existing !== undefined) return existing;
  try {
    return await transaction(async (session) => {
      const result = await work(session);
      await Idempotency.create([{ ...scope, requestHash, response: result }], {
        session,
      });
      return result;
    });
  } catch (error: any) {
    if (error.code === 11000) {
      const result = await replay();
      if (result !== undefined) return result;
    }
    throw error;
  }
}
export async function createLead(
  auth: AuthContext,
  input: z.infer<typeof leadInput>,
  requestId: string,
  config: Config,
  session: ClientSession,
) {
  const { email, phone, ...fields } = input;
  const [lead] = await Lead.create(
    [
      {
        tenantId: auth.tenantId,
        ...fields,
        contactCipher: seal(
          { email: email ?? "", phone: phone ?? "" },
          config.DATA_ENCRYPTION_KEY,
          auth.tenantId!,
        ),
        emailHash: email
          ? lookupHash(email, config.DATA_ENCRYPTION_KEY, auth.tenantId!)
          : undefined,
        assignedTo: auth.userId,
      },
    ],
    { session },
  );
  await timeline(
    auth.tenantId!,
    lead._id,
    "lead.created.v1",
    "Enquiry received",
    `${input.course} · ${input.channel}`,
    auth.userId,
    session,
  );
  await audit(auth, "lead.created", lead._id, requestId, session);
  // Durable HTTP receipts retain identifiers, never decrypted contact fields.
  return { id: lead._id };
}
export async function createReceipt(
  auth: AuthContext,
  input: z.infer<typeof receiptInput>,
  requestId: string,
  session: ClientSession,
) {
  const lead = await Lead.findOne({
    tenantId: auth.tenantId,
    _id: input.leadId,
  })
    .session(session)
    .lean();
  if (!lead)
    throw new AppError(
      404,
      "LEAD_NOT_FOUND",
      "Lead not found in this workspace.",
    );
  let channel = lead.channel;
  if (input.kind === "refund") {
    if (!input.originalReceiptId)
      throw new AppError(
        422,
        "ORIGINAL_REQUIRED",
        "Select the original captured receipt.",
      );
    const capture = await Receipt.findOne({
      tenantId: auth.tenantId,
      _id: input.originalReceiptId,
      leadId: input.leadId,
      kind: "capture",
      currency: input.currency,
    })
      .session(session)
      .lean();
    if (!capture)
      throw new AppError(
        422,
        "CAPTURE_NOT_FOUND",
        "The original capture, lead and currency must match.",
      );
    const total = BigInt(capture.refundedMinor) + BigInt(input.amountMinor);
    if (total > BigInt(capture.amountMinor))
      throw new AppError(
        422,
        "REFUND_EXCEEDS_CAPTURE",
        "Refunds cannot exceed the captured amount.",
      );
    const updated = await Receipt.updateOne(
      {
        tenantId: auth.tenantId,
        _id: capture._id,
        refundedMinor: capture.refundedMinor,
      },
      { $set: { refundedMinor: total.toString() } },
      { session },
    );
    if (!updated.modifiedCount)
      throw new AppError(
        409,
        "CONCURRENT_REFUND",
        "The receipt changed; refresh before retrying.",
      );
    channel = capture.channel;
  } else if (input.originalReceiptId)
    throw new AppError(
      422,
      "INVALID_CAPTURE",
      "Captures cannot reference another receipt.",
    );
  const id = randomUUID();
  await Receipt.create(
    [
      {
        _id: id,
        tenantId: auth.tenantId,
        ...input,
        channel,
        recordedBy: auth.userId,
      },
    ],
    { session },
  );
  await timeline(
    auth.tenantId!,
    lead._id,
    `payment.${input.kind}.v1`,
    input.kind === "capture" ? "Receipt recorded" : "Refund recorded",
    `${input.currency} ${(BigInt(input.amountMinor) / 100n).toString()} · manual evidence`,
    auth.userId,
    session,
  );
  await audit(auth, `revenue.${input.kind}.recorded`, id, requestId, session);
  return { id };
}
export async function overview(
  auth: AuthContext,
  days: number,
): Promise<Overview> {
  const now = new Date(),
    start = new Date(now.getTime() - days * 86400000),
    scope = leadScope(auth);
  const [rows, receipts, tenant, connectionCount, tracking] = await Promise.all(
    [
      Lead.find({ ...scope, createdAt: { $gte: start } })
        .select("-note")
        .lean(),
      can(auth.role!, "revenue.read")
        ? Receipt.find({
            tenantId: auth.tenantId,
            createdAt: { $gte: start },
          }).lean()
        : [],
      Tenant.findById(auth.tenantId).lean(),
      Connection.countDocuments({ tenantId: auth.tenantId }),
      auth.role !== "counselor"
        ? WebEvent.aggregate([
            { $match: { tenantId: auth.tenantId, createdAt: { $gte: start } } },
            { $group: { _id: "$type", count: { $sum: 1 } } },
          ])
        : [],
    ],
  );
  const cash: Overview["cashByCurrency"] = {};
  for (const r of receipts) {
    cash[r.currency] ??= { gross: "0", refunds: "0", net: "0" };
    const c = cash[r.currency],
      amount = BigInt(r.amountMinor);
    c[r.kind === "capture" ? "gross" : "refunds"] = (
      BigInt(c[r.kind === "capture" ? "gross" : "refunds"]) + amount
    ).toString();
    c.net = (BigInt(c.gross) - BigInt(c.refunds)).toString();
  }
  const channelNames = [
    ...new Set([
      ...rows.map((l) => l.channel),
      ...receipts.map((r) => r.channel),
    ]),
  ];
  const channelRows = channelNames
    .map((name) => {
      const leads = rows.filter((l) => l.channel === name);
      return {
        name,
        leads: leads.length,
        qualified: leads.filter((l) =>
          ["qualified", "demo", "enrolled"].includes(l.stage),
        ).length,
        enrolled: leads.filter((l) => l.stage === "enrolled").length,
        cash: receipts
          .filter((r) => r.channel === name && r.currency === tenant?.currency)
          .reduce(
            (s, r) =>
              s + BigInt(r.amountMinor) * (r.kind === "capture" ? 1n : -1n),
            0n,
          )
          .toString(),
      };
    })
    .sort((a, b) => b.leads - a.leads);
  const trend = Array.from({ length: days }, (_, i) => {
    const date = new Date(now.getTime() - (days - 1 - i) * 86400000)
      .toISOString()
      .slice(0, 10);
    const leads = rows.filter((l) =>
      l.createdAt.toISOString().startsWith(date),
    );
    return {
      date,
      leads: leads.length,
      enrolled: leads.filter((l) => l.stage === "enrolled").length,
    };
  });
  const count = (type: string) =>
    tracking.find((t) => t._id === type)?.count ?? 0;
  return {
    asOf: now.toISOString(),
    range: days,
    leadCount: rows.length,
    qualifiedCount: rows.filter((l) =>
      ["qualified", "demo", "enrolled"].includes(l.stage),
    ).length,
    enrolledCount: rows.filter((l) => l.stage === "enrolled").length,
    uncontactedCount: rows.filter((l) => !l.lastContactAt && l.stage === "new")
      .length,
    overdueCount: rows.filter(
      (l) =>
        !l.lastContactAt &&
        l.stage === "new" &&
        +now - +l.createdAt > (tenant?.firstResponseMinutes ?? 15) * 60000,
    ).length,
    cashByCurrency: cash,
    stages: stages.map((key) => ({
      key,
      label: stageLabels[key],
      count: rows.filter((l) => l.stage === key).length,
    })),
    channels: channelRows,
    trend,
    tracking: {
      pageViews: count("page.viewed.v1"),
      formStarts: count("form.started.v1"),
      submitAttempts: count("form.submitted.v1"),
    },
    connections: { configured: connectionCount, live: 0 },
  };
}
