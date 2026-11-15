import type { AddressInfo } from "node:net";
import mongoose from "mongoose";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import { User } from "./models.ts";
import { registrationInput } from "../../../packages/core/src/contracts.ts";

/** Local administrative bootstrap only. No public route or auth bypass. */
export async function bootstrapOwner(value: unknown, config: Config) {
  const input = registrationInput.parse(value);
  if (
    config.ALLOW_REGISTRATION !== "false" ||
    config.ALLOW_ACCOUNT_EMAIL !== "false" ||
    config.ALLOW_LIVE_PROVIDERS !== "false"
  )
    throw new Error("BOOTSTRAP_REQUIRES_PRIVATE_MODE");
  if (await User.exists({})) throw new Error("OWNER_ALREADY_EXISTS");
  const locks = mongoose.connection.db!.collection<{
    _id: string;
    status: string;
  }>("bootstrap_locks");
  await locks.insertOne({ _id: "first-owner", status: "running" });
  const server = createApp({ ...config, ALLOW_REGISTRATION: "true" }).listen(
    0,
    "127.0.0.1",
  );
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/auth/register`,
      {
        method: "POST",
        headers: {
          Origin: config.WEB_ORIGIN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (response.status !== 201) throw new Error("OWNER_NOT_CONFIRMED");
    const result = (await response.json()) as {
      user: { id: string };
      tenants: { id: string }[];
    };
    await locks.updateOne(
      { _id: "first-owner" },
      { $set: { status: "completed" } },
    );
    return { userId: result.user.id, tenantId: result.tenants[0].id };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // A completed/uncertain creation must never be replaced by a later bootstrap.
    if (!(await User.exists({}))) await locks.deleteOne({ _id: "first-owner" });
  }
}
