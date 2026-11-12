import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { memoryMongoOptions } from "../scripts/mongo-options.ts";
import { connectDatabase } from "../apps/api/src/db.ts";
import { readConfig } from "../apps/api/src/config.ts";
import { Tenant } from "../apps/api/src/models.ts";
import { Billing, Webhook } from "../apps/api/src/journey/models.ts";
import { seal } from "../apps/api/src/security.ts";
import { processBillingWebhook } from "../apps/api/src/journey/billing.ts";
const mocks = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("stripe", () => ({
  default: class Stripe {
    subscriptions = { retrieve: mocks.retrieve };
  },
}));
const key = "bc".repeat(32);
let replica: MongoMemoryReplSet,
  tenantId: string,
  config: ReturnType<typeof readConfig>;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create(memoryMongoOptions());
  config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: replica.getUri("billing_test"),
    DATA_ENCRYPTION_KEY: key,
    BILLING_STRIPE_SECRET_KEY: "sk_test_fixture",
    BILLING_STRIPE_WEBHOOK_SECRET: "fixture-webhook-secret",
    BILLING_PRICE_GROWTH: "price_growth",
  });
  await connectDatabase(config.MONGODB_URI);
  tenantId = (await Tenant.create({ name: "Billing test" }))._id;
  await Billing.create({
    tenantId,
    providerCustomerId: "cus_fixture",
    status: "trial",
  });
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});
const subscription = (
  id: string,
  status = "active",
  invoiceStatus = "paid",
) => ({
  id,
  status,
  customer: "cus_fixture",
  metadata: { rpTenantId: tenantId },
  latest_invoice: { status: invoiceStatus },
  items: {
    data: [
      {
        price: { id: "price_growth" },
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    ],
  },
});
let sequence = 0;
async function event(subscriptionId: string) {
  const event = {
    id: `evt_${++sequence}`,
    type: "customer.subscription.updated",
    data: { object: { id: subscriptionId } },
  };
  const hook = await Webhook.create({
    tenantId,
    connectionId: "platform-billing",
    externalId: event.id,
    bodyHash: "fixture",
    status: "processing",
    payloadCipher: seal(event, key, tenantId),
  });
  return { _id: String(hook._id) };
}
describe("billing entitlement reconciliation", () => {
  it("grants only server-priced subscriptions with a currently paid invoice", async () => {
    mocks.retrieve.mockResolvedValue(
      subscription("sub_first", "active", "open"),
    );
    let hook = await event("sub_first");
    await processBillingWebhook(hook._id, config);
    expect((await Tenant.findById(tenantId).lean())?.plan).toBe("pilot");
    mocks.retrieve.mockResolvedValue(subscription("sub_first"));
    hook = await event("sub_first");
    await processBillingWebhook(hook._id, config);
    expect((await Tenant.findById(tenantId).lean())?.plan).toBe("growth");
  });
  it("rejects subscription metadata for another tenant", async () => {
    mocks.retrieve.mockResolvedValue({
      ...subscription("sub_first"),
      metadata: { rpTenantId: "wrong-tenant" },
    });
    const hook = await event("sub_first");
    await expect(processBillingWebhook(hook._id, config)).rejects.toThrow(
      "BILLING_SUBSCRIPTION_MISMATCH",
    );
  });
  it("allows a replacement after cancellation and ignores late events for the old subscription", async () => {
    mocks.retrieve.mockImplementation(async (id: string) =>
      subscription(id, id === "sub_first" ? "canceled" : "active"),
    );
    let hook = await event("sub_second");
    await processBillingWebhook(hook._id, config);
    expect(
      (await Billing.findOne({ tenantId }).lean())?.providerSubscriptionId,
    ).toBe("sub_second");
    hook = await event("sub_first");
    await processBillingWebhook(hook._id, config);
    expect((await Webhook.findById(hook._id).lean())?.status).toBe("ignored");
    expect((await Tenant.findById(tenantId).lean())?.plan).toBe("growth");
  });
});
