import mongoose, { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import { roles, stages } from "../../../packages/core/src/contracts.ts";

const id = { type: String, default: () => randomUUID() };
const tenantId = { type: String, required: true, immutable: true };
const options = {
  timestamps: true,
  versionKey: false,
  strict: "throw",
} as const;
function make<T extends Schema>(name: string, schema: T, collection: string) {
  return mongoose.model(name, schema, collection);
}
const user = new Schema(
  {
    _id: id,
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    mfaSecret: { type: String, select: false },
    pendingMfaSecret: { type: String, select: false },
    mfaEnabled: { type: Boolean, default: false },
    lastMfaStep: { type: Number, default: -1 },
    emailVerifiedAt: Date,
    recoveryCodes: { type: [String], default: [], select: false },
  },
  options,
);
export const User = make("User", user, "users");
export const Tenant = make(
  "Tenant",
  new Schema(
    {
      _id: id,
      name: { type: String, required: true },
      currency: { type: String, default: "INR", enum: ["INR", "USD", "AED"] },
      timezone: { type: String, default: "Asia/Kolkata" },
      demo: { type: Boolean, default: false },
      firstResponseMinutes: { type: Number, default: 15 },
      attributionModel: { type: String, default: "first_touch" },
      lockVersion: { type: Number, default: 0 },
      plan: {
        type: String,
        enum: ["pilot", "growth", "scale"],
        default: "pilot",
      },
      retentionDays: { type: Number, default: 90 },
      billingStatus: { type: String, default: "trial" },
    },
    options,
  ),
  "tenants",
);
const membership = new Schema(
  {
    _id: id,
    tenantId,
    userId: { type: String, required: true },
    role: { type: String, enum: roles, required: true },
    status: { type: String, enum: ["active", "revoked"], default: "active" },
  },
  options,
);
membership.index({ tenantId: 1, userId: 1 }, { unique: true });
membership.index({ userId: 1, status: 1 });
export const Membership = make("Membership", membership, "memberships");
const session = new Schema(
  {
    _id: id,
    userId: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    csrfToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    authenticatedAt: { type: Date, required: true },
  },
  options,
);
session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = make("Session", session, "auth_sessions");
const lead = new Schema(
  {
    _id: id,
    tenantId,
    name: { type: String, required: true },
    contactCipher: { type: String, required: true, select: false },
    emailHash: { type: String },
    phoneHash: { type: String },
    course: { type: String, required: true },
    channel: { type: String, required: true },
    campaign: { type: String, default: "" },
    stage: { type: String, enum: stages, default: "new" },
    assignedTo: { type: String, required: true },
    version: { type: Number, default: 1 },
    lastContactAt: Date,
    note: { type: String, default: "" },
    formId: String,
    erasedAt: Date,
    lossReason: String,
  },
  options,
);
lead.index({ tenantId: 1, createdAt: -1, _id: -1 });
lead.index({ tenantId: 1, stage: 1, assignedTo: 1 });
lead.index({ tenantId: 1, emailHash: 1 });
lead.index({ tenantId: 1, phoneHash: 1 });
export const Lead = make("Lead", lead, "leads");
const receipt = new Schema(
  {
    _id: id,
    tenantId,
    leadId: { type: String, required: true },
    kind: { type: String, enum: ["capture", "refund"], required: true },
    amountMinor: { type: String, required: true },
    currency: { type: String, required: true },
    reference: { type: String, required: true },
    originalReceiptId: String,
    refundedMinor: { type: String, default: "0" },
    note: { type: String, required: true },
    recordedBy: { type: String, required: true },
    channel: { type: String, required: true },
    evidence: { type: String, default: "manual_record" },
    paymentOrderId: String,
    providerEventId: String,
  },
  options,
);
receipt.index({ tenantId: 1, reference: 1 }, { unique: true });
receipt.index({ tenantId: 1, createdAt: -1, _id: -1 });
export const Receipt = make("Receipt", receipt, "revenue_ledger");
const connection = new Schema(
  {
    _id: id,
    tenantId,
    provider: { type: String, required: true },
    label: { type: String, required: true },
    accountId: { type: String, default: "" },
    credentialCipher: { type: String, select: false },
    credentialKeys: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["draft", "test", "active", "paused"],
      default: "draft",
    },
    mode: { type: String, enum: ["test", "live"], default: "test" },
    config: { type: Schema.Types.Mixed, default: {} },
    health: { type: Schema.Types.Mixed, default: {} },
    version: { type: Number, default: 1 },
  },
  options,
);
connection.index({ tenantId: 1, provider: 1, accountId: 1 }, { unique: true });
export const Connection = make("Connection", connection, "connections");
const audit = new Schema(
  {
    _id: id,
    tenantId,
    actorId: { type: String, required: true },
    action: { type: String, required: true },
    targetId: { type: String, required: true },
    requestId: { type: String, required: true },
  },
  options,
);
audit.index({ tenantId: 1, createdAt: -1 });
export const Audit = make("Audit", audit, "audit_logs");
const event = new Schema(
  {
    _id: id,
    tenantId,
    leadId: String,
    type: { type: String, required: true },
    title: { type: String, required: true },
    detail: { type: String, default: "" },
    occurredAt: { type: Date, required: true },
    actorId: String,
  },
  options,
);
event.index({ tenantId: 1, leadId: 1, occurredAt: -1 });
export const Event = make("Event", event, "events");
const outbox = new Schema(
  {
    _id: id,
    tenantId,
    kind: { type: String, enum: ["timeline"], required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    processedAt: Date,
    attempts: { type: Number, default: 0 },
    lastError: String,
  },
  options,
);
outbox.index({ processedAt: 1, createdAt: 1 });
export const Outbox = make("Outbox", outbox, "outbox");
const idempotency = new Schema(
  {
    _id: id,
    tenantId,
    principalId: { type: String, required: true },
    route: { type: String, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    response: { type: Schema.Types.Mixed, required: true },
  },
  options,
);
idempotency.index(
  { tenantId: 1, principalId: 1, route: 1, key: 1 },
  { unique: true },
);
export const Idempotency = make(
  "Idempotency",
  idempotency,
  "idempotency_records",
);
const site = new Schema(
  {
    _id: id,
    tenantId,
    name: { type: String, required: true },
    publicKey: { type: String, required: true, unique: true },
    origins: { type: [String], required: true },
    active: { type: Boolean, default: true },
  },
  options,
);
site.index({ tenantId: 1, createdAt: -1 });
export const Site = make("Site", site, "sites");
const webEvent = new Schema(
  {
    _id: id,
    tenantId,
    siteId: { type: String, required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    sessionId: { type: String, required: true },
    anonymousId: { type: String, required: true },
    path: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    occurredAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  options,
);
webEvent.index({ tenantId: 1, siteId: 1, eventId: 1 }, { unique: true });
webEvent.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
webEvent.index({ tenantId: 1, createdAt: -1, type: 1 });
export const WebEvent = make("WebEvent", webEvent, "web_events");
const bucket = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
bucket.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RateBucket = make("RateBucket", bucket, "rate_buckets");
export const allModels = [
  User,
  Tenant,
  Membership,
  Session,
  Lead,
  Receipt,
  Connection,
  Audit,
  Event,
  Outbox,
  Idempotency,
  Site,
  WebEvent,
  RateBucket,
];
