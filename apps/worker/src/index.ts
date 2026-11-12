import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import mongoose from "mongoose";
import { readConfig } from "../../api/src/config.ts";
import { connectDatabase } from "../../api/src/db.ts";
import { Outbox } from "../../api/src/models.ts";
import { projectOutbox } from "./project.ts";

const config = readConfig();
await connectDatabase(config.MONGODB_URI);
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("revenuepilot-outbox", { connection });
const worker = new Worker(
  "revenuepilot-outbox",
  async (job) => {
    await projectOutbox(String(job.data.outboxId));
  },
  { connection, concurrency: 8 },
);
worker.on("failed", (_job, error) =>
  console.error(
    JSON.stringify({
      component: "worker",
      errorType: error.name,
      status: "failed",
    }),
  ),
);
let running = false;
async function dispatch() {
  if (running) return;
  running = true;
  try {
    const items = await Outbox.find({ processedAt: { $exists: false } })
      .sort({ createdAt: 1 })
      .limit(100)
      .select("_id tenantId")
      .lean();
    for (const item of items)
      await queue.add(
        "timeline",
        { outboxId: item._id, tenantId: item.tenantId },
        {
          jobId: item._id,
          attempts: 8,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: { age: 86400 },
        },
      );
  } catch (error: any) {
    console.error(
      JSON.stringify({
        component: "dispatcher",
        errorType: error.name,
        status: "retrying",
      }),
    );
  } finally {
    running = false;
  }
}
const timer = setInterval(dispatch, 2000);
await dispatch();
console.log(
  "RevenuePilot worker started. External provider execution is disabled.",
);
async function stop() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  await connection.quit();
  await mongoose.disconnect();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
