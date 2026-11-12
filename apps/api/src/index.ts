import mongoose from "mongoose";
import { readConfig } from "./config.ts";
import { connectDatabase } from "./db.ts";
import { createApp } from "./app.ts";

const config = readConfig();
await connectDatabase(config.MONGODB_URI);
const server = createApp(config).listen(config.API_PORT, "0.0.0.0", (error) => {
  if (error) {
    // Express 5 passes bind errors to this callback too. Never announce
    // readiness when another process owns the configured API port.
    console.error(
      `RevenuePilot API could not listen on ${config.API_PORT}: ${(error as NodeJS.ErrnoException).code ?? error.name}`,
    );
    void mongoose.disconnect().finally(() => process.exit(1));
    return;
  }
  console.log(`RevenuePilot API ready on ${config.API_PORT}`);
  // The development launcher starts Vite only after its own API child has
  // connected to MongoDB and bound its port. A different process on that port
  // cannot accidentally satisfy this readiness signal.
  process.send?.({ type: "revenuepilot:api-ready" });
});
async function stop() {
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
