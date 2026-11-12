import mongoose, { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
const options = {
  timestamps: true,
  strict: "throw",
  versionKey: false,
} as const;
const id = { type: String, default: () => randomUUID() };
const tenantId = { type: String, required: true, immutable: true };
function model<const T extends Record<string, any>>(
  name: string,
  fields: T,
  indexes: [Record<string, any>, Record<string, any>?][] = [],
) {
  const schema = new Schema({ _id: id, tenantId, ...fields }, options);
  for (const [keys, config] of indexes) schema.index(keys, config);
  return mongoose.model(name, schema);
}
export const Form = model(
  "JourneyForm",
  {
    publicKey: { type: String, required: true },
    name: String,
    course: String,
    amountMinor: String,
    currency: { type: String, enum: ["INR", "USD", "AED"] },
    origins: [String],
    ownerId: String,
    assignees: [String],
    sequence: { type: Number, default: 0 },
    consentVersion: { type: String, default: "1" },
    active: { type: Boolean, default: true },
    paymentConnectionId: String,
  },
  [[{ publicKey: 1 }, { unique: true }], [{ tenantId: 1, createdAt: -1 }]],
);
export const Attempt = model(
  "JourneyAttempt",
  {
    formId: String,
    attemptId: String,
    anonymousId: String,
    path: String,
    viewedAt: Date,
    startedAt: Date,
    submittedAt: Date,
    acceptedAt: Date,
    leadId: String,
    trackingConsent: Boolean,
    marketingConsent: Boolean,
    touch: Schema.Types.Mixed,
    expiresAt: Date,
  },
  [
    [{ tenantId: 1, formId: 1, attemptId: 1 }, { unique: true }],
    [{ tenantId: 1, createdAt: -1 }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export const Acceptance = model(
  "LeadAcceptance",
  {
    formId: String,
    attemptId: String,
    requestHash: String,
    leadId: String,
    tokenHash: { type: String, required: true },
    expiresAt: Date,
  },
  [
    [{ tenantId: 1, formId: 1, attemptId: 1 }, { unique: true }],
    [{ tokenHash: 1 }, { unique: true }],
  ],
);
export const Identity = model(
  "LeadIdentity",
  {
    identityHash: String,
    course: String,
    leadId: String,
  },
  [[{ tenantId: 1, identityHash: 1, course: 1 }, { unique: true }]],
);
export const Touch = model(
  "AttributionTouch",
  {
    leadId: String,
    eventKey: String,
    source: String,
    medium: String,
    campaign: String,
    accountId: String,
    campaignId: String,
    adId: String,
    clickIds: Schema.Types.Mixed,
    occurredAt: Date,
    eligible: Boolean,
  },
  [
    [{ tenantId: 1, eventKey: 1 }, { unique: true }],
    [{ tenantId: 1, leadId: 1, occurredAt: 1 }],
  ],
);
export const Milestone = model(
  "JourneyMilestone",
  {
    leadId: String,
    type: String,
    evidence: String,
    eventKey: String,
    occurredAt: Date,
  },
  [
    [{ tenantId: 1, eventKey: 1 }, { unique: true }],
    [{ tenantId: 1, leadId: 1, type: 1 }],
  ],
);
export const Consent = model(
  "ConsentRecord",
  {
    leadId: String,
    formId: String,
    version: String,
    purpose: String,
    granted: Boolean,
    occurredAt: Date,
  },
  [[{ tenantId: 1, leadId: 1, purpose: 1, occurredAt: -1 }]],
);
export const Suppression = model(
  "ContactSuppression",
  {
    leadId: String,
    reason: String,
  },
  [[{ tenantId: 1, leadId: 1 }, { unique: true }]],
);
export const Followup = model(
  "FollowupTask",
  {
    leadId: String,
    assignedTo: String,
    title: String,
    dueAt: Date,
    status: {
      type: String,
      enum: ["open", "done", "cancelled"],
      default: "open",
    },
    outcome: String,
    completedAt: Date,
    eventKey: String,
  },
  [
    [{ tenantId: 1, eventKey: 1 }, { unique: true }],
    [{ tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 }],
  ],
);
export const Appointment = model(
  "DemoAppointment",
  {
    leadId: String,
    hostId: String,
    scheduledAt: Date,
    durationMinutes: Number,
    status: {
      type: String,
      enum: ["scheduled", "attended", "no_show", "cancelled"],
      default: "scheduled",
    },
    outcome: String,
    note: String,
    version: { type: Number, default: 1 },
  },
  [
    [{ tenantId: 1, leadId: 1, scheduledAt: -1 }],
    [
      { tenantId: 1, hostId: 1, scheduledAt: 1 },
      { unique: true, partialFilterExpression: { status: "scheduled" } },
    ],
  ],
);
export const PaymentOrder = model(
  "PaymentOrder",
  {
    leadId: String,
    formId: String,
    amountMinor: String,
    currency: String,
    connectionId: String,
    provider: String,
    mode: { type: String, enum: ["sandbox", "test", "live"] },
    status: {
      type: String,
      enum: ["created", "pending", "paid", "refunded", "failed", "unknown"],
      default: "created",
    },
    externalId: String,
    externalPaymentId: String,
    checkoutUrl: String,
    receiptId: String,
    requestKey: String,
    settledAt: Date,
  },
  [
    [{ tenantId: 1, requestKey: 1 }, { unique: true }],
    [{ tenantId: 1, leadId: 1 }],
    [{ connectionId: 1, externalId: 1 }],
  ],
);
export const Enrollment = model(
  "EnrollmentEvidence",
  {
    leadId: String,
    course: String,
    orderId: String,
    evidence: String,
    status: {
      type: String,
      enum: ["confirmed", "review_required"],
      default: "confirmed",
    },
    confirmedAt: Date,
  },
  [
    [{ tenantId: 1, orderId: 1 }, { unique: true }],
    [{ tenantId: 1, leadId: 1 }],
  ],
);
export const Webhook = model(
  "ProviderWebhook",
  {
    connectionId: String,
    externalId: String,
    bodyHash: String,
    status: {
      type: String,
      enum: ["received", "processing", "processed", "ignored", "failed"],
      default: "received",
    },
    attempts: { type: Number, default: 0 },
    leaseUntil: Date,
    payloadCipher: { type: String, select: false },
    errorCode: String,
    processedAt: Date,
  },
  [
    [{ connectionId: 1, externalId: 1 }, { unique: true }],
    [{ status: 1, createdAt: 1 }],
  ],
);
export const AdSpend = model(
  "CampaignSpend",
  {
    connectionId: String,
    accountId: String,
    source: String,
    campaign: String,
    campaignId: String,
    adId: String,
    date: String,
    currency: String,
    amountMinor: String,
    clicks: Number,
    impressions: Number,
    evidence: String,
  },
  [
    [
      {
        tenantId: 1,
        connectionId: 1,
        campaignId: 1,
        adId: 1,
        date: 1,
        currency: 1,
      },
      { unique: true },
    ],
  ],
);
export const Command = model(
  "ProviderCommand",
  {
    leadId: String,
    connectionId: String,
    kind: String,
    payloadCipher: { type: String, select: false },
    status: {
      type: String,
      enum: [
        "pending_approval",
        "queued",
        "running",
        "succeeded",
        "failed",
        "unknown",
        "cancelled",
      ],
      default: "pending_approval",
    },
    requestedBy: String,
    approvedBy: String,
    idempotencyKey: String,
    requestHash: String,
    connectionVersion: Number,
    notBefore: Date,
    leaseUntil: Date,
    completedAt: Date,
    attempts: { type: Number, default: 0 },
    result: Schema.Types.Mixed,
    errorCode: String,
  },
  [
    [{ tenantId: 1, idempotencyKey: 1 }, { unique: true }],
    [{ status: 1, notBefore: 1 }],
  ],
);
export const IntegrationLink = model(
  "IntegrationLink",
  {
    connectionId: String,
    externalId: String,
    leadId: String,
  },
  [[{ tenantId: 1, connectionId: 1, externalId: 1 }, { unique: true }]],
);
export const Usage = model(
  "UsageCounter",
  { period: String, metric: String, count: { type: Number, default: 0 } },
  [[{ tenantId: 1, period: 1, metric: 1 }, { unique: true }]],
);
export const Mail = model(
  "AccountMail",
  {
    userId: String,
    recipient: String,
    subject: String,
    bodyCipher: { type: String, select: false },
    status: { type: String, default: "pending" },
    sentAt: Date,
  },
  [[{ tenantId: 1, createdAt: -1 }]],
);
export const Token = model(
  "AccountToken",
  {
    userId: String,
    email: String,
    kind: String,
    tokenHash: String,
    role: String,
    usedAt: Date,
    expiresAt: Date,
  },
  [
    [{ tokenHash: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export const Billing = model(
  "TenantSubscription",
  {
    providerCustomerId: String,
    providerSubscriptionId: String,
    priceId: String,
    status: String,
    periodEnd: Date,
    checkoutKey: String,
    checkoutUrl: String,
    checkoutExpiresAt: Date,
  },
  [
    [{ tenantId: 1 }, { unique: true }],
    [{ providerCustomerId: 1 }, { unique: true, sparse: true }],
  ],
);
export const SyncRun = model(
  "ConnectorSyncRun",
  {
    connectionId: String,
    kind: String,
    status: String,
    cursor: String,
    imported: Number,
    rejected: Number,
    rejectionIds: [String],
    errorCode: String,
    finishedAt: Date,
  },
  [[{ tenantId: 1, connectionId: 1, createdAt: -1 }]],
);
export const CallRecord = model(
  "ProviderCallRecord",
  {
    connectionId: String,
    commandId: String,
    leadId: String,
    externalId: String,
    status: String,
    durationSeconds: Number,
    endedAt: Date,
    summaryCipher: { type: String, select: false },
    transcriptCipher: { type: String, select: false },
  },
  [[{ tenantId: 1, connectionId: 1, externalId: 1 }, { unique: true }]],
);
export const allJourneyModels = [
  Form,
  Attempt,
  Acceptance,
  Identity,
  Touch,
  Milestone,
  Consent,
  Suppression,
  Followup,
  Appointment,
  PaymentOrder,
  Enrollment,
  Webhook,
  AdSpend,
  Command,
  IntegrationLink,
  Usage,
  Mail,
  Token,
  Billing,
  SyncRun,
  CallRecord,
];
