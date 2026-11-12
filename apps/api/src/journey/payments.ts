import express, { Router } from "express";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { Connection, Lead, Receipt } from "../models.ts";
import {
  Acceptance,
  Form,
  PaymentOrder,
  Enrollment,
  Webhook,
  Consent,
  Suppression,
  Command,
} from "./models.ts";
import { allowedWebOrigins, type Config } from "../config.ts";
import { digest, equal, seal, unseal } from "../security.ts";
import { AppError } from "../errors.ts";
import { transaction } from "../db.ts";
import { requirePermission } from "../auth.ts";
import { createReceipt, timeline, audit, idempotent } from "../services.ts";
import { milestone } from "./evidence.ts";
import { rateLimit } from "../rate-limit.ts";
import {
  createCheckout,
  stripeClient,
  verifyCheckout,
  type VerifiedPayment,
} from "../../../../packages/connectors/src/adapters/payments.ts";
import { ProviderError } from "../../../../packages/connectors/src/http.ts";

const systemAuth = (tenantId: string) => ({
  tenantId,
  userId: "payment-processor",
  role: "owner" as const,
  sessionId: "worker",
  csrfToken: "",
  authenticatedAt: new Date(),
});
export async function paymentConnection(
  id: string,
  tenantId: string,
  config: Config,
) {
  const connection = await Connection.findOne({
    _id: id,
    tenantId,
    provider: { $in: ["stripe", "razorpay"] },
    status: { $in: ["test", "active"] },
  })
    .select("+credentialCipher")
    .lean();
  if (!connection?.credentialCipher)
    throw new AppError(
      422,
      "PAYMENT_CONNECTION_UNAVAILABLE",
      "Activate a tested payment connection first.",
    );
  if (connection.mode === "live" && config.ALLOW_LIVE_PROVIDERS !== "true")
    throw new AppError(
      403,
      "LIVE_EXECUTION_DISABLED",
      "Live provider execution is disabled for this installation.",
    );
  return {
    connection,
    credentials: unseal<Record<string, string>>(
      connection.credentialCipher,
      config.DATA_ENCRYPTION_KEY,
      tenantId,
    ),
  };
}

