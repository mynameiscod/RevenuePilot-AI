import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../apps/api/src/app.ts";
import { readConfig } from "../apps/api/src/config.ts";

const environment = {
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/origin_policy_test",
  DATA_ENCRYPTION_KEY: "cd".repeat(32),
};
const configure = (origin: string, production = false) =>
  readConfig({
    ...environment,
    WEB_ORIGIN: origin,
    NODE_ENV: production ? "production" : "test",
  });

describe("browser origin boundary", () => {
  it("accepts either local hostname on the configured scheme and port, with matching CORS", async () => {
    for (const configured of [
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ]) {
      const app = createApp(configure(configured));
      for (const origin of ["http://localhost:3001", "http://127.0.0.1:3001"]) {
        const preflight = await request(app)
          .options("/api/v1/auth/logout")
          .set("Origin", origin)
          .set("Access-Control-Request-Method", "POST")
          .expect(204);
        expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
        expect(preflight.headers["access-control-allow-credentials"]).toBe(
          "true",
        );
        // Origin succeeds, but session authentication remains required.
        const response = await request(app)
          .post("/api/v1/auth/logout")
          .set("Origin", origin)
          .expect(401);
        expect(response.body.code).toBe("UNAUTHENTICATED");
      }
    }
  });

  it("rejects missing, opaque, lookalike, different-port and different-scheme origins", async () => {
    const app = createApp(configure("http://localhost:3001"));
    for (const origin of [
      undefined,
      "null",
      "http://localhost:3002",
      "https://localhost:3001",
      "http://127.0.0.1:4000",
      "http://localhost.attacker.test:3001",
      "http://127.0.0.1.attacker.test:3001",
      "http://127.0.0.2:3001",
    ]) {
      const req = request(app)
        .post("/api/v1/auth/logout")
        .set("Host", "localhost:3001")
        .set("X-Forwarded-Host", "localhost:3001");
      if (origin !== undefined) req.set("Origin", origin);
      const response = await req.expect(403);
      expect(response.body.code).toBe("ORIGIN_DENIED");
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("keeps production exact even when its configured hostname is localhost", async () => {
    for (const configured of [
      "https://app.example.test",
      "https://localhost:3001",
    ]) {
      const app = createApp(configure(configured, true));
      const allowed = await request(app)
        .post("/api/v1/auth/logout")
        .set("Origin", configured)
        .expect(401);
      expect(allowed.body.code).toBe("UNAUTHENTICATED");
      for (const origin of [
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "https://127.0.0.1:3001",
        "https://app.example.test.attacker.test",
      ]) {
        const denied = await request(app)
          .post("/api/v1/auth/logout")
          .set("Origin", origin)
          .expect(403);
        expect(denied.body.code).toBe("ORIGIN_DENIED");
        expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
      }
    }
  });

  it("does not add local aliases for a non-local development origin", async () => {
    const app = createApp(configure("https://preview.example.test"));
    const response = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", "http://localhost:3001")
      .expect(403);
    expect(response.body.code).toBe("ORIGIN_DENIED");
  });

  it("canonicalizes a trailing slash and rejects credentials or path-bearing configuration", () => {
    expect(configure("http://localhost:3001/").WEB_ORIGIN).toBe(
      "http://localhost:3001",
    );
    for (const value of [
      "http://localhost:3001/login",
      "http://localhost:3001/?q=test",
      "http://localhost:3001/#test",
      "http://user:password@localhost:3001",
      "ftp://localhost:3001",
    ]) {
      expect(() => configure(value)).toThrow(/WEB_ORIGIN/);
    }
  });
});
