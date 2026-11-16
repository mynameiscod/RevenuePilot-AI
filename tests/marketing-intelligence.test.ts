import { describe, it, expect } from "vitest";
import {
  classifyAttempt,
  summarizeAttempts,
  recoveryRecipe,
} from "../packages/core/src/marketing-intelligence.ts";
import { recoveryPlanInput } from "../packages/core/src/recovery.ts";
const now = Date.UTC(2026, 10, 16, 12),
  old = new Date(now - 60 * 60_000),
  recent = new Date(now - 5 * 60_000);
describe("marketing gap evidence", () => {
  it("distinguishes recent activity, mature gaps, recorded problems and accepted enquiries", () => {
    expect(classifyAttempt({ startedAt: old, submittedAt: recent }, now)).toBe(
      "pending",
    );
    expect(classifyAttempt({ startedAt: old }, now)).toBe("started");
    expect(classifyAttempt({ viewedAt: old }, now)).toBe("viewed");
    expect(classifyAttempt({ submittedAt: old }, now)).toBe("submitted");
    expect(classifyAttempt({ startedAt: old, failedAt: old }, now)).toBe(
      "technical",
    );
    expect(classifyAttempt({ failedAt: old, acceptedAt: recent }, now)).toBe(
      "accepted",
    );
    expect(classifyAttempt({ createdAt: old }, now)).toBe("unknown");
    expect(
      classifyAttempt({ startedAt: new Date(now - 30 * 60_000) }, now),
    ).toBe("started");
  });
  it("aggregates mutually exclusive outcomes without disclosing anonymous identities", () => {
    const report = summarizeAttempts(
      [
        {
          formId: "a",
          startedAt: old,
          touch: { source: "Google Ads", campaign: "java" },
        },
        {
          formId: "a",
          startedAt: old,
          acceptedAt: recent,
          touch: { source: "Google Ads", campaign: "java" },
        },
        { formId: "b", createdAt: old },
      ],
      now,
    );
    expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(3);
    expect(report.groups).toHaveLength(2);
    expect(report.counts).toMatchObject({
      started: 1,
      accepted: 1,
      unknown: 1,
    });
  });
  it("exports only supported event rules and an explicit manual activation boundary", () => {
    const p = {
      name: "Java recovery",
      provider: "google_ads" as const,
      segment: "started_not_accepted",
      membershipDays: 30,
    };
    const recipe = recoveryRecipe(p, {
      publicKey: "form_synthetic_test_123",
      course: "Java",
    });
    expect(recipe.include).toEqual({
      event: "rp_form_start",
      form_id: "form_synthetic_test_123",
    });
    expect(recipe.exclude).toEqual([
      { event: "generate_lead", form_id: "form_synthetic_test_123" },
    ]);
    expect(recipe.automaticActivation).toBe(false);
    expect(recipe.identityExport).toBe(false);
    const meta = recoveryRecipe(
      { ...p, provider: "meta" },
      { publicKey: "test" },
    );
    expect(meta.readiness).toBe("connector_backlog");
    expect(meta.include).toBeNull();
    expect(meta.events).toEqual([]);
  });
  it("rejects arbitrary audience uploads and invalid membership windows", () => {
    expect(
      recoveryPlanInput.safeParse({
        name: "Java",
        formId: crypto.randomUUID(),
        provider: "google_ads",
        segment: "started_not_accepted",
        membershipDays: 0,
      }).success,
    ).toBe(false);
    expect(
      recoveryPlanInput.safeParse({
        name: "Java",
        formId: crypto.randomUUID(),
        provider: "google_ads",
        segment: "started_not_accepted",
        membershipDays: 30,
        emails: ["person@example.test"],
      }).success,
    ).toBe(false);
  });
});