export async function settleOrder(
  orderId: string,
  tenantId: string,
  evidence: VerifiedPayment,
  eventId: string,
  sandbox = false,
) {
  return transaction(async (session) => {
    const order = await PaymentOrder.findOne({ _id: orderId, tenantId })
      .session(session)
      .lean();
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order not found.");
    if (
      evidence.orderId !== orderId ||
      evidence.externalId !== order.externalId ||
      evidence.currency !== order.currency ||
      evidence.amountMinor !== order.amountMinor ||
      evidence.live !== (order.mode === "live") ||
      sandbox !== (order.mode === "sandbox") ||
      !evidence.paid
    )
      throw new AppError(
        422,
        "PAYMENT_EVIDENCE_MISMATCH",
        "Payment evidence does not match the stored order.",
      );
    if (
      !/^\d+$/.test(evidence.refundedMinor) ||
      BigInt(evidence.refundedMinor) > BigInt(order.amountMinor!)
    )
      throw new AppError(
        422,
        "REFUND_EVIDENCE_MISMATCH",
        "Refund evidence is invalid.",
      );
    if (
      order.externalPaymentId &&
      order.externalPaymentId !== evidence.paymentId
    )
      throw new AppError(
        409,
        "PAYMENT_ID_MISMATCH",
        "This order has another payment reference.",
      );
    const verified = {
      evidence: sandbox
        ? ("sandbox" as const)
        : order.mode === "live"
          ? ("provider_verified" as const)
          : ("provider_test" as const),
      paymentOrderId: orderId,
      providerEventId: eventId,
    };
    let receiptId = order.receiptId;
    if (!receiptId) {
      const receipt = await createReceipt(
        systemAuth(tenantId),
        {
          leadId: String(order.leadId),
          kind: "capture",
          amountMinor: String(order.amountMinor),
          currency: order.currency as "INR" | "USD" | "AED",
          reference: `order:${orderId}`,
          note: "Confirmed by payment reconciliation.",
        },
        eventId,
        session,
        verified,
      );
      receiptId = receipt.id;
      const lead = await Lead.findOne({ tenantId, _id: order.leadId })
        .session(session)
        .lean();
      await Enrollment.create(
        [
          {
            tenantId,
            leadId: order.leadId,
            course: lead!.course,
            orderId,
            evidence: verified.evidence,
            confirmedAt: new Date(),
          },
        ],
        { session },
      );
      await Lead.updateOne(
        { tenantId, _id: order.leadId },
        { $set: { stage: "enrolled" }, $inc: { version: 1 } },
        { session },
      );
      await milestone(
        tenantId,
        String(order.leadId),
        "payment_captured",
        `payment:${orderId}`,
        verified.evidence,
        session,
      );
      await milestone(
        tenantId,
        String(order.leadId),
        "enrollment_confirmed",
        `enrollment:${orderId}`,
        verified.evidence,
        session,
      );
      await timeline(
        tenantId,
        String(order.leadId),
        "enrollment.confirmed.v1",
        sandbox
          ? "Sandbox enrollment confirmed"
          : "Payment-backed enrollment confirmed",
        "Independent RevenuePilot enrollment evidence.",
        "payment-processor",
        session,
      );
    }
    const capture = await Receipt.findOne({ _id: receiptId, tenantId })
      .session(session)
      .lean();
    const difference =
      BigInt(evidence.refundedMinor) - BigInt(capture!.refundedMinor);
    // Older webhook deliveries may report less cumulative refund than a newer
    // provider lookup; never subtract already reconciled refunds.
    if (difference > 0n) {
      await createReceipt(
        systemAuth(tenantId),
        {
          leadId: String(order.leadId),
          kind: "refund",
          amountMinor: difference.toString(),
          currency: order.currency as "INR" | "USD" | "AED",
          reference: `refund:${orderId}:${evidence.refundedMinor}`,
          originalReceiptId: receiptId!,
          note: "Cumulative refund confirmed by payment reconciliation.",
        },
        eventId,
        session,
        verified,
      );
      await Enrollment.updateOne(
        { tenantId, orderId },
        { $set: { status: "review_required" } },
        { session },
      );
      await milestone(
        tenantId,
        String(order.leadId),
        "payment_refunded",
        `refund:${orderId}:${evidence.refundedMinor}`,
        verified.evidence,
        session,
      );
    }
    const reconciledRefund =
      difference > 0n
        ? BigInt(evidence.refundedMinor)
        : BigInt(capture!.refundedMinor);
    const status =
      reconciledRefund >= BigInt(order.amountMinor!) ? "refunded" : "paid";
    await PaymentOrder.updateOne(
      { _id: orderId, tenantId },
      {
        $set: {
          receiptId,
          externalPaymentId: evidence.paymentId,
          status,
          settledAt: new Date(),
        },
      },
      { session },
    );
    return { orderId, status, evidence: verified.evidence };
  });
}

