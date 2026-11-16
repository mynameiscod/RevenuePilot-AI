import type { Router } from "express";
import { z } from "zod";
import { identifier } from "../../../../packages/core/src/contracts.ts";
import {
  recoveryPlanInput,
  recoveryPlanUpdate,
} from "../../../../packages/core/src/recovery.ts";
import {
  classifyAttempt,
  summarizeAttempts,
  recoveryRecipe,
  recoveryProviders,
} from "../../../../packages/core/src/marketing-intelligence.ts";
import { requirePermission, type AuthContext } from "../auth.ts";
import { Lead } from "../models.ts";
import { Attempt, Form, RecoveryPlan, Followup, Milestone } from "./models.ts";
import { AppError } from "../errors.ts";
import { audit, idempotent } from "../services.ts";
import { lockTenant } from "./entitlements.ts";
import { transaction } from "../db.ts";

export async function marketingIntelligence(auth: AuthContext, days: number) {
  const tenantId = auth.tenantId!,
    now = new Date(),
    from = new Date(+now - days * 86400000);
  const [attempts, leads, forms, plans] = await Promise.all([
    Attempt.find({
      tenantId,
      createdAt: { $gte: from, $lte: now },
      expiresAt: { $gt: now },
    })
      .limit(20001)
      .lean(),
    Lead.find({
      tenantId,
      erasedAt: { $exists: false },
      createdAt: { $gte: from, $lte: now },
    })
      .select("_id stage")
      .limit(10001)
      .lean(),
    Form.find({ tenantId })
      .select("_id name course publicKey active")
      .limit(1001)
      .lean(),
    RecoveryPlan.find({ tenantId }).sort({ createdAt: -1 }).limit(101).lean(),
  ]);
  if (
    attempts.length > 20000 ||
    leads.length > 10000 ||
    forms.length > 1000 ||
    plans.length > 100
  )
    throw new AppError(
      422,
      "REPORT_TOO_LARGE",
      "Select a shorter reporting period or contact your workspace administrator.",
    );
  const leadIds = leads.map((l) => l._id);
  const [overdue, milestones] = await Promise.all([
    Followup.countDocuments({
      tenantId,
      leadId: { $in: leadIds },
      status: "open",
      dueAt: { $lt: now },
    }),
    Milestone.find({
      tenantId,
      leadId: { $in: leadIds },
      occurredAt: { $lte: now },
    })
      .select("leadId type")
      .limit(100001)
      .lean(),
  ]);
  if (milestones.length > 100000)
    throw new AppError(
      422,
      "REPORT_TOO_LARGE",
      "Select a shorter reporting period.",
    );
  const observations = summarizeAttempts(attempts as any, +now);
  const byForm = new Map(forms.map((f) => [String(f._id), f]));
  const ideas: {
    id: string;
    title: string;
    evidence: string;
    action: string;
    href: string;
    metric: string;
  }[] = [];
  if (observations.counts.technical || observations.counts.submitted)
    ideas.push({
      id: "capture_reliability",
      title: "Check submission reliability first",
      evidence: `${observations.counts.technical} mature attempts have an observed problem; ${observations.counts.submitted} have a submit observation without acceptance.`,
      action:
        "Reproduce the failure on the affected form and check API logs. Missing acceptance is not proof that the user left.",
      href: "/marketing?view=gaps",
      metric: "Accepted enquiries after a submit attempt",
    });
  if (observations.counts.started)
    ideas.push({
      id: "recover_starters",
      title: "Prepare a form-starter recovery audience",
      evidence: `${observations.counts.started} mature attempts started without recorded acceptance or a recorded error.`,
      action:
        "Review the form and prepare consented Google / YouTube targeting; exclude accepted enquiries in Google.",
      href: "/marketing?view=recovery",
      metric: "New accepted enquiries from a tagged recovery campaign",
    });
  if (observations.counts.viewed)
    ideas.push({
      id: "form_friction",
      title: "Test the first step of the enquiry form",
      evidence: `${observations.counts.viewed} mature attempts have a form view but no recorded start.`,
      action:
        "Test one change to the form explanation or placement. This observation does not establish why a visitor stopped.",
      href: "/marketing?view=gaps",
      metric: "Starts among observed form views in the same cohort",
    });
  if (overdue)
    ideas.push({
      id: "response_sla",
      title: "Work the overdue follow-ups",
      evidence: `${overdue} open tasks are overdue for leads created in this period.`,
      action: "Review the assigned tasks and record actual contact outcomes.",
      href: "/work",
      metric: "First response time and connections",
    });
  if (!attempts.length)
    ideas.push({
      id: "verify_measurement",
      title: "Verify the website measurement setup",
      evidence:
        "No retained consented attempts were observed in this reporting period.",
      action:
        "Test a configured form with measurement permission. Zero observations do not prove zero visitors.",
      href: "/marketing?view=links",
      metric: "Observed view, start and accepted enquiry for a controlled test",
    });
  return {
    period: { from: from.toISOString(), to: now.toISOString(), days },
    observations: {
      ...observations,
      groups: observations.groups.map((g) => ({
        ...g,
        formName: byForm.get(g.formId)?.name ?? "Unavailable form",
        offering: byForm.get(g.formId)?.course ?? "",
      })),
    },
    sales: {
      leads: leads.length,
      overdueTasks: overdue,
      closedLost: leads.filter((l) => l.stage === "lost").length,
      milestones: [
        "lead_accepted",
        "contact_attempted",
        "connected",
        "qualified",
        "demo_scheduled",
        "demo_attended",
        "payment_captured",
        "enrollment_confirmed",
      ].map((type) => ({
        type,
        count: new Set(
          milestones.filter((m) => m.type === type).map((m) => m.leadId),
        ).size,
      })),
    },
    ideas,
    ideaMethod:
      "Evidence-based rules v1; suggestions for human review, not AI predictions or proven causes.",
    forms: forms.map((f) => ({
      id: f._id,
      name: f.name,
      offering: f.course,
      active: f.active,
    })),
    plans: plans.map((p) => {
      const cutoff = +now - p.membershipDays! * 86400000;
      const count = attempts.filter(
        (a) =>
          String(a.formId) === String(p.formId) &&
          +new Date(a.createdAt) >= cutoff &&
          !a.acceptedAt &&
          (p.segment === "started_not_accepted"
            ? !!a.startedAt
            : !!a.viewedAt) &&
          !["pending", "unknown"].includes(classifyAttempt(a as any, +now)),
      ).length;
      return {
        id: p._id,
        name: p.name,
        formId: p.formId,
        provider: p.provider,
        segment: p.segment,
        membershipDays: p.membershipDays,
        status: p.status,
        version: p.version,
        formName: byForm.get(p.formId!)?.name ?? "Unavailable form",
        observedCandidates: count,
        previewDays: Math.min(days, p.membershipDays!),
        providerMatchedUsers: null,
        readiness: !byForm.get(p.formId!)?.active
          ? "form_unavailable"
          : p.status === "paused"
            ? "paused"
            : recoveryProviders[p.provider as keyof typeof recoveryProviders]
                  ?.recipe
              ? "manual_provider_setup_required"
              : "connector_backlog",
      };
    }),
    providerCapabilities: recoveryProviders,
    limits: [
      "Anonymous attempts are not identifiable leads or Google-matched people.",
      "Technical symptoms do not establish a cause. Absence of an event is not an explicit loss.",
      "Audience exports contain rules only; no names, contact details, browser IDs or partial form values.",
      "Saving or pausing a plan changes RevenuePilot only. Manage any separately created audience or campaign in its provider account.",
    ],
  };
}

