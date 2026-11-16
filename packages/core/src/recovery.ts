import { z } from "zod";
import { identifier } from "./contracts.ts";
export const recoveryPlanInput = z
  .object({
    name: z.string().trim().min(3).max(100),
    formId: identifier,
    provider: z.enum(["google_ads", "meta"]),
    segment: z.enum(["started_not_accepted", "viewed_not_accepted"]),
    membershipDays: z.number().int().min(1).max(90),
  })
  .strict();
export const recoveryPlanUpdate = z
  .object({
    status: z.enum(["draft", "paused"]),
    version: z.number().int().min(0),
  })
  .strict();
