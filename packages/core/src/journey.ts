import { z } from "zod";
import { identifier, moneyMinor, siteInput, leadInput } from "./contracts.ts";
export const touchInput = z
  .object({
    source: z.string().trim().max(80).default("Direct"),
    medium: z.string().trim().max(80).default(""),
    campaign: z.string().trim().max(120).default(""),
    accountId: z.string().max(100).default(""),
    campaignId: z.string().max(100).default(""),
    adId: z.string().max(100).default(""),
    clickIds: z
      .object({
        gclid: z.string().max(256).optional(),
        fbclid: z.string().max(256).optional(),
        gbraid: z.string().max(256).optional(),
        wbraid: z.string().max(256).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export const formInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    course: z.string().trim().min(2).max(100),
    amountMinor: moneyMinor,
    currency: z.enum(["INR", "USD", "AED"]),
    origins: siteInput.shape.origins,
    assignees: z.array(identifier).max(30).default([]),
    consentVersion: z.string().min(1).max(30).default("1"),
  })
  .strict();
export const formEventInput = z
  .object({
    attemptId: identifier,
    anonymousId: identifier,
    type: z.enum(["viewed", "started", "submitted"]),
    path: z
      .string()
      .regex(/^\/[^?#]*$/)
      .max(500),
    trackingConsent: z.literal(true),
    touch: touchInput,
  })
  .strict();
export const submissionInput = z
  .object({
    attemptId: identifier,
    anonymousId: identifier,
    name: z.string().trim().min(2).max(100),
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase().trim()),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional()
      .or(z.literal("")),
    privacyConsent: z.literal(true),
    marketingConsent: z.boolean(),
    trackingConsent: z.boolean(),
    adConsent: z.boolean().default(false),
    consentVersion: z.string().min(1).max(30),
    touch: touchInput.optional(),
    website: z.string().max(0).default(""),
  })
  .strict();
export const contactInput = z
  .object({
    outcome: z.enum([
      "answered",
      "no_answer",
      "unreachable",
      "wrong_number",
      "not_interested",
    ]),
    note: z.string().trim().min(3).max(1000),
    nextFollowupAt: z.iso.datetime().optional(),
  })
  .strict();
export const demoInput = z
  .object({
    hostId: identifier,
    scheduledAt: z.iso.datetime(),
    durationMinutes: z.number().int().min(15).max(120).default(30),
  })
  .strict();
export const demoOutcomeInput = z
  .object({
    status: z.enum(["attended", "no_show", "cancelled"]),
    outcome: z.enum([
      "interested",
      "not_interested",
      "follow_up",
      "not_applicable",
    ]),
    note: z.string().trim().min(3).max(1000),
    version: z.number().int().min(1),
  })
  .strict();
export const planLimits = {
  pilot: { leads: 1000, seats: 5, commands: 100, forms: 10 },
  growth: { leads: 10000, seats: 25, commands: 1000, forms: 50 },
  scale: { leads: 100000, seats: 100, commands: 10000, forms: 200 },
} as const;
export const canonicalContact = leadInput;
