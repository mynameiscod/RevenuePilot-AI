import type { ClientSession } from "mongoose";
import { Milestone, Touch } from "./models.ts";
export async function milestone(
  tenantId: string,
  leadId: string,
  type: string,
  eventKey: string,
  evidence: string,
  session: ClientSession,
  occurredAt = new Date(),
) {
  await Milestone.updateOne(
    { tenantId, eventKey },
    {
      $setOnInsert: { tenantId, leadId, type, eventKey, evidence, occurredAt },
    },
    { upsert: true, session },
  );
}
export function channelFor(source: string) {
  const value = source.toLowerCase();
  if (["meta", "facebook", "instagram", "fb", "meta ads"].includes(value))
    return "Meta Ads";
  if (["google", "google ads"].includes(value)) return "Google Ads";
  if (["youtube", "youtube ads"].includes(value)) return "YouTube Ads";
  if (value === "organic") return "Organic";
  if (value === "referral") return "Referral";
  if (["direct", ""].includes(value)) return "Direct";
  return "Other";
}
