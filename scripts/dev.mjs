import "dotenv/config";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { memoryMongoOptions } from "./mongo-options.ts";

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
// A custom local port must also be the API's expected browser port when the
// developer has not explicitly configured WEB_ORIGIN.
process.env.WEB_ORIGIN ??= `http://localhost:${process.env.PORT ?? 3001}`;
const demo = process.env.REVENUEPILOT_DEMO === "true";
let memoryServer;
let mongoose;
let initialization;
async function initializeDemo() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo mode is unavailable in production.");
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  if (stopping) return;
  // Memory demo is ephemeral, contains only synthetic data and has no external connections.
  // Retain ownership even when startup fails or is interrupted partway through.
  memoryServer = new MongoMemoryReplSet(memoryMongoOptions());
  console.log("Starting temporary MongoDB for the demo…");
  await memoryServer.start();
  if (stopping) return;
  process.env.MONGODB_URI = memoryServer.getUri("revenuepilot_demo");
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.NODE_ENV = "development";
  await import("tsx/esm/api").then((m) => m.register());
  mongoose = (await import("mongoose")).default;
  const { readConfig } = await import("../apps/api/src/config.ts");
  const { connectDatabase } = await import("../apps/api/src/db.ts");
  const { seedDemo } = await import("./seed-demo.ts");
  await connectDatabase(process.env.MONGODB_URI);
  if (stopping) return;
  await seedDemo(readConfig());
}
const children = [];
let projectionTimer;
let projectionTask;
let stopping = false;
let stopPromise;
let exitCode = 0;

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(
        `Development process ${child.pid} did not stop; terminating it.`,
      );
      child.kill("SIGKILL");
    }, 10000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    // Windows kill(SIGTERM) terminates immediately. IPC allows Node children
    // to finish their own database/queue cleanup before the database stops.
    if (child.connected)
      child.send({ type: "shutdown" }, (error) => {
        if (error) child.kill("SIGTERM");
      });
    else child.kill("SIGTERM");
  });
}

function stop(code = 0) {
  exitCode = Math.max(exitCode, code);
  if (stopPromise) return stopPromise;
  stopping = true;
  clearInterval(projectionTimer);
  console.log("Stopping RevenuePilot…");
  stopPromise = (async () => {
    // Startup/download or an unresponsive child must not hold the terminal forever.
    // mongodb-memory-server's watchdog also reaps its child if this owner exits.
    const deadline = setTimeout(() => {
      console.error("RevenuePilot cleanup timed out after 90 seconds.");
      process.exit(1);
    }, 90000);
    async function cleanup(label, work) {
      try {
        await work();
      } catch (error) {
        exitCode = 1;
        console.error(`Could not stop ${label}: ${error.message}`);
      }
    }
    // Never race stop() against start()/seeding, nor disconnect beneath an
    // in-flight projection. Repeated signals share this one cleanup promise.
    await initialization?.catch(() => {});
    await Promise.all(
      children.map((child) =>
        cleanup("development process", () => stopChild(child)),
      ),
    );
    await cleanup("demo projections", () => projectionTask);
    if (mongoose)
      await cleanup("database clients", () => mongoose.disconnect());
    if (memoryServer)
      await cleanup("temporary MongoDB", async () => {
        if (!(await memoryServer.stop()))
          throw new Error("Replica-set cleanup failed.");
      });
    clearTimeout(deadline);
    console.log("RevenuePilot stopped.");
    process.exit(exitCode);
  })();
  return stopPromise;
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
// A parent test/controller can request graceful shutdown on Windows as well.
// This channel only exists when the process was forked with an IPC descriptor.
if (process.send)
  process.on("message", (message) => {
    if (message?.type === "shutdown") void stop();
  });
function startChild(args, ipc = false) {
  const child = spawn(process.execPath, args, {
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
    env: process.env,
  });
  children.push(child);
  child.once("error", (error) => {
    if (!stopping) {
      console.error(
        `Could not start ${args.at(-1)}: ${error.code ?? error.name}`,
      );
      void stop(1);
    }
  });
  child.once("exit", (code) => {
    if (!stopping) void stop(code || 1);
  });
  return child;
}

try {
  if (demo) {
    initialization = initializeDemo();
    await initialization;
  }
  if (stopping) await stopPromise;
  const api = startChild(["--import", "tsx", "apps/api/src/index.ts"], true);
  console.log("Waiting for RevenuePilot API before starting the web app…");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(
        new Error(
          "API startup timed out after 60 seconds. Check the API output above.",
        ),
      );
    }, 60000);
    function finish(error) {
      clearTimeout(timer);
      api.off("message", onMessage);
      api.off("error", onError);
      api.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    }
    const onMessage = (message) => {
      if (message?.type === "revenuepilot:api-ready") finish();
    };
    const onError = (error) => finish(error);
    const onExit = (code) =>
      finish(new Error(`API exited before startup (code ${code}).`));
    api.on("message", onMessage);
    api.once("error", onError);
    api.once("exit", onExit);
  });
  if (!stopping) {
    if (demo) {
      const { drainOutbox } = await import("../apps/worker/src/project.ts");
      const { drainJourney } = await import("../apps/worker/src/journey.ts");
      const { readConfig } = await import("../apps/api/src/config.ts");
      projectionTimer = setInterval(() => {
        if (stopping || projectionTask) return;
        projectionTask = (async () => {
          await drainOutbox();
          await drainJourney(readConfig());
        })()
          .catch((error) => {
            console.error(`Demo projection failed: ${error.name}`);
          })
          .finally(() => {
            projectionTask = undefined;
          });
      }, 1000);
    } else startChild(["--import", "tsx", "apps/worker/src/index.ts"], true);
    if (!stopping) startChild(["node_modules/vite/bin/vite.js"]);
  }
} catch (error) {
  if (!stopping) {
    console.error(`RevenuePilot startup failed: ${error.message}`);
    await stop(1);
  } else await stopPromise;
}
