import mongoose from "mongoose";
import { readConfig } from "./config.ts";
import { connectDatabase } from "./db.ts";
import { createApp } from "./app.ts";

const config = readConfig();
await connectDatabase(config.MONGODB_URI);
const server = createApp(config).listen(config.API_PORT, "0.0.0.0", () =>
  console.log(`RevenuePilot API ready on ${config.API_PORT}`),
);
async function stop() {
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
