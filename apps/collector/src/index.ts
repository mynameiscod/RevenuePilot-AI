import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { readConfig } from "../../api/src/config.ts";
import { connectDatabase } from "../../api/src/db.ts";
import { collectorRouter } from "../../api/src/collector.ts";
import { errorHandler } from "../../api/src/app.ts";
const config = readConfig();
await connectDatabase(config.MONGODB_URI);
const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.set("X-Request-Id", req.requestId);
  next();
});
app.use(express.json({ limit: "256kb" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await mongoose.connection.db!.admin().ping();
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});
app.use("/api/v1/collect", collectorRouter());
app.use(errorHandler);
const server = app.listen(4001, "0.0.0.0", () =>
  console.log("RevenuePilot collector ready on 4001"),
);
process.on("SIGTERM", () =>
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  }),
);
