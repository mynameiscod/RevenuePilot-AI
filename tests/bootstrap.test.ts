import { afterAll, beforeAll, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { memoryMongoOptions } from "../scripts/mongo-options.ts";
import { bootstrapOwner } from "../apps/api/src/bootstrap.ts";
import { createApp } from "../apps/api/src/app.ts";
import { readConfig, type Config } from "../apps/api/src/config.ts";
import { connectDatabase } from "../apps/api/src/db.ts";
import { Membership, User } from "../apps/api/src/models.ts";
import { passwordMatches } from "../apps/api/src/security.ts";

let mongo: MongoMemoryReplSet, config: Config;
const owner = {
  name: "Private Owner",
  email: "private-owner@example.test",
  password: "Synthetic-private-owner!",
  workspaceName: "CodeBegun",
};
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create(memoryMongoOptions());
  config = readConfig({
    NODE_ENV: "production",
    MONGODB_URI: mongo.getUri("bootstrap"),
    DATA_ENCRYPTION_KEY: "ab".repeat(32),
    WEB_ORIGIN: "https://pilot.example.test",
    ALLOW_REGISTRATION: "false",
  });
  await connectDatabase(config.MONGODB_URI);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it("refuses bootstrap while public registration, mail or live execution is enabled", async () => {
  for (const flag of [
    "ALLOW_REGISTRATION",
    "ALLOW_ACCOUNT_EMAIL",
    "ALLOW_LIVE_PROVIDERS",
  ] as const)
    await expect(
      bootstrapOwner(owner, { ...config, [flag]: "true" }),
    ).rejects.toThrow("BOOTSTRAP_REQUIRES_PRIVATE_MODE");
  expect(await User.countDocuments()).toBe(0);
});

it("creates exactly one owner through normal registration while public registration stays closed", async () => {
  const app = createApp(config);
  await request(app)
    .post("/api/v1/auth/register")
    .set("Origin", config.WEB_ORIGIN)
    .send(owner)
    .expect(403);
  const attempts = await Promise.allSettled([
    bootstrapOwner(owner, config),
    bootstrapOwner({ ...owner, email: "second@example.test" }, config),
  ]);
  expect(
    attempts.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(await User.countDocuments()).toBe(1);
  expect(await Membership.countDocuments({ role: "owner" })).toBe(1);
  const user = await User.findOne().select("+passwordHash").lean();
  expect(user!.passwordHash).not.toBe(owner.password);
  expect(await passwordMatches(user!.passwordHash, owner.password)).toBe(true);
  await request(app)
    .post("/api/v1/auth/login")
    .set("Origin", config.WEB_ORIGIN)
    .send({ email: user!.email, password: owner.password })
    .expect(200);
  await request(app)
    .post("/api/v1/auth/register")
    .set("Origin", config.WEB_ORIGIN)
    .send({ ...owner, email: "public@example.test" })
    .expect(403);
  await expect(bootstrapOwner(owner, config)).rejects.toThrow(
    "OWNER_ALREADY_EXISTS",
  );
});
