import express, { Router } from "express";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.ts";
import { Tenant, User } from "../models.ts";
import { Billing, Webhook } from "./models.ts";
import { digest, seal, unseal } from "../security.ts";
import { AppError } from "../errors.ts";
import { transaction } from "../db.ts";
import { audit } from "../services.ts";
import { rateLimit } from "../rate-limit.ts";
function client(config: Config) {
  if (
    !config.BILLING_STRIPE_SECRET_KEY ||
    !config.BILLING_STRIPE_WEBHOOK_SECRET ||
    config.REVENUEPILOT_DEMO === "true"
  )
    throw new AppError(
      422,
      "BILLING_NOT_CONFIGURED",
      "Workspace subscriptions are not enabled for this installation.",
    );
  if (
    config.BILLING_STRIPE_SECRET_KEY.includes("_live_") &&
    config.ALLOW_LIVE_PROVIDERS !== "true"
  )
    throw new AppError(
      403,
      "LIVE_EXECUTION_DISABLED",
      "Live billing is disabled for this installation.",
    );
  return new Stripe(config.BILLING_STRIPE_SECRET_KEY, {
    maxNetworkRetries: 0,
    timeout: 15000,
  });
}
export function billingRouter(config: Config) {
  const router = Router({ mergeParams: true });
  router.use("/billing", (req, _res, next) => {
    if (req.auth!.role !== "owner")
      throw new AppError(
        403,
        "OWNER_REQUIRED",
        "Only a workspace owner can manage its subscription.",
      );
    next();
  });
  router.get("/billing", async (req, res) => {
    const tenant = await Tenant.findById(req.auth!.tenantId).lean(),
      billing = await Billing.findOne({ tenantId: req.auth!.tenantId }).lean();
    res.json({
      plan: tenant!.plan,
      status: tenant!.billingStatus,
      configured:
        !!config.BILLING_STRIPE_SECRET_KEY &&
        !!config.BILLING_STRIPE_WEBHOOK_SECRET &&
        config.REVENUEPILOT_DEMO !== "true",
      availablePlans: [
        config.BILLING_PRICE_GROWTH ? "growth" : null,
        config.BILLING_PRICE_SCALE ? "scale" : null,
      ].filter(Boolean),
      subscription: billing
        ? { status: billing.status, periodEnd: billing.periodEnd }
        : null,
    });
  });
  router.post("/billing/checkout", async (req, res) => {
    const { plan } = z
      .object({ plan: z.enum(["growth", "scale"]) })
      .strict()
      .parse(req.body);
    const stripe = client(config),
      price =
        plan === "growth"
          ? config.BILLING_PRICE_GROWTH
          : config.BILLING_PRICE_SCALE;
    if (!price)
      throw new AppError(
        422,
        "PLAN_UNAVAILABLE",
        "This plan has not been priced by the operator.",
      );
    await rateLimit(`billing:${req.auth!.tenantId}`, 5, 3600000);
    const user = await User.findById(req.auth!.userId).lean(),
      tenantId = req.auth!.tenantId!;
    if (!user?.emailVerifiedAt)
      throw new AppError(
        403,
        "VERIFIED_EMAIL_REQUIRED",
        "Verify your email before subscribing.",
      );
    let billing = await Billing.findOne({ tenantId }).lean();
    if (
      billing?.providerSubscriptionId &&
      ["active", "trialing", "past_due"].includes(String(billing.status))
    )
      throw new AppError(
        409,
        "SUBSCRIPTION_EXISTS",
        "Manage your existing subscription through the billing portal.",
      );
    if (
      billing?.checkoutUrl &&
      billing.checkoutExpiresAt &&
      +billing.checkoutExpiresAt > Date.now()
    ) {
      res.json({ url: billing.checkoutUrl });
      return;
    }
    if (!billing?.providerCustomerId) {
      const customer = await stripe.customers.create(
        { email: user.email, metadata: { rpTenantId: tenantId } },
        { idempotencyKey: `rp-customer-${tenantId}` },
      );
      await Billing.updateOne(
        { tenantId },
        { $set: { providerCustomerId: customer.id } },
        { upsert: true },
      );
      billing = await Billing.findOne({ tenantId }).lean();
    }
    const priceInfo = await stripe.prices.retrieve(price);
    if (
      !priceInfo.active ||
      !priceInfo.recurring ||
      priceInfo.livemode !==
        config.BILLING_STRIPE_SECRET_KEY!.includes("_live_")
    )
      throw new AppError(
        422,
        "INVALID_BILLING_PRICE",
        "Configure an active recurring price for this billing environment.",
      );
    const key = `rp-subscription-${tenantId}-${new Date().toISOString().slice(0, 10)}`;
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: billing!.providerCustomerId!,
        line_items: [{ price, quantity: 1 }],
        client_reference_id: tenantId,
        subscription_data: { metadata: { rpTenantId: tenantId } },
        success_url: `${config.WEB_ORIGIN}/account-settings?billing=received`,
        cancel_url: `${config.WEB_ORIGIN}/account-settings?billing=cancelled`,
      },
      { idempotencyKey: key },
    );
    await transaction(async (session) => {
      await Billing.updateOne(
        { tenantId },
        {
          $set: {
            checkoutKey: key,
            checkoutUrl: checkout.url,
            checkoutExpiresAt: new Date(checkout.expires_at * 1000),
          },
        },
        { session },
      );
      await audit(
        req.auth!,
        "billing.checkout_created",
        tenantId,
        req.requestId,
        session,
      );
    });
    res.json({ url: checkout.url });
  });
  router.post("/billing/portal", async (req, res) => {
    const billing = await Billing.findOne({
      tenantId: req.auth!.tenantId,
    }).lean();
    if (!billing?.providerCustomerId)
      throw new AppError(
        422,
        "BILLING_CUSTOMER_MISSING",
        "No billing account exists yet.",
      );
    const portal = await client(config).billingPortal.sessions.create({
      customer: billing.providerCustomerId,
      return_url: `${config.WEB_ORIGIN}/account-settings`,
    });
    res.json({ url: portal.url });
  });
  return router;
}
export function billingWebhookRouter(config: Config) {
  const router = Router();
  router.post(
    "/",
    express.raw({ type: "application/json", limit: "512kb" }),
    async (req, res) => {
      let event: Stripe.Event;
      try {
        event = client(config).webhooks.constructEvent(
          req.body,
          req.get("Stripe-Signature") ?? "",
          config.BILLING_STRIPE_WEBHOOK_SECRET!,
        );
      } catch {
        throw new AppError(
          400,
          "INVALID_WEBHOOK_SIGNATURE",
          "Billing webhook verification failed.",
        );
      }
      if (
        event.livemode !== config.BILLING_STRIPE_SECRET_KEY!.includes("_live_")
      )
        throw new AppError(
          400,
          "BILLING_MODE_MISMATCH",
          "Billing event mode does not match.",
        );
      const customerId = (event.data.object as { customer?: unknown }).customer;
      if (typeof customerId !== "string") {
        res.status(202).json({ ignored: true });
        return;
      }
      const billing = await Billing.findOne({
        providerCustomerId: customerId,
      }).lean();
      if (!billing) {
        res.status(202).json({ ignored: true });
        return;
      }
      try {
        await Webhook.create({
          tenantId: billing.tenantId,
          connectionId: "platform-billing",
          externalId: event.id,
          bodyHash: digest(req.body.toString("utf8")),
          payloadCipher: seal(
            event,
            config.DATA_ENCRYPTION_KEY,
            billing.tenantId,
          ),
        });
      } catch (error: any) {
        if (error.code !== 11000) throw error;
        const previous = await Webhook.findOne({
          connectionId: "platform-billing",
          externalId: event.id,
        }).lean();
        if (previous?.bodyHash !== digest(req.body.toString("utf8")))
          throw new AppError(
            409,
            "WEBHOOK_REPLAY_CONFLICT",
            "Event ID was reused with a different payload.",
          );
      }
      res.status(202).json({ accepted: true });
    },
  );
  return router;
}
export async function processBillingWebhook(hookId: string, config: Config) {
  const hook = await Webhook.findOne({
    _id: hookId,
    connectionId: "platform-billing",
    status: "processing",
  })
    .select("+payloadCipher")
    .lean();
  if (!hook) return;
  const event = unseal<Stripe.Event>(
      String(hook.payloadCipher),
      config.DATA_ENCRYPTION_KEY,
      hook.tenantId,
    ),
    stripe = client(config);
  const billing = await Billing.findOne({ tenantId: hook.tenantId }).lean();
  const object = event.data.object as any;
  let subscriptionId = event.type.startsWith("customer.subscription.")
    ? object.id
    : (object.parent?.subscription_details?.subscription ??
      object.subscription);
  if (event.type === "checkout.session.completed")
    subscriptionId = object.subscription;
  if (
    typeof subscriptionId !== "string" ||
    !billing ||
    ![
      "invoice.paid",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "checkout.session.completed",
      "invoice.payment_failed",
    ].includes(event.type)
  ) {
    await Webhook.updateOne(
      { _id: hookId },
      {
        $set: { status: "ignored", processedAt: new Date() },
        $unset: { payloadCipher: 1 },
      },
    );
    return;
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice"],
  });
  if (
    subscription.customer !== billing.providerCustomerId ||
    subscription.metadata.rpTenantId !== hook.tenantId
  )
    throw new Error("BILLING_SUBSCRIPTION_MISMATCH");
  if (
    billing.providerSubscriptionId &&
    billing.providerSubscriptionId !== subscription.id
  ) {
    const current = await stripe.subscriptions.retrieve(
      billing.providerSubscriptionId,
    );
    // Late events from a replaced subscription must never downgrade its successor.
    if (
      !["canceled", "incomplete_expired"].includes(current.status) ||
      ["canceled", "incomplete_expired"].includes(subscription.status)
    ) {
      await Webhook.updateOne(
        { _id: hookId, tenantId: hook.tenantId },
        {
          $set: { status: "ignored", processedAt: new Date() },
          $unset: { payloadCipher: 1 },
        },
      );
      return;
    }
  }
  const invoice =
    typeof subscription.latest_invoice === "object"
      ? subscription.latest_invoice
      : null;
  const price = subscription.items.data[0]?.price.id;
  const eligible =
    subscription.status === "active" &&
    invoice?.status === "paid" &&
    subscription.items.data.length === 1;
  const plan =
    eligible && price === config.BILLING_PRICE_SCALE
      ? "scale"
      : eligible && price === config.BILLING_PRICE_GROWTH
        ? "growth"
        : "pilot";
  await transaction(async (session) => {
    await Billing.updateOne(
      {
        tenantId: hook.tenantId,
        providerCustomerId: billing.providerCustomerId,
      },
      {
        $set: {
          providerSubscriptionId: subscription.id,
          priceId: price,
          status: subscription.status,
          periodEnd: subscription.items.data[0]
            ? new Date(subscription.items.data[0].current_period_end * 1000)
            : null,
        },
        $unset: { checkoutUrl: 1 },
      },
      { session },
    );
    await Tenant.updateOne(
      { _id: hook.tenantId },
      { $set: { plan, billingStatus: subscription.status } },
      { session },
    );
    await Webhook.updateOne(
      { _id: hookId, tenantId: hook.tenantId },
      {
        $set: { status: "processed", processedAt: new Date() },
        $unset: { payloadCipher: 1 },
      },
      { session },
    );
    await audit(
      {
        tenantId: hook.tenantId,
        userId: "billing-worker",
        sessionId: "worker",
        csrfToken: "",
        authenticatedAt: new Date(),
      },
      "billing.entitlements_reconciled",
      hook.tenantId,
      event.id,
      session,
    );
  });
}
