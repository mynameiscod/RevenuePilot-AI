import { describe, expect, it } from "vitest";
import {
  journeyProgress,
  type ProgressInput,
} from "../apps/web/src/journey/progress.ts";

const time = "2026-11-13T12:00:00.000Z";
const journey = (changes: Partial<ProgressInput> = {}): ProgressInput => ({
  lead: { stage: "new", createdAt: time },
  milestones: [],
  demos: [],
  orders: [],
  enrollments: [],
  canReadMoney: true,
  ...changes,
});

describe("lead journey evidence", () => {
  it("does not invent completed steps from a manually selected Enrolled stage", () => {
    const steps = journeyProgress(
      journey({ lead: { stage: "enrolled", createdAt: time } }),
    );
    expect(
      steps.filter((s) => s.state === "recorded").map((s) => s.label),
    ).toEqual(["Enquiry"]);
    expect(steps[4].detail).toBe("Not confirmed");
  });

  it("keeps an unanswered contact attempt and scheduled demo distinct from completion", () => {
    const steps = journeyProgress(
      journey({
        milestones: [{ type: "contact_attempted", occurredAt: time }],
        demos: [{ status: "scheduled", scheduledAt: time }],
      }),
    );
    expect(steps[1]).toMatchObject({
      state: "pending",
      detail: "Attempt recorded",
    });
    expect(steps[2]).toMatchObject({ state: "pending", detail: "Scheduled" });
  });

  it("shows a verified direct enrollment without filling in a conversation or demo", () => {
    const steps = journeyProgress(
      journey({
        milestones: [
          { type: "payment_captured", occurredAt: time },
          { type: "enrollment_confirmed", occurredAt: time },
        ],
        orders: [{ status: "paid" }],
        enrollments: [{ status: "confirmed" }],
      }),
    );
    expect(steps.map((s) => s.state)).toEqual([
      "recorded",
      "pending",
      "pending",
      "recorded",
      "recorded",
    ]);
  });

  it("shows refund review even when capture and enrollment milestones remain in history", () => {
    const steps = journeyProgress(
      journey({
        milestones: [
          { type: "payment_captured", occurredAt: time },
          { type: "enrollment_confirmed", occurredAt: time },
        ],
        orders: [{ status: "refunded" }],
        enrollments: [{ status: "review_required" }],
      }),
    );
    expect(steps[3]).toMatchObject({
      state: "review",
      detail: "Refund recorded",
    });
    expect(steps[4]).toMatchObject({
      state: "review",
      detail: "Needs review",
      at: undefined,
    });
  });

  it("does not expose a payment state or payment navigation without finance access", () => {
    const steps = journeyProgress(
      journey({
        canReadMoney: false,
        milestones: [{ type: "payment_captured", occurredAt: time }],
        enrollments: [{ status: "confirmed" }],
      }),
    );
    expect(steps[3]).toMatchObject({
      state: "pending",
      detail: "Finance access required",
      at: undefined,
      tab: "activity",
    });
    expect(steps[4].state).toBe("recorded");
    expect(steps.some((s) => s.tab === "payment")).toBe(false);
  });
});
