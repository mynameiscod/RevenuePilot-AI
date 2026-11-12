import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/);
const graphVersion = z.string().regex(/^v\d{2}\.0$/);
const common = {
  dailyActionLimit: z.number().int().min(1).max(1000).default(20),
};
export const connectionSettings = {
  meta: z
    .object({
      ...common,
      apiVersion: graphVersion,
      adAccountId: z.string().regex(/^act_\d+$/),
      pixelId: z.string().regex(/^\d+$/).optional(),
      testEventCode: z.string().max(100).optional(),
      leadFormId: z.string().regex(/^\d+$/).optional(),
      importFormId: id.optional(),
    })
    .strict(),
  google_ads: z
    .object({
      ...common,
      apiVersion: z
        .string()
        .regex(/^v\d{2}$/)
        .default("v26"),
      customerId: z.string().regex(/^\d{10}$/),
      loginCustomerId: z
        .string()
        .regex(/^\d{10}$/)
        .optional(),
      conversionActionId: z.string().regex(/^\d+$/).optional(),
    })
    .strict(),
  hubspot: z.object({ ...common, importFormId: id }).strict(),
  generic_crm: z.object({ ...common, importFormId: id }).strict(),
  outpero: z
    .object({
      ...common,
      leadIntakeUrl: z.url().refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === "https:" &&
          ["api.outpero.com", "app.outpero.com"].includes(u.hostname) &&
          /^\/lead-intake\/[A-Za-z0-9_-]+$/.test(u.pathname) &&
          !u.username &&
          !u.password &&
          !u.port &&
          !u.search &&
          !u.hash
        );
      }, "Copy the lead-intake HTTPS URL from Outpero"),
    })
    .strict(),
  stripe: z.object({ ...common }).strict(),
  razorpay: z.object({ ...common }).strict(),
  openai: z
    .object({
      ...common,
      model: id,
      maxOutputTokens: z.number().int().min(128).max(2048).default(800),
    })
    .strict(),
  anthropic: z
    .object({
      ...common,
      model: id,
      maxOutputTokens: z.number().int().min(128).max(2048).default(800),
    })
    .strict(),
  whatsapp: z
    .object({
      ...common,
      apiVersion: graphVersion,
      phoneNumberId: z.string().regex(/^\d+$/),
      wabaId: z.string().regex(/^\d+$/),
      templateName: z.string().regex(/^[a-z0-9_]{1,100}$/),
      languageCode: z
        .string()
        .regex(/^[a-z]{2}(_[A-Z]{2})?$/)
        .default("en"),
      templateBody: z
        .string()
        .min(1)
        .max(2000)
        .refine((v) => !v.includes("{{"), "Use a static approved template"),
    })
    .strict(),
  ses: z
    .object({
      ...common,
      region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
      snsTopicArn: z
        .string()
        .regex(/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/)
        .optional(),
      fromEmail: z.email(),
      subject: z.string().min(1).max(100),
      body: z.string().min(1).max(3000),
    })
    .strict(),
} satisfies Record<string, z.ZodType>;
export const requiredCredentials: Record<
  keyof typeof connectionSettings,
  string[]
> = {
  meta: ["accessToken"],
  google_ads: ["clientId", "clientSecret", "refreshToken", "developerToken"],
  hubspot: ["accessToken"],
  generic_crm: ["webhookSecret"],
  outpero: ["leadSecret", "webhookSecret"],
  stripe: ["secretKey", "webhookSecret"],
  razorpay: ["keyId", "keySecret", "webhookSecret"],
  openai: ["apiKey"],
  anthropic: ["apiKey"],
  whatsapp: ["accessToken", "appSecret", "verifyToken"],
  ses: ["accessKeyId", "secretAccessKey"],
};
export function validateConnection(
  provider: string,
  config: unknown,
  credentials: Record<string, string>,
) {
  const schema =
    connectionSettings[provider as keyof typeof connectionSettings];
  if (!schema) throw new Error("UNSUPPORTED_PROVIDER");
  const parsed = schema.parse(config);
  const required =
    requiredCredentials[provider as keyof typeof connectionSettings];
  if (required.some((key) => !credentials[key]?.trim()))
    throw new Error("MISSING_CREDENTIALS");
  return parsed;
}
