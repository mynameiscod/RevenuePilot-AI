import Stripe from "stripe";
import { z } from "zod";
import { providerJson, providerId, ProviderError } from "../http.ts";
export type PaymentCredentials = Record<string, string>;
export type CheckoutRequest = {
  orderId: string;
  amountMinor: string;
  currency: string;
  course: string;
  returnUrl: string;
  mode: "test" | "live";
};
export const stripeClient = (credentials: PaymentCredentials) =>
  new Stripe(credentials.secretKey, { maxNetworkRetries: 0, timeout: 15000 });
const money = z.number().int().nonnegative().safe();
const razorLink = z.object({
  id: z.string(),
  reference_id: z.string(),
  amount: money,
  amount_paid: money,
  currency: z.string(),
  status: z.string(),
  short_url: z.url(),
  payments: z
    .array(z.object({ payment_id: z.string(), status: z.string().optional() }))
    .optional(),
});
const razorPayment = z.object({
  id: z.string(),
  amount: money,
  amount_refunded: money,
  currency: z.string(),
  status: z.string(),
  captured: z.boolean(),
  order_id: z.string().nullable(),
});
function razorHeaders(c: PaymentCredentials) {
  return {
    Authorization: `Basic ${Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}
export function assertPaymentMode(
  provider: string,
  credentials: PaymentCredentials,
  mode: string,
) {
  const key = provider === "stripe" ? credentials.secretKey : credentials.keyId;
  if (
    !key ||
    !(
      provider === "stripe"
        ? new RegExp(`^(sk|rk)_${mode}_`)
        : new RegExp(`^rzp_${mode}_`)
    ).test(key)
  )
    throw new ProviderError("PAYMENT_MODE_MISMATCH");
  if (!credentials.webhookSecret || credentials.webhookSecret.length < 16)
    throw new ProviderError("WEBHOOK_SECRET_REQUIRED");
}
export async function createCheckout(
  provider: string,
  credentials: PaymentCredentials,
  input: CheckoutRequest,
) {
  assertPaymentMode(provider, credentials, input.mode);
  const amount = Number(input.amountMinor);
  if (!Number.isSafeInteger(amount)) throw new ProviderError("INVALID_AMOUNT");
  if (provider === "stripe") {
    const result = await stripeClient(credentials).checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: input.orderId,
        metadata: { rpOrderId: input.orderId },
        payment_intent_data: { metadata: { rpOrderId: input.orderId } },
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: amount,
              product_data: { name: input.course },
            },
            quantity: 1,
          },
        ],
        success_url: `${input.returnUrl}?result=received`,
        cancel_url: `${input.returnUrl}?result=cancelled`,
      },
      { idempotencyKey: `rp-checkout-${input.orderId}` },
    );
    if (!result.url || result.livemode !== (input.mode === "live"))
      throw new ProviderError("PAYMENT_MODE_MISMATCH", true);
    return { externalId: result.id, url: result.url };
  }
  if (provider === "razorpay") {
    const result = razorLink.parse(
      await providerJson("https://api.razorpay.com/v1/payment_links", {
        method: "POST",
        headers: razorHeaders(credentials),
        body: JSON.stringify({
          amount,
          currency: input.currency,
          accept_partial: false,
          reference_id: input.orderId,
          description: input.course,
          notes: { rpOrderId: input.orderId },
          notify: { sms: false, email: false },
          reminder_enable: false,
          callback_url: input.returnUrl,
          callback_method: "get",
        }),
      }),
    );
    return { externalId: result.id, url: result.short_url };
  }
  throw new ProviderError("UNSUPPORTED_PAYMENT_PROVIDER");
}
export type VerifiedPayment = {
  orderId: string;
  externalId: string;
  paymentId: string;
  amountMinor: string;
  refundedMinor: string;
  currency: string;
  paid: boolean;
  live: boolean;
};
export async function verifyCheckout(
  provider: string,
  credentials: PaymentCredentials,
  externalId: string,
  mode: string,
  paymentId?: string,
): Promise<VerifiedPayment> {
  assertPaymentMode(provider, credentials, mode);
  if (provider === "stripe") {
    const client = stripeClient(credentials);
    const checkout = await client.checkout.sessions.retrieve(
      providerId(externalId),
      { expand: ["payment_intent.latest_charge"] },
    );
    const intent =
      typeof checkout.payment_intent === "object"
        ? (checkout.payment_intent as Stripe.PaymentIntent | null)
        : null;
    const charge =
      typeof intent?.latest_charge === "object"
        ? (intent.latest_charge as Stripe.Charge | null)
        : null;
    return {
      orderId: checkout.client_reference_id ?? "",
      externalId: checkout.id,
      paymentId: charge?.id ?? "",
      amountMinor: String(charge?.amount_captured ?? 0),
      refundedMinor: String(charge?.amount_refunded ?? 0),
      currency: (checkout.currency ?? "").toUpperCase(),
      paid:
        checkout.payment_status === "paid" &&
        !!charge?.paid &&
        !!charge?.captured &&
        checkout.amount_total === charge.amount_captured,
      live: checkout.livemode,
    };
  }
  if (provider === "razorpay") {
    const link = razorLink.parse(
      await providerJson(
        `https://api.razorpay.com/v1/payment_links/${providerId(externalId)}`,
        { headers: razorHeaders(credentials) },
      ),
    );
    const pid = paymentId ?? link.payments?.[0]?.payment_id;
    if (!pid || !link.payments?.some((p) => p.payment_id === pid))
      throw new ProviderError("PAYMENT_LINK_MISMATCH");
    const payment = razorPayment.parse(
      await providerJson(
        `https://api.razorpay.com/v1/payments/${providerId(pid)}`,
        { headers: razorHeaders(credentials) },
      ),
    );
    return {
      orderId: link.reference_id,
      externalId: link.id,
      paymentId: payment.id,
      amountMinor: String(payment.amount),
      refundedMinor: String(payment.amount_refunded),
      currency: payment.currency.toUpperCase(),
      paid:
        link.status === "paid" &&
        link.amount_paid === link.amount &&
        payment.amount === link.amount &&
        payment.captured &&
        ["captured", "refunded"].includes(payment.status),
      live: mode === "live",
    };
  }
  throw new ProviderError("UNSUPPORTED_PAYMENT_PROVIDER");
}
