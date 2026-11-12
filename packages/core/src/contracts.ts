import { z } from "zod";

export const roles = [
  "owner",
  "admin",
  "analyst",
  "counselor",
  "finance",
  "viewer",
] as const;
export type Role = (typeof roles)[number];
export const stages = [
  "new",
  "contacting",
  "qualified",
  "demo",
  "enrolled",
  "lost",
] as const;
export type Stage = (typeof stages)[number];
export const stageLabels: Record<Stage, string> = {
  new: "New lead",
  contacting: "In conversation",
  qualified: "Qualified",
  demo: "Demo scheduled",
  enrolled: "Enrolled",
  lost: "Closed lost",
};
export const channels = [
  "Meta Ads",
  "Google Ads",
  "YouTube Ads",
  "Organic",
  "Referral",
  "Direct",
  "Other",
] as const;
export const permissions: Record<Role, readonly string[]> = {
  owner: [
    "leads.read",
    "leads.write",
    "pii.read",
    "revenue.read",
    "revenue.write",
    "connections.write",
    "settings.write",
    "audit.read",
    "members.read",
  ],
  admin: [
    "leads.read",
    "leads.write",
    "pii.read",
    "revenue.read",
    "revenue.write",
    "connections.write",
    "settings.write",
    "audit.read",
    "members.read",
  ],
  analyst: ["leads.read", "revenue.read"],
  counselor: ["leads.read", "leads.write", "pii.read"],
  finance: ["leads.read", "revenue.read", "revenue.write"],
  viewer: ["leads.read"],
};
export function can(role: Role, permission: string) {
  return permissions[role].includes(permission);
}
export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const moneyMinor = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .refine(
    (v) => /^[1-9]\d{0,15}$/.test(v) && BigInt(v) <= 9_000_000_000_000_000n,
    "Use a positive integer amount within the supported range",
  );
export const registrationInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .email()
      .max(254)
      .transform((s) => s.trim().toLowerCase()),
    password: z.string().min(12).max(128),
    workspaceName: z.string().trim().min(2).max(100),
  })
  .strict();
export const loginInput = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.trim().toLowerCase()),
    password: z.string().min(1).max(128),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z
      .string()
      .regex(/^[A-Fa-f0-9-]{20,24}$/)
      .optional(),
  })
  .strict();
export const leadInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.email().max(254).optional().or(z.literal("")),
    phone: z
      .string()
      .regex(/^\+?[0-9 ()-]{7,25}$/)
      .optional()
      .or(z.literal("")),
    course: z.string().trim().min(2).max(100),
    channel: z.enum(channels),
    campaign: z.string().trim().max(120).default(""),
    note: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine((v) => v.email || v.phone, "Provide an email or phone number");
export const stageInput = z
  .object({
    stage: z.enum(stages),
    note: z.string().trim().min(2).max(1000),
    version: z.number().int().min(1),
  })
  .strict();
export const receiptInput = z
  .object({
    leadId: identifier,
    kind: z.enum(["capture", "refund"]),
    amountMinor: moneyMinor,
    currency: z.enum(["INR", "USD", "AED"]),
    reference: z.string().trim().min(3).max(120),
    originalReceiptId: identifier.optional(),
    note: z.string().trim().min(3).max(500),
  })
  .strict();
export const settingsInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    timezone: z.enum(["Asia/Kolkata", "Asia/Dubai", "America/New_York", "UTC"]),
    currency: z.enum(["INR", "USD", "AED"]),
    firstResponseMinutes: z.number().int().min(1).max(1440),
    attributionModel: z.enum(["first_touch", "last_touch", "linear"]),
    retentionDays: z.number().int().min(30).max(365).optional(),
  })
  .strict();
export const connectionInput = z
  .object({
    provider: identifier,
    label: z.string().trim().min(2).max(100),
    accountId: z.string().trim().max(150).default(""),
    credentials: z.record(z.string().max(80), z.string().max(8000)).default({}),
  })
  .strict();
export const siteInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    origins: z
      .array(
        z.url().refine((v) => {
          const u = new URL(v);
          return (
            u.origin === v &&
            (u.protocol === "https:" ||
              (u.protocol === "http:" &&
                ["localhost", "127.0.0.1"].includes(u.hostname)))
          );
        }, "Use an exact HTTPS origin, or localhost for development"),
      )
      .min(1)
      .max(10),
  })
  .strict();
const browserEventBase = z.object({
  eventId: identifier,
  occurredAt: z.iso.datetime(),
  sessionId: identifier,
  anonymousId: identifier,
  path: z
    .string()
    .max(500)
    .regex(/^\/[^?#]*$/),
  consent: z.literal("granted"),
});
export const browserEventInput = z.discriminatedUnion("type", [
  browserEventBase
    .extend({
      type: z.literal("page.viewed.v1"),
      payload: z.object({}).strict(),
    })
    .strict(),
  ...(["form.viewed.v1", "form.started.v1", "form.submitted.v1"] as const).map(
    (type) =>
      browserEventBase
        .extend({
          type: z.literal(type),
          payload: z
            .object({ formId: identifier, attemptId: identifier })
            .strict(),
        })
        .strict(),
  ),
]);
export const collectInput = z
  .object({
    siteKey: z.string().min(20).max(100),
    events: z.array(browserEventInput).min(1).max(50),
  })
  .strict();
export type BrowserEvent = z.infer<typeof browserEventInput>;
export const cents = (value: string): bigint => BigInt(value);
export function allocate(
  amount: bigint,
  ids: string[],
): Record<string, string> {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return { unattributed: amount.toString() };
  const sign = amount < 0n ? -1n : 1n,
    abs = amount * sign;
  const base = abs / BigInt(sorted.length),
    remainder = Number(abs % BigInt(sorted.length));
  return Object.fromEntries(
    sorted.map((id, i) => [
      id,
      ((base + (i < remainder ? 1n : 0n)) * sign).toString(),
    ]),
  );
}

export interface LeadView {
  id: string;
  name: string;
  email: string;
  phone: string;
  course: string;
  channel: string;
  campaign: string;
  stage: Stage;
  assignedTo: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastContactAt?: string;
  note: string;
}
export interface TenantView {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  role: Role;
  demo: boolean;
  retentionDays: number;
  firstResponseMinutes: number;
  attributionModel: string;
}
export interface SessionView {
  user: {
    id: string;
    name: string;
    email: string;
    mfaEnabled: boolean;
    emailVerified: boolean;
  };
  tenants: TenantView[];
  csrfToken: string;
}
export interface ReceiptView {
  id: string;
  leadId: string;
  leadName: string;
  course: string;
  kind: "capture" | "refund";
  amountMinor: string;
  currency: string;
  reference: string;
  createdAt: string;
  channel: string;
  evidence: string;
  originalReceiptId?: string;
}
export interface Overview {
  asOf: string;
  range: number;
  leadCount: number;
  qualifiedCount: number;
  enrolledCount: number;
  uncontactedCount: number;
  overdueCount: number;
  cashByCurrency: Record<
    string,
    { gross: string; refunds: string; net: string }
  >;
  stages: { key: Stage; label: string; count: number }[];
  channels: {
    name: string;
    leads: number;
    qualified: number;
    enrolled: number;
    cash: string;
  }[];
  trend: { date: string; leads: number; enrolled: number }[];
  tracking: { pageViews: number; formStarts: number; submitAttempts: number };
  connections: { configured: number; live: number };
}
