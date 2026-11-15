import type { Stage } from "../../../../packages/core/src/contracts.ts";

export type JourneyStep = {
  label: string;
  state: "recorded" | "pending" | "review";
  detail: string;
  at?: string;
  tab: "activity" | "followup" | "demo" | "payment";
};
export type ProgressInput = {
  lead: { stage: Stage; createdAt: string };
  milestones: { type: string; occurredAt: string; evidence?: string }[];
  demos: { status: string; scheduledAt: string }[];
  orders: { status: string }[];
  enrollments: { status: string; evidence?: string }[];
  canReadMoney: boolean;
};

// A manually chosen stage is not evidence of a conversation, payment or
// enrollment. Render each recorded step independently; never fill skipped steps.
export function journeyProgress(data: ProgressInput): JourneyStep[] {
  const at = (type: string) =>
    data.milestones.find((m) => m.type === type)?.occurredAt;
  const connected = at("connected");
  const attended = at("demo_attended");
  const booked = data.demos
    .filter((d) => d.status === "scheduled")
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  const review =
    data.enrollments.some((e) => e.status === "review_required") ||
    data.orders.some((o) => o.status === "refunded");
  const captured = at("payment_captured");
  const refunded =
    at("payment_refunded") || data.orders.some((o) => o.status === "refunded");
  const manualPayment = data.milestones.some(
    (m) => m.type === "payment_captured" && m.evidence === "manual_record",
  );
  const staffEnrollment = data.enrollments.some(
    (e) => e.status === "confirmed" && e.evidence === "staff_confirmed",
  );
  const enrolled = data.enrollments.some((e) => e.status === "confirmed");
  return [
    {
      label: "Enquiry",
      state: "recorded",
      detail: "Lead received",
      at: data.lead.createdAt,
      tab: "activity",
    },
    {
      label: "Conversation",
      state: connected ? "recorded" : "pending",
      detail: connected
        ? "Connected"
        : at("contact_attempted")
          ? "Attempt recorded"
          : "Not recorded",
      at: connected ?? at("contact_attempted"),
      tab: "followup",
    },
    {
      label: "Demo",
      state: attended ? "recorded" : "pending",
      detail: attended ? "Attended" : booked ? "Scheduled" : "Not recorded",
      at: attended ?? booked?.scheduledAt,
      tab: "demo",
    },
    {
      label: "Payment",
      state: !data.canReadMoney
        ? "pending"
        : refunded || review
          ? "review"
          : captured
            ? "recorded"
            : "pending",
      detail: !data.canReadMoney
        ? "Finance access required"
        : refunded
          ? "Refund recorded"
          : review
            ? "Review evidence"
            : captured
              ? manualPayment
                ? "Manually recorded"
                : "Confirmed"
              : "Not recorded",
      at: data.canReadMoney ? captured : undefined,
      tab: data.canReadMoney ? "payment" : "activity",
    },
    {
      label: "Enrollment",
      state: review ? "review" : enrolled ? "recorded" : "pending",
      detail: review
        ? "Needs review"
        : enrolled
          ? staffEnrollment
            ? "Staff confirmed"
            : "Confirmed"
          : "Not confirmed",
      at: enrolled && !review ? at("enrollment_confirmed") : undefined,
      tab: data.canReadMoney ? "payment" : "activity",
    },
  ];
}
