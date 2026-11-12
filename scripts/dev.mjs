import "dotenv/config";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

// Forward standard Vite CLI options, including those supplied by a local preview runner.
for (const [flag, variable] of [
  ["--port", "PORT"],
  ["--host", "VITE_DEV_HOST"],
]) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1])
    process.env[variable] = process.argv[index + 1];
}

if (process.argv.includes("--demo")) process.env.REVENUEPILOT_DEMO = "true";
const demo = process.env.REVENUEPILOT_DEMO === "true";
let memoryServer;
if (demo) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo mode is unavailable in production.");
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  // Memory demo is ephemeral, contains only synthetic data and has no external connections.
  memoryServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, args: ["--nounixsocket"] },
    binary: { version: "7.0.48" },
  });
  process.env.MONGODB_URI = memoryServer.getUri("revenuepilot_demo");
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.NODE_ENV = "development";
  await import("tsx/esm/api").then((m) => m.register());
  const { readConfig } = await import("../apps/api/src/config.ts");
  const { connectDatabase } = await import("../apps/api/src/db.ts");
  const { seedDemo } = await import("./seed-demo.ts");
  await connectDatabase(process.env.MONGODB_URI);
  await seedDemo(readConfig());
}
const children = [
  spawn(process.execPath, ["--import", "tsx", "apps/api/src/index.ts"], {
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
    env: process.env,
  }),
];
let projectionTimer;
if (demo) {
  const { drainOutbox } = await import("../apps/worker/src/project.ts");
  projectionTimer = setInterval(
    () => drainOutbox().catch((e) => console.error(e.name)),
    1000,
  );
} else
  children.push(
    spawn(process.execPath, ["--import", "tsx", "apps/worker/src/index.ts"], {
      stdio: "inherit",
      env: process.env,
    }),
  );
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(projectionTimer);
  for (const child of children) child.kill("SIGTERM");
  if (demo) {
    const mongoose = (await import("mongoose")).default;
    await mongoose.disconnect();
    await memoryServer.stop();
  }
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping) void stop(code ?? 1);
  });
