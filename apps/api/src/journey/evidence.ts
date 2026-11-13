import type { ClientSession } from "mongoose";
import { Milestone, Touch } from "./models.ts";
import { classifySource } from "../../../../packages/core/src/marketing.ts";
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
export const channelFor = classifySource;
