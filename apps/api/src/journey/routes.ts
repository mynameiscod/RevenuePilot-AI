import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.ts";
import { can, identifier } from "../../../../packages/core/src/contracts.ts";
import {
  formInput,
  contactInput,
  demoInput,
  demoOutcomeInput,
  planLimits,
} from "../../../../packages/core/src/journey.ts";
import { Lead, Membership, Tenant, User } from "../models.ts";
import {
  CallRecord,
  Form,
  Followup,
  Appointment,
  Milestone,
  Enrollment,
  PaymentOrder,
  Consent,
  Suppression,
  Command,
} from "./models.ts";
import { requirePermission, leadScope } from "../auth.ts";
import { AppError } from "../errors.ts";
import { idempotent, audit, timeline, leadView } from "../services.ts";
import { transaction } from "../db.ts";
import { unseal, randomToken } from "../security.ts";
import { lockTenant } from "./entitlements.ts";
import { milestone } from "./evidence.ts";
import { journeyAnalytics } from "./analytics.ts";

export function journeyRouter(config: Config) {
  const router = Router({ mergeParams: true });
  router.get(
    "/forms",
    requirePermission("settings.write"),
    async (req, res) => {
      const items = await Form.find({ tenantId: req.auth!.tenantId })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      res.json({
        items: items.map((f) => ({
          ...f,
          url: `${config.WEB_ORIGIN}/enquire/${f.publicKey}`,
        })),
      });
    },
  );
  router.post(
    "/forms",
    requirePermission("settings.write"),
    async (req, res) => {
      const input = formInput.parse(req.body);
      const result = await idempotent(
        req.auth!,
        "POST/forms",
        req.get("Idempotency-Key") ?? "",
        input,
        async (session) => {
          const tenant = await lockTenant(req.auth!.tenantId!, session);
          const plan = tenant.plan as keyof typeof planLimits;
          if (
            (await Form.countDocuments({
              tenantId: tenant._id,
              active: true,
            }).session(session)) >= planLimits[plan].forms
          )
            throw new AppError(
              429,
              "PLAN_LIMIT",
              "The workspace's active form allowance is reached.",
            );
          if (
            input.assignees.length &&
            (await Membership.countDocuments({
              tenantId: tenant._id,
              userId: { $in: [...new Set(input.assignees)] },
              status: "active",
              role: { $in: ["owner", "admin", "counselor"] },
            }).session(session)) !== new Set(input.assignees).size
          )
            throw new AppError(
              422,
              "INVALID_ASSIGNEE",
              "Choose active counselors or administrators from this workspace.",
            );
          const publicKey = `form_${randomToken()}`;
          const [form] = await Form.create(
            [
              {
                tenantId: tenant._id,
                ...input,
                ownerId: req.auth!.userId,
                publicKey,
              },
            ],
            { session },
          );
          await audit(
            req.auth!,
            "form.created",
            String(form._id),
            req.requestId,
            session,
          );
          return {
            id: form._id,
            publicKey,
            url: `${config.WEB_ORIGIN}/enquire/${publicKey}`,
          };
        },
      );
      res.status(201).json(result);
    },
  );
  router.patch(
    "/forms/:id",
    requirePermission("settings.write"),
    async (req, res) => {
      const { active } = z
        .object({ active: z.boolean() })
        .strict()
        .parse(req.body);
      await transaction(async (session) => {
        const tenant = await lockTenant(req.auth!.tenantId!, session);
        const form = await Form.findOne({
          tenantId: tenant._id,
          _id: String(req.params.id),
        })
          .session(session)
          .lean();
        if (!form) throw new AppError(404, "FORM_NOT_FOUND", "Form not found.");
        if (
          active &&
          !form.active &&
          (await Form.countDocuments({
            tenantId: tenant._id,
            active: true,
          }).session(session)) >=
            planLimits[tenant.plan as keyof typeof planLimits].forms
        )
          throw new AppError(
            429,
            "PLAN_LIMIT",
            "The active form allowance is reached.",
          );
        await Form.updateOne(
          { tenantId: tenant._id, _id: form._id },
          { $set: { active } },
          { session },
        );
        await audit(
          req.auth!,
          active ? "form.enabled" : "form.paused",
          String(form._id),
          req.requestId,
          session,
        );
      });
      res.json({ updated: true });
    },
  );
  router.get(
    "/journey/team",
    requirePermission("leads.write"),
    async (req, res) => {
      const members = await Membership.find({
        tenantId: req.auth!.tenantId,
        status: "active",
        role: { $in: ["owner", "admin", "counselor"] },
      }).lean();
      const users = await User.find({
        _id: { $in: members.map((m) => m.userId) },
      })
        .select("_id name")
        .lean();
      res.json({ items: users.map((u) => ({ id: u._id, name: u.name })) });
    },
  );
  router.get(
    "/journey/work",
    requirePermission("leads.read"),
    async (req, res) => {
      const assigned =
        req.auth!.role === "counselor" ? { assignedTo: req.auth!.userId } : {};
      const host =
        req.auth!.role === "counselor" ? { hostId: req.auth!.userId } : {};
      const [tasks, demos] = await Promise.all([
        Followup.find({
          tenantId: req.auth!.tenantId,
          ...assigned,
          status: "open",
        })
          .sort({ dueAt: 1 })
          .limit(100)
          .lean(),
        Appointment.find({
          tenantId: req.auth!.tenantId,
          ...host,
          status: "scheduled",
        })
          .sort({ scheduledAt: 1 })
          .limit(100)
          .lean(),
      ]);
      const ids = [
        ...new Set([
          ...tasks.map((t) => t.leadId),
          ...demos.map((d) => d.leadId),
        ]),
      ].filter((id): id is string => typeof id === "string");
      const leads = await Lead.find({
        ...leadScope(req.auth!),
        _id: { $in: ids },
      }).lean();
      const visible = new Set(leads.map((l) => l._id));
      const view = (item: any) => ({
        ...item,
        leadName: can(req.auth!.role!, "pii.read")
          ? leads.find((l) => l._id === item.leadId)?.name
          : "Restricted contact",
      });
      res.json({
        tasks: tasks.filter((t) => visible.has(String(t.leadId))).map(view),
        demos: demos.filter((d) => visible.has(String(d.leadId))).map(view),
      });
    },
  );
  router.get(
    "/journey/analytics",
    requirePermission("leads.read"),
    async (req, res) => {
      const days = z.coerce
        .number()
        .int()
        .min(1)
        .max(90)
        .parse(req.query.days ?? 30);
      res.json(await journeyAnalytics(req.auth!, days));
    },
  );
  router.get(
    "/leads/:leadId/journey",
    requirePermission("leads.read"),
    async (req, res) => {
      const lead = await Lead.findOne({
        ...leadScope(req.auth!),
        _id: String(req.params.leadId),
      })
        .select("+contactCipher")
        .lean();
      if (!lead) throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
      const scope = { tenantId: lead.tenantId, leadId: lead._id };
      const [
        tasks,
        demos,
        milestones,
        enrollments,
        orders,
        consent,
        suppression,
        calls,
      ] = await Promise.all([
        Followup.find(scope).sort({ dueAt: -1 }).limit(100).lean(),
        Appointment.find(scope).sort({ scheduledAt: -1 }).limit(100).lean(),
        Milestone.find(scope).sort({ occurredAt: 1 }).limit(200).lean(),
        Enrollment.find(scope).lean(),
        can(req.auth!.role!, "revenue.read")
          ? PaymentOrder.find(scope).sort({ createdAt: -1 }).limit(100).lean()
          : [],
        can(req.auth!.role!, "pii.read")
          ? Consent.find(scope).sort({ occurredAt: -1 }).limit(30).lean()
          : [],
        Suppression.exists(scope),
        can(req.auth!.role!, "pii.read")
          ? CallRecord.find(scope)
              .select("+summaryCipher +transcriptCipher")
              .sort({ endedAt: -1 })
              .limit(50)
              .lean()
          : [],
      ]);
      res.json({
        lead: leadView(lead, req.auth!.role!, config.DATA_ENCRYPTION_KEY),
        tasks,
        demos: demos.map((d) => ({
          ...d,
          note: can(req.auth!.role!, "pii.read") ? d.note : "",
        })),
        milestones,
        enrollments,
        orders,
        consent,
        suppressed: !!suppression,
        calls: calls.map(({ summaryCipher, transcriptCipher, ...call }) => ({
          ...call,
          summary: summaryCipher
            ? unseal(summaryCipher, config.DATA_ENCRYPTION_KEY, lead.tenantId)
            : "",
          transcript: transcriptCipher
            ? unseal(
                transcriptCipher,
                config.DATA_ENCRYPTION_KEY,
                lead.tenantId,
              )
            : "",
        })),
      });
    },
  );
  router.post(
    "/leads/:leadId/outcomes",
    requirePermission("leads.write"),
    async (req, res) => {
      const input = contactInput.parse(req.body),
        id = String(req.params.leadId),
        operation = req.get("Idempotency-Key") ?? "";
      res.json(
        await idempotent(
          req.auth!,
          `POST/leads/${id}/outcomes`,
          operation,
          input,
          async (session) => {
            const lead = await Lead.findOneAndUpdate(
              {
                ...leadScope(req.auth!),
                _id: id,
                erasedAt: { $exists: false },
              },
              { $set: { lastContactAt: new Date() }, $inc: { version: 1 } },
              { session, returnDocument: "after" },
            ).lean();
            if (!lead)
              throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
            await Followup.updateMany(
              { tenantId: lead.tenantId, leadId: id, status: "open" },
              {
                $set: {
                  status: "done",
                  outcome: input.outcome,
                  completedAt: new Date(),
                },
              },
              { session },
            );
            if (input.nextFollowupAt) {
              if (Date.parse(input.nextFollowupAt) <= Date.now())
                throw new AppError(
                  422,
                  "FOLLOWUP_IN_PAST",
                  "Choose a future follow-up time.",
                );
              await Followup.create(
                [
                  {
                    tenantId: lead.tenantId,
                    leadId: id,
                    assignedTo: lead.assignedTo,
                    title: "Follow up on enquiry",
                    dueAt: new Date(input.nextFollowupAt),
                    eventKey: `followup:${id}:${operation}`,
                  },
                ],
                { session },
              );
            }
            if (["wrong_number", "not_interested"].includes(input.outcome)) {
              await Suppression.updateOne(
                { tenantId: lead.tenantId, leadId: id },
                { $set: { reason: input.outcome } },
                { upsert: true, session },
              );
              await Command.updateMany(
                {
                  tenantId: lead.tenantId,
                  leadId: id,
                  status: { $in: ["pending_approval", "queued"] },
                },
                {
                  $set: {
                    status: "cancelled",
                    errorCode: "CONTACT_SUPPRESSED",
                  },
                },
                { session },
              );
            }
            await milestone(
              lead.tenantId,
              id,
              "contact_attempted",
              `contact:${operation}`,
              "counselor_record",
              session,
            );
            if (input.outcome === "answered")
              await milestone(
                lead.tenantId,
                id,
                "connected",
                `connected:${operation}`,
                "counselor_record",
                session,
              );
            await timeline(
              lead.tenantId,
              id,
              "contact.outcome.v1",
              `Contact: ${input.outcome.replaceAll("_", " ")}`,
              input.note,
              req.auth!.userId,
              session,
            );
            await audit(
              req.auth!,
              "contact.outcome_recorded",
              id,
              req.requestId,
              session,
            );
            return { updated: true };
          },
        ),
      );
    },
  );
  router.post(
    "/leads/:leadId/demos",
    requirePermission("leads.write"),
    async (req, res) => {
      const input = demoInput.parse(req.body),
        id = String(req.params.leadId),
        operation = req.get("Idempotency-Key") ?? "";
      res.status(201).json(
        await idempotent(
          req.auth!,
          `POST/leads/${id}/demos`,
          operation,
          input,
          async (session) => {
            await lockTenant(req.auth!.tenantId!, session);
            const lead = await Lead.findOne({
              ...leadScope(req.auth!),
              _id: id,
              erasedAt: { $exists: false },
            })
              .session(session)
              .lean();
            if (!lead)
              throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
            if (
              !(await Membership.exists({
                tenantId: lead.tenantId,
                userId: input.hostId,
                status: "active",
                role: { $in: ["owner", "admin", "counselor"] },
              }).session(session))
            )
              throw new AppError(
                422,
                "INVALID_HOST",
                "Choose an active counselor or administrator.",
              );
            const start = new Date(input.scheduledAt),
              end = new Date(+start + input.durationMinutes * 60000);
            if (+start < Date.now())
              throw new AppError(
                422,
                "DEMO_IN_PAST",
                "Choose a future demo time.",
              );
            const nearby = await Appointment.find({
              tenantId: lead.tenantId,
              hostId: input.hostId,
              status: "scheduled",
              scheduledAt: { $gte: new Date(+start - 120 * 60000), $lt: end },
            })
              .session(session)
              .lean();
            if (
              nearby.some(
                (d) =>
                  +new Date(d.scheduledAt!) +
                    Number(d.durationMinutes) * 60000 >
                  +start,
              )
            )
              throw new AppError(
                409,
                "HOST_BUSY",
                "This host already has a demo during that time.",
              );
            const [demo] = await Appointment.create(
              [
                {
                  tenantId: lead.tenantId,
                  leadId: id,
                  ...input,
                  scheduledAt: start,
                },
              ],
              { session },
            );
            if (!["enrolled", "lost"].includes(lead.stage))
              await Lead.updateOne(
                { tenantId: lead.tenantId, _id: id },
                { $set: { stage: "demo" }, $inc: { version: 1 } },
                { session },
              );
            await milestone(
              lead.tenantId,
              id,
              "demo_scheduled",
              `demo:${demo._id}`,
              "counselor_record",
              session,
            );
            await timeline(
              lead.tenantId,
              id,
              "demo.scheduled.v1",
              "Demo scheduled",
              start.toISOString(),
              req.auth!.userId,
              session,
            );
            await audit(
              req.auth!,
              "demo.scheduled",
              String(demo._id),
              req.requestId,
              session,
            );
            return { id: demo._id };
          },
        ),
      );
    },
  );
  router.patch(
    "/demos/:id",
    requirePermission("leads.write"),
    async (req, res) => {
      const input = demoOutcomeInput.parse(req.body);
      await transaction(async (session) => {
        const demo = await Appointment.findOne({
          tenantId: req.auth!.tenantId,
          _id: String(req.params.id),
          version: input.version,
          status: "scheduled",
        })
          .session(session)
          .lean();
        if (!demo)
          throw new AppError(
            409,
            "DEMO_CHANGED",
            "This demo changed. Refresh and try again.",
          );
        if (
          !(await Lead.exists({
            ...leadScope(req.auth!),
            _id: demo.leadId,
          }).session(session))
        )
          throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found.");
        if (
          input.status !== "cancelled" &&
          +new Date(demo.scheduledAt!) > Date.now()
        )
          throw new AppError(
            422,
            "DEMO_NOT_STARTED",
            "Attendance can be recorded after the demo starts.",
          );
        await Appointment.updateOne(
          { tenantId: demo.tenantId, _id: demo._id, version: input.version },
          {
            $set: {
              status: input.status,
              outcome: input.outcome,
              note: input.note,
            },
            $inc: { version: 1 },
          },
          { session },
        );
        await milestone(
          String(demo.tenantId),
          String(demo.leadId),
          `demo_${input.status}`,
          `demo-outcome:${demo._id}`,
          "counselor_record",
          session,
        );
        if (input.status === "no_show" || input.outcome === "follow_up") {
          const lead = await Lead.findOne({
            tenantId: demo.tenantId,
            _id: demo.leadId,
          })
            .session(session)
            .lean();
          await Followup.create(
            [
              {
                tenantId: demo.tenantId,
                leadId: demo.leadId,
                assignedTo: lead!.assignedTo,
                title: "Follow up after demo",
                dueAt: new Date(Date.now() + 3600000),
                eventKey: `demo-followup:${demo._id}`,
              },
            ],
            { session },
          );
        }
        await timeline(
          String(demo.tenantId),
          String(demo.leadId),
          "demo.outcome.v1",
          `Demo ${input.status.replaceAll("_", " ")}`,
          input.note,
          req.auth!.userId,
          session,
        );
        await audit(
          req.auth!,
          "demo.outcome_recorded",
          String(demo._id),
          req.requestId,
          session,
        );
      });
      res.json({ updated: true });
    },
  );
  return router;
}
