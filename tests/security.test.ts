import { describe, it, expect } from "vitest";
import {
  seal,
  unseal,
  lookupHash,
  totp,
  base32,
  passwordHash,
  passwordMatches,
} from "../apps/api/src/security.ts";
import { readConfig } from "../apps/api/src/config.ts";
import { allocate, collectInput, can } from "../packages/core/src/contracts.ts";
import { adapterFor, providers } from "../packages/connectors/src/index.ts";

describe("security and domain invariants", () => {
  const key = "11".repeat(32);
  it("authenticates ciphertext to its tenant, detects tampering and randomizes nonces", () => {
    const a = seal({ apiKey: "synthetic-private-key" }, key, "tenant_a"),
      b = seal({ apiKey: "synthetic-private-key" }, key, "tenant_a");
    expect(a).not.toBe(b);
    expect(a).not.toContain("synthetic-private-key");
    expect(unseal(a, key, "tenant_a")).toEqual({
      apiKey: "synthetic-private-key",
    });
    expect(() => unseal(a, key, "tenant_b")).toThrow();
    expect(() => unseal(a, "22".repeat(32), "tenant_a")).toThrow();
  });
  it("keeps identity lookup hashes different between tenants", () => {
    expect(lookupHash("SAMPLE@example.test", key, "a")).toBe(
      lookupHash("sample@example.test", key, "a"),
    );
    expect(lookupHash("sample@example.test", key, "a")).not.toBe(
      lookupHash("sample@example.test", key, "b"),
    );
  });
  it("hashes passwords with Argon2 and verifies without plaintext storage", async () => {
    const hash = await passwordHash("a-strong-synthetic-password");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await passwordMatches(hash, "a-strong-synthetic-password")).toBe(
      true,
    );
    expect(await passwordMatches(hash, "incorrect")).toBe(false);
  });
  it("uses the RFC 6238 SHA1 test vector, truncated to six digits", () => {
    const secret = base32(Buffer.from("12345678901234567890"));
    expect(totp(secret, 1)).toBe("287082");
  });
  it("fails closed when encryption is missing or demo mode is requested in production", () => {
    expect(() =>
      readConfig({ MONGODB_URI: "mongodb://localhost/rp" }),
    ).toThrow();
    expect(() =>
      readConfig({
        MONGODB_URI: "mongodb://localhost/rp",
        DATA_ENCRYPTION_KEY: key,
        NODE_ENV: "production",
        WEB_ORIGIN: "https://app.example.test",
        REVENUEPILOT_DEMO: "true",
      }),
    ).toThrow();
  });
  it("conserves integer money across weights and refunds with deterministic rounding", () => {
    expect(allocate(100n, ["c", "a", "b"])).toEqual({
      a: "34",
      b: "33",
      c: "33",
    });
    expect(allocate(-100n, ["a", "b", "c"])).toEqual({
      a: "-34",
      b: "-33",
      c: "-33",
    });
    expect(allocate(7n, [])).toEqual({ unattributed: "7" });
  });
  it("never silently substitutes or activates an unsupported adapter", () => {
    expect(providers).toHaveLength(11);
    expect(providers.every((p) => p.status === "configuration_only")).toBe(
      true,
    );
    expect(() => adapterFor("meta")).toThrow(/no certified adapter/);
  });
  it("does not grant finance writes to a viewer or counselor", () => {
    expect(can("viewer", "revenue.write")).toBe(false);
    expect(can("counselor", "revenue.read")).toBe(false);
    expect(can("finance", "revenue.write")).toBe(true);
    expect(can("analyst", "pii.read")).toBe(false);
  });
  it("rejects privileged events and form values from public telemetry", () => {
    const event = {
      eventId: "evt_1",
      occurredAt: new Date().toISOString(),
      anonymousId: "anon_1",
      sessionId: "ses_1",
      path: "/course",
      consent: "granted",
      type: "form.started.v1",
      payload: { formId: "java", attemptId: "attempt_1" },
    };
    expect(
      collectInput.safeParse({ siteKey: "x".repeat(24), events: [event] })
        .success,
    ).toBe(true);
    expect(
      collectInput.safeParse({
        siteKey: "x".repeat(24),
        events: [{ ...event, type: "payment.captured.v1" }],
      }).success,
    ).toBe(false);
    expect(
      collectInput.safeParse({
        siteKey: "x".repeat(24),
        events: [
          {
            ...event,
            payload: { ...event.payload, email: "someone@example.test" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      collectInput.safeParse({
        siteKey: "x".repeat(24),
        events: [{ ...event, path: "/course?email=someone" }],
      }).success,
    ).toBe(false);
  });
});
