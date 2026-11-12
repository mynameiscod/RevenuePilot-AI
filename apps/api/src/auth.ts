import type { Request, Response, NextFunction } from "express";
import { Membership, Session, Tenant, User } from "./models.ts";
import { digest, equal, randomToken } from "./security.ts";
import { AppError } from "./errors.ts";
import {
  can,
  type Role,
  type SessionView,
} from "../../../packages/core/src/contracts.ts";
import type { Config } from "./config.ts";

export interface AuthContext {
  userId: string;
  sessionId: string;
  csrfToken: string;
  authenticatedAt: Date;
  tenantId?: string;
  role?: Role;
}
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId: string;
    }
  }
}
export function cookieName(config: Config) {
  return config.NODE_ENV === "production" ? "__Host-rp_session" : "rp_session";
}
export async function issueSession(
  userId: string,
  res: Response,
  config: Config,
) {
  const token = randomToken();
  const session = await Session.create({
    userId,
    tokenHash: digest(token),
    csrfToken: randomToken(),
    expiresAt: new Date(Date.now() + 8 * 3600000),
    authenticatedAt: new Date(),
  });
  res.cookie(cookieName(config), token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 3600000,
  });
  return {
    userId,
    sessionId: session._id,
    csrfToken: session.csrfToken,
    authenticatedAt: session.authenticatedAt,
  };
}
export function requireSession(config: Config) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[cookieName(config)];
    if (typeof token !== "string")
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    const session = await Session.findOne({
      tokenHash: digest(token),
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!session)
      throw new AppError(
        401,
        "SESSION_EXPIRED",
        "Your session has expired. Please sign in.",
      );
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !equal(req.get("X-CSRF-Token") ?? "", session.csrfToken)
    )
      throw new AppError(
        403,
        "CSRF_INVALID",
        "Refresh the page and try again.",
      );
    req.auth = {
      userId: session.userId,
      sessionId: session._id,
      csrfToken: session.csrfToken,
      authenticatedAt: session.authenticatedAt,
    };
    next();
  };
}
export async function requireTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const tenantId = String(req.params.tenantId);
  const member = await Membership.findOne({
    tenantId,
    userId: req.auth!.userId,
    status: "active",
  }).lean();
  if (!member)
    throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  req.auth = { ...req.auth!, tenantId, role: member.role as Role };
  next();
}
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth?.role || !can(req.auth.role, permission))
      throw new AppError(
        403,
        "FORBIDDEN",
        "Your role cannot perform this action.",
      );
    next();
  };
}
export function leadScope(auth: AuthContext) {
  return auth.role === "counselor"
    ? { tenantId: auth.tenantId!, assignedTo: auth.userId }
    : { tenantId: auth.tenantId! };
}
export async function sessionView(auth: AuthContext): Promise<SessionView> {
  const user = await User.findById(auth.userId).lean();
  if (!user)
    throw new AppError(401, "UNAUTHENTICATED", "Account no longer exists.");
  const memberships = await Membership.find({
    userId: user._id,
    status: "active",
  }).lean();
  const tenants = await Tenant.find({
    _id: { $in: memberships.map((m) => m.tenantId) },
  })
    .sort({ name: 1, _id: 1 })
    .lean();
  return {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      mfaEnabled: user.mfaEnabled,
      emailVerified: !!user.emailVerifiedAt,
    },
    tenants: tenants.map((t) => ({
      id: t._id,
      name: t.name,
      currency: t.currency,
      timezone: t.timezone,
      demo: t.demo,
      role: memberships.find((m) => m.tenantId === t._id)!.role as Role,
      retentionDays: t.retentionDays,
      firstResponseMinutes: t.firstResponseMinutes,
      attributionModel: t.attributionModel,
    })),
    csrfToken: auth.csrfToken,
  };
}
