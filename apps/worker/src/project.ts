import { Event, Outbox } from "../../api/src/models.ts";
import { transaction } from "../../api/src/db.ts";

// Business deduplication lives in MongoDB, independently of BullMQ's job retention.
export async function projectOutbox(id: string) {
  await transaction(async (session) => {
    const item = await Outbox.findOne({
      _id: id,
      processedAt: { $exists: false },
    })
      .session(session)
      .lean();
    if (!item) return;
    if (item.kind !== "timeline") throw new Error("Unsupported outbox kind");
    const payload = item.payload as {
      leadId: string;
      type: string;
      title: string;
      detail: string;
      actorId: string;
      occurredAt: string;
    };
    await Event.updateOne(
      { _id: item._id, tenantId: item.tenantId },
      {
        $setOnInsert: {
          _id: item._id,
          tenantId: item.tenantId,
          leadId: payload.leadId,
          type: payload.type,
          title: payload.title,
          detail: payload.detail,
          actorId: payload.actorId,
          occurredAt: new Date(payload.occurredAt),
        },
      },
      { upsert: true, session },
    );
    await Outbox.updateOne(
      {
        _id: item._id,
        tenantId: item.tenantId,
        processedAt: { $exists: false },
      },
      { $set: { processedAt: new Date() }, $inc: { attempts: 1 } },
      { session },
    );
  });
}
export async function drainOutbox() {
  const items = await Outbox.find({ processedAt: { $exists: false } })
    .sort({ createdAt: 1 })
    .limit(100)
    .select("_id")
    .lean();
  for (const item of items) await projectOutbox(item._id);
  return items.length;
}