export function attachIntelligenceRoutes(router: Router) {
  router.get(
    "/marketing/intelligence",
    requirePermission("marketing.read"),
    async (req, res) => {
      const days = z.coerce
        .number()
        .int()
        .refine((n) => [7, 30, 90].includes(n))
        .parse(req.query.days ?? 30);
      res.json(await marketingIntelligence(req.auth!, days));
    },
  );
  router.post(
    "/marketing/recovery-plans",
    requirePermission("settings.write"),
    async (req, res) => {
      const input = recoveryPlanInput.parse(req.body);
      const result = await idempotent(
        req.auth!,
        "POST/marketing/recovery-plans",
        req.get("Idempotency-Key") ?? "",
        input,
        async (session) => {
          await lockTenant(req.auth!.tenantId!, session);
          const form = await Form.findOne({
            tenantId: req.auth!.tenantId,
            _id: input.formId,
            active: true,
          }).session(session);
          if (!form)
            throw new AppError(
              404,
              "FORM_NOT_FOUND",
              "Choose an active form in this workspace.",
            );
          if (
            (await RecoveryPlan.countDocuments({
              tenantId: req.auth!.tenantId,
            }).session(session)) >= 100
          )
            throw new AppError(
              429,
              "PLAN_LIMIT",
              "This workspace has reached its 100-plan allowance.",
            );
          const [plan] = await RecoveryPlan.create(
            [
              {
                ...input,
                tenantId: req.auth!.tenantId,
                createdBy: req.auth!.userId,
              },
            ],
            { session },
          );
          await audit(
            req.auth!,
            "marketing.recovery_plan_created",
            String(plan._id),
            req.requestId,
            session,
          );
          return { id: plan._id, status: plan.status, version: plan.version };
        },
      );
      res.status(201).json(result);
    },
  );
  router.patch(
    "/marketing/recovery-plans/:id",
    requirePermission("settings.write"),
    async (req, res) => {
      const id = identifier.parse(req.params.id),
        input = recoveryPlanUpdate.parse(req.body);
      await transaction(async (session) => {
        const result = await RecoveryPlan.updateOne(
          { tenantId: req.auth!.tenantId, _id: id, version: input.version },
          { $set: { status: input.status }, $inc: { version: 1 } },
          { session },
        );
        if (!result.matchedCount)
          throw new AppError(
            409,
            "PLAN_CHANGED",
            "The plan changed or is unavailable. Refresh and try again.",
          );
        await audit(
          req.auth!,
          "marketing.recovery_plan_updated",
          id,
          req.requestId,
          session,
        );
      });
      res.json({ updated: true, version: input.version + 1 });
    },
  );
  router.get(
    "/marketing/recovery-plans/:id/recipe",
    requirePermission("marketing.read"),
    async (req, res) => {
      const plan = await RecoveryPlan.findOne({
        tenantId: req.auth!.tenantId,
        _id: identifier.parse(req.params.id),
      }).lean();
      if (!plan)
        throw new AppError(404, "PLAN_NOT_FOUND", "Recovery plan not found.");
      const form = await Form.findOne({
        tenantId: req.auth!.tenantId,
        _id: plan.formId,
      }).lean();
      if (!form) throw new AppError(404, "FORM_NOT_FOUND", "Form not found.");
      res.json({
        ...recoveryRecipe(plan as any, form as any),
        planStatus: plan.status,
        formActive: form.active,
      });
    },
  );
}
