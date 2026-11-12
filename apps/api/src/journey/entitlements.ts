import type { ClientSession } from "mongoose";
import { Tenant } from "../models.ts";
import { Usage } from "./models.ts";
import { planLimits } from "../../../../packages/core/src/journey.ts";
import { AppError } from "../errors.ts";
export async function reserveUsage(
  tenantId: string,
  metric: "leads" | "commands",
  session: ClientSession,
) {
  const tenant = await Tenant.findById(tenantId).session(session).lean();
  const plan = (tenant?.plan ?? "pilot") as keyof typeof planLimits;
  const period = new Date().toISOString().slice(0, 7);
  const counter = await Usage.findOneAndUpdate(
    { tenantId, period, metric },
    { $inc: { count: 1 } },
    { upsert: true, returnDocument: "after", session },
  );
  if (Number(counter?.count ?? 0) > planLimits[plan][metric])
    throw new AppError(
      429,
      "PLAN_LIMIT",
      `The workspace's monthly ${metric} allowance is reached.`,
    );
}
export async function lockTenant(tenantId: string, session: ClientSession) {
  const tenant = await Tenant.findOneAndUpdate(
    { _id: tenantId },
    { $inc: { lockVersion: 1 } },
    { session, returnDocument: "after" },
  ).lean();
  if (!tenant)
    throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  return tenant;
}