async function orderForAcceptance(token: string) {
  const accepted = await Acceptance.findOne({
    tokenHash: digest(token),
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!accepted)
    throw new AppError(
      404,
      "CHECKOUT_EXPIRED",
      "This enquiry confirmation has expired.",
    );
  const form = await Form.findOne({
    tenantId: accepted.tenantId,
    _id: accepted.formId,
    active: true,
  }).lean();
  if (!form)
    throw new AppError(
      404,
      "FORM_UNAVAILABLE",
      "This enquiry form is unavailable.",
    );
  return { accepted, form };
}
async function startOrder(accepted: any, form: any, config: Config) {
  const requestKey = `offer:${accepted.leadId}:${form._id}`;
  let order = await PaymentOrder.findOne({
    tenantId: accepted.tenantId,
    requestKey,
  }).lean();
  if (!order) {
    let provider = "sandbox",
      mode = "sandbox",
      connectionId: string | undefined;
    if (form.paymentConnectionId) {
      const { connection } = await paymentConnection(
        form.paymentConnectionId,
        accepted.tenantId,
        config,
      );
      provider = connection.provider;
      mode = connection.mode;
      connectionId = connection._id;
    } else if (config.NODE_ENV === "production")
      throw new AppError(
        422,
        "PAYMENTS_NOT_CONFIGURED",
        "Contact this workspace to arrange payment.",
      );
    try {
      await PaymentOrder.create({
        tenantId: accepted.tenantId,
        leadId: accepted.leadId,
        formId: form._id,
        amountMinor: form.amountMinor,
        currency: form.currency,
        provider,
        mode,
        connectionId,
        requestKey,
        ...(mode === "sandbox"
          ? { externalId: `sandbox_${randomUUID()}` }
          : {}),
      });
    } catch (error: any) {
      if (error.code !== 11000) throw error;
    }
    order = await PaymentOrder.findOne({
      tenantId: accepted.tenantId,
      requestKey,
    }).lean();
  }
  if (order!.mode !== "sandbox" && order!.status === "created") {
    // Claim before network I/O. An interrupted create becomes unknown and requires
    // reconciliation; a second browser request must not create a second charge.
    const claimed = await PaymentOrder.findOneAndUpdate(
      { tenantId: order!.tenantId, _id: order!._id, status: "created" },
      { $set: { status: "unknown" } },
      { returnDocument: "after" },
    ).lean();
    if (claimed) {
      const { connection, credentials } = await paymentConnection(
        String(claimed.connectionId),
        claimed.tenantId,
        config,
      );
      try {
        const checkout = await createCheckout(
          connection.provider,
          credentials,
          {
            orderId: claimed._id,
            amountMinor: String(claimed.amountMinor),
            currency: String(claimed.currency),
            course: String(form.course),
            returnUrl: `${config.WEB_ORIGIN}/payment-return`,
            mode: connection.mode,
          },
        );
        await PaymentOrder.updateOne(
          { tenantId: claimed.tenantId, _id: claimed._id, status: "unknown" },
          {
            $set: {
              externalId: checkout.externalId,
              checkoutUrl: checkout.url,
              status: "pending",
            },
          },
        );
      } catch {
        throw new AppError(
          502,
          "CHECKOUT_RECONCILIATION_REQUIRED",
          "Checkout could not be confirmed. Contact this workspace before trying another payment.",
        );
      }
    }
    order = await PaymentOrder.findOne({
      tenantId: order!.tenantId,
      _id: order!._id,
    }).lean();
  }
  return order!;
}
export function checkoutRouter(config: Config) {
  const router = Router();
  router.use(async (req, _res, next) => {
    if (!allowedWebOrigins(config).has(req.get("Origin") ?? ""))
      throw new AppError(
        403,
        "ORIGIN_DENIED",
        "Open checkout on the RevenuePilot website.",
      );
    await rateLimit(`checkout:${req.ip}`, 30);
    next();
  });
  const tokenInput = z
    .object({ acceptanceToken: z.string().min(30).max(100) })
    .strict();
  router.post("/withdraw-consent", async (req, res) => {
    const accepted = await Acceptance.findOne({
      tokenHash: digest(tokenInput.parse(req.body).acceptanceToken),
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!accepted)
      throw new AppError(
        404,
        "CHECKOUT_EXPIRED",
        "This enquiry confirmation has expired. Contact the workspace to update your preferences.",
      );
    await transaction(async (session) => {
      const scope = { tenantId: accepted.tenantId, leadId: accepted.leadId };
      await Consent.create(
        ["marketing", "tracking", "ad_measurement", "ai_analysis"].map(
          (purpose) => ({
            ...scope,
            purpose,
            version: "self-service",
            granted: false,
            occurredAt: new Date(),
          }),
        ),
        { session, ordered: true },
      );
      await Suppression.updateOne(
        scope,
        { $set: { reason: "self_service_opt_out" } },
        { upsert: true, session },
      );
      await Command.updateMany(
        { ...scope, status: { $in: ["queued", "pending_approval"] } },
        { $set: { status: "cancelled", errorCode: "CONSENT_WITHDRAWN" } },
        { session },
      );
      await timeline(
        accepted.tenantId,
        String(accepted.leadId),
        "consent.withdrawn.v1",
        "Optional consent withdrawn",
        "Requested through the enquiry confirmation link.",
        "contact",
        session,
      );
    });
    res.json({ withdrawn: true });
  });
  router.post("/status", async (req, res) => {
    const { accepted, form } = await orderForAcceptance(
      tokenInput.parse(req.body).acceptanceToken,
    );
    const order = await PaymentOrder.findOne({
      tenantId: accepted.tenantId,
      requestKey: `offer:${accepted.leadId}:${form._id}`,
    }).lean();
    const connection = form.paymentConnectionId
      ? await Connection.findOne({
          _id: form.paymentConnectionId,
          tenantId: accepted.tenantId,
        })
          .select("mode")
          .lean()
      : null;
    res.json({
      course: form.course,
      amountMinor: form.amountMinor,
      currency: form.currency,
      mode: order?.mode ?? connection?.mode ?? "sandbox",
      order: order
        ? { id: order._id, mode: order.mode, status: order.status }
        : null,
      sandbox: !form.paymentConnectionId && config.NODE_ENV !== "production",
    });
  });
  router.post("/start", async (req, res) => {
    const { accepted, form } = await orderForAcceptance(
      tokenInput.parse(req.body).acceptanceToken,
    );
    const order = await startOrder(accepted, form, config);
    res.json({
      id: order._id,
      mode: order.mode,
      status: order.status,
      url: order.checkoutUrl,
    });
  });
  router.post("/simulate", async (req, res) => {
    if (config.NODE_ENV === "production")
      throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
    const { accepted, form } = await orderForAcceptance(
      tokenInput.parse(req.body).acceptanceToken,
    );
    const order = await startOrder(accepted, form, config);
    if (order.mode !== "sandbox")
      throw new AppError(
        403,
        "SANDBOX_ONLY",
        "Only sandbox orders can be simulated.",
      );
    res.json(
      await settleOrder(
        order._id,
        order.tenantId,
        {
          orderId: order._id,
          externalId: String(order.externalId),
          paymentId: String(order.externalId),
          amountMinor: String(order.amountMinor),
          refundedMinor: "0",
          currency: String(order.currency),
          paid: true,
          live: false,
        },
        `sandbox:${order._id}`,
        true,
      ),
    );
  });
  return router;
}

export function paymentAdminRouter(config: Config) {
  const router = Router({ mergeParams: true });
  router.get(
    "/checkout/forms",
    requirePermission("revenue.write"),
    async (req, res) => {
      res.json({
        items: await Form.find({ tenantId: req.auth!.tenantId, active: true })
          .select("_id course amountMinor currency")
          .limit(200)
          .lean(),
      });
    },
  );
  router.post(
    "/leads/:leadId/checkout-link",
    requirePermission("revenue.write"),
    async (req, res) => {
      const input = z
          .object({ formId: z.string().max(100) })
          .strict()
          .parse(req.body),
        operation = req.get("Idempotency-Key") ?? "",
        leadId = String(req.params.leadId),
        tenantId = req.auth!.tenantId!;
      const token = createHmac(
        "sha256",
        Buffer.from(config.DATA_ENCRYPTION_KEY, "hex"),
      )
        .update(
          `checkout:${tenantId}:${leadId}:${input.formId}:${req.auth!.userId}:${operation}`,
        )
        .digest("base64url");
      await idempotent(
        req.auth!,
        `POST/leads/${leadId}/checkout-link`,
        operation,
        input,
        async (session) => {
          const lead = await Lead.findOne({
            _id: leadId,
            tenantId,
            erasedAt: { $exists: false },
          })
            .session(session)
            .lean();
          const form = await Form.findOne({
            _id: input.formId,
            tenantId,
            active: true,
          })
            .session(session)
            .lean();
          if (!lead || !form)
            throw new AppError(
              404,
              "CHECKOUT_NOT_FOUND",
              "Lead or form not found.",
            );
          if (lead.course !== form.course)
            throw new AppError(
              422,
              "COURSE_MISMATCH",
              "Choose an offer matching this lead's course.",
            );
          const [accepted] = await Acceptance.create(
            [
              {
                tenantId,
                leadId,
                formId: form._id,
                attemptId: `checkout_${randomUUID()}`,
                requestHash: digest(JSON.stringify(input)),
                tokenHash: digest(token),
                expiresAt: new Date(Date.now() + 86400000),
              },
            ],
            { session },
          );
          await audit(
            req.auth!,
            "payment.link_created",
            leadId,
            req.requestId,
            session,
          );
          return { id: accepted._id };
        },
      );
      res
        .status(201)
        .json({
          url: `${config.WEB_ORIGIN}/checkout#${token}`,
          expiresInSeconds: 86400,
        });
    },
  );
  router.put(
    "/forms/:id/payment",
    requirePermission("connections.write"),
    async (req, res) => {
      const { connectionId } = z
        .object({ connectionId: z.string().max(100).nullable() })
        .strict()
        .parse(req.body);
      if (connectionId)
        await paymentConnection(connectionId, req.auth!.tenantId!, config);
      await transaction(async (session) => {
        const result = await Form.updateOne(
          { tenantId: req.auth!.tenantId, _id: String(req.params.id) },
          { $set: { paymentConnectionId: connectionId } },
          { session },
        );
        if (!result.matchedCount)
          throw new AppError(404, "FORM_NOT_FOUND", "Form not found.");
        await audit(
          req.auth!,
          "form.payment_configured",
          String(req.params.id),
          req.requestId,
          session,
        );
      });
      res.json({ updated: true });
    },
  );
  router.post(
    "/orders/:id/reconcile",
    requirePermission("revenue.write"),
    async (req, res) => {
      const order = await PaymentOrder.findOne({
        tenantId: req.auth!.tenantId,
        _id: String(req.params.id),
      }).lean();
      if (!order?.externalId || !order.connectionId)
        throw new AppError(
          422,
          "RECONCILIATION_UNAVAILABLE",
          "No provider checkout reference is available. Review the provider account manually.",
        );
      const { connection, credentials } = await paymentConnection(
        order.connectionId,
        order.tenantId,
        config,
      );
      const evidence = await verifyCheckout(
        connection.provider,
        credentials,
        order.externalId,
        connection.mode,
        order.externalPaymentId ?? undefined,
      );
      res.json(
        await settleOrder(
          order._id,
          order.tenantId,
          evidence,
          `reconcile:${req.requestId}`,
        ),
      );
    },
  );
  router.post(
    "/orders/:id/sandbox-refund",
    requirePermission("revenue.write"),
    async (req, res) => {
      if (config.NODE_ENV === "production")
        throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
      const { cumulativeMinor } = z
        .object({ cumulativeMinor: z.string().regex(/^[1-9]\d{0,15}$/) })
        .strict()
        .parse(req.body);
      const order = await PaymentOrder.findOne({
        tenantId: req.auth!.tenantId,
        _id: String(req.params.id),
        mode: "sandbox",
        status: { $in: ["paid", "refunded"] },
      }).lean();
      if (!order)
        throw new AppError(
          404,
          "ORDER_NOT_FOUND",
          "Paid sandbox order not found.",
        );
      res.json(
        await settleOrder(
          order._id,
          order.tenantId,
          {
            orderId: order._id,
            externalId: String(order.externalId),
            paymentId: String(order.externalPaymentId),
            amountMinor: String(order.amountMinor),
            refundedMinor: cumulativeMinor,
            currency: String(order.currency),
            paid: true,
            live: false,
          },
          `sandbox-refund:${req.requestId}`,
          true,
        ),
      );
    },
  );
  return router;
}

export function paymentWebhookRouter(config: Config) {
  const router = Router();
  router.post(
    "/:connectionId",
    express.raw({ type: "application/json", limit: "512kb" }),
    async (req, res) => {
      await rateLimit(`webhook:${req.params.connectionId}:${req.ip}`, 180);
      if (!Buffer.isBuffer(req.body))
        throw new AppError(
          400,
          "RAW_BODY_REQUIRED",
          "Use an application/json payload.",
        );
      const connection = await Connection.findOne({
        _id: String(req.params.connectionId),
        provider: { $in: ["stripe", "razorpay"] },
        status: { $in: ["test", "active", "paused"] },
      })
        .select("+credentialCipher")
        .lean();
      if (!connection?.credentialCipher)
        throw new AppError(
          404,
          "CONNECTION_NOT_FOUND",
          "Connection not found.",
        );
      const credentials = unseal<Record<string, string>>(
        connection.credentialCipher,
        config.DATA_ENCRYPTION_KEY,
        connection.tenantId,
      );
      let payload: any, externalId: string;
      try {
        if (connection.provider === "stripe") {
          payload = stripeClient(credentials).webhooks.constructEvent(
            req.body,
            req.get("Stripe-Signature") ?? "",
            credentials.webhookSecret,
            300,
          );
          if (payload.livemode !== (connection.mode === "live"))
            throw new Error();
          externalId = payload.id;
        } else {
          if (
            !credentials.webhookSecret ||
            !equal(
              createHmac("sha256", credentials.webhookSecret)
                .update(req.body)
                .digest("hex"),
              req.get("X-Razorpay-Signature") ?? "",
            )
          )
            throw new Error();
          payload = JSON.parse(req.body.toString("utf8"));
          externalId =
            req.get("X-Razorpay-Event-Id") ?? digest(req.body.toString("utf8"));
        }
      } catch {
        throw new AppError(
          400,
          "INVALID_WEBHOOK_SIGNATURE",
          "Webhook verification failed.",
        );
      }
      const bodyHash = digest(req.body.toString("utf8"));
      if (!externalId || externalId.length > 200)
        throw new AppError(
          400,
          "INVALID_EVENT_ID",
          "Invalid provider event ID.",
        );
      try {
        await Webhook.create({
          tenantId: connection.tenantId,
          connectionId: connection._id,
          externalId,
          bodyHash,
          payloadCipher: seal(
            payload,
            config.DATA_ENCRYPTION_KEY,
            connection.tenantId,
          ),
        });
      } catch (error: any) {
        if (error.code !== 11000) throw error;
        const old = await Webhook.findOne({
          connectionId: connection._id,
          externalId,
        }).lean();
        if (old?.bodyHash !== bodyHash)
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

export async function processPaymentWebhook(id: string, config: Config) {
  const hook = await Webhook.findOne({
    _id: id,
    status: { $in: ["received", "failed", "processing"] },
  })
    .select("+payloadCipher")
    .lean();
  if (!hook) return;
  const payload: any = unseal(
    String(hook.payloadCipher),
    config.DATA_ENCRYPTION_KEY,
    hook.tenantId,
  );
  const { connection, credentials } = await paymentConnection(
    String(hook.connectionId),
    hook.tenantId,
    config,
  );
  const type = String(payload.type ?? payload.event ?? "");
  let order: Awaited<ReturnType<typeof PaymentOrder.findOne>> | any;
  const reference = (value: unknown) => z.string().min(1).max(200).parse(value);
  let paymentId: string | undefined;
  if (
    connection.provider === "stripe" &&
    [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ].includes(type)
  )
    order = await PaymentOrder.findOne({
      tenantId: hook.tenantId,
      connectionId: connection._id,
      externalId: reference(payload.data?.object?.id),
    }).lean();
  else if (connection.provider === "stripe" && type === "charge.refunded")
    order = await PaymentOrder.findOne({
      tenantId: hook.tenantId,
      connectionId: connection._id,
      _id: reference(payload.data?.object?.metadata?.rpOrderId ?? "missing"),
    }).lean();
  else if (connection.provider === "razorpay" && type === "payment_link.paid") {
    order = await PaymentOrder.findOne({
      tenantId: hook.tenantId,
      connectionId: connection._id,
      externalId: reference(payload.payload?.payment_link?.entity?.id),
    }).lean();
    paymentId = reference(payload.payload?.payment?.entity?.id);
  } else if (connection.provider === "razorpay" && type === "refund.processed")
    order = await PaymentOrder.findOne({
      tenantId: hook.tenantId,
      connectionId: connection._id,
      externalPaymentId:
        reference(payload.payload?.refund?.entity?.payment_id) ?? "missing",
    }).lean();
  else {
    await Webhook.updateOne(
      { _id: hook._id, tenantId: hook.tenantId },
      { $set: { status: "ignored", processedAt: new Date() } },
    );
    return;
  }
  if (!order?.externalId) throw new ProviderError("WEBHOOK_ORDER_NOT_READY");
  const evidence = await verifyCheckout(
    connection.provider,
    credentials,
    order.externalId,
    connection.mode,
    paymentId ?? order.externalPaymentId,
  );
  if (!evidence.paid) {
    if (type !== "checkout.session.completed")
      throw new ProviderError("PAYMENT_NOT_CONFIRMED");
  } else
    await settleOrder(
      order._id,
      hook.tenantId,
      evidence,
      String(hook.externalId),
    );
  await Webhook.updateOne(
    { _id: hook._id, tenantId: hook.tenantId },
    {
      $set: { status: "processed", processedAt: new Date() },
      $unset: { payloadCipher: 1 },
    },
  );
}
