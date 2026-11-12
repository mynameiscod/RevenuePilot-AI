import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import {
  User,
  Tenant,
  Membership,
  Lead,
  Receipt,
  Event,
  Connection,
  Audit,
} from "../apps/api/src/models.ts";
import {
  passwordHash,
  seal,
  lookupHash,
  randomToken,
} from "../apps/api/src/security.ts";
import { readConfig, type Config } from "../apps/api/src/config.ts";
import { connectDatabase, transaction } from "../apps/api/src/db.ts";
import { Form } from "../apps/api/src/journey/models.ts";
import { type Stage } from "../packages/core/src/contracts.ts";

export async function seedDemo(config: Config) {
  if (config.NODE_ENV === "production" || config.REVENUEPILOT_DEMO !== "true")
    throw new Error(
      "Demo seed requires explicit demo mode and is forbidden in production.",
    );
  if (await User.exists({ email: "demo@revenuepilot.test" })) return;
  const userId = randomUUID(),
    tenantId = randomUUID(),
    secondId = randomUUID();
  const hash = await passwordHash(randomToken());
  await transaction(async (session) => {
    await User.create(
      [
        {
          _id: userId,
          name: "Demo Admin",
          email: "demo@revenuepilot.test",
          passwordHash: hash,
          emailVerifiedAt: new Date(),
        },
      ],
      { session, ordered: true },
    );
    await Tenant.create(
      [
        { _id: tenantId, name: "CodeBegun", demo: true },
        {
          _id: secondId,
          name: "Northstar Studio",
          currency: "USD",
          timezone: "America/New_York",
          demo: true,
        },
      ],
      { session, ordered: true },
    );
    await Membership.create(
      [
        { tenantId, userId, role: "owner" },
        { tenantId: secondId, userId, role: "owner" },
      ],
      { session, ordered: true },
    );
    await Form.create(
      [
        {
          tenantId,
          publicKey: "form_codebegun_local_demo_2026",
          name: "Java course enquiries",
          course: "Java Full Stack",
          amountMinor: "3500000",
          currency: "INR",
          origins: [config.WEB_ORIGIN],
          ownerId: userId,
          assignees: [userId],
          consentVersion: "1",
        },
      ],
      { session },
    );
    const names = [
      "Aarav Sharma",
      "Ananya Rao",
      "Rohan Mehta",
      "Priya Reddy",
      "Vikram Nair",
      "Sneha Patel",
      "Arjun Kumar",
      "Divya Shah",
      "Kiran Varma",
      "Meera Singh",
      "Aditya Rao",
      "Nisha Kapoor",
    ];
    const courses = [
      "Java Full Stack",
      "Data Analytics",
      "Python Full Stack",
      "Data Science",
      "AI & Machine Learning",
    ];
    const channels = [
      "Meta Ads",
      "Meta Ads",
      "Google Ads",
      "Organic",
      "Referral",
      "YouTube Ads",
    ];
    const stageSet: Stage[] = [
      "new",
      "qualified",
      "contacting",
      "enrolled",
      "demo",
      "qualified",
      "new",
      "enrolled",
      "lost",
      "contacting",
      "demo",
      "qualified",
    ];
    for (let i = 0; i < 48; i++) {
      const id = randomUUID(),
        stage = stageSet[i % stageSet.length],
        createdAt = new Date(
          Date.now() - ((i * 7) % 29) * 86400000 - (i + 1) * 3600000,
        );
      const email = `sample${i + 1}@example.test`,
        channel = channels[i % channels.length],
        course = courses[i % courses.length];
      await Lead.create(
        [
          {
            _id: id,
            tenantId,
            name: `${names[i % names.length]}${i >= 12 ? ` ${Math.floor(i / 12) + 1}` : ""}`,
            contactCipher: seal(
              { email, phone: "+910000000000" },
              config.DATA_ENCRYPTION_KEY,
              tenantId,
            ),
            emailHash: lookupHash(email, config.DATA_ENCRYPTION_KEY, tenantId),
            course,
            channel,
            campaign: channel.includes("Ads") ? `${course} · November` : "",
            stage,
            assignedTo: userId,
            note: "Synthetic example for product exploration. No real student or contact details.",
            createdAt,
            updatedAt: createdAt,
            lastContactAt:
              stage === "new" ? undefined : new Date(+createdAt + 720000),
          },
        ],
        { session, ordered: true },
      );
      await Event.create(
        [
          {
            tenantId,
            leadId: id,
            type: "lead.created.v1",
            title: "Enquiry received",
            detail: `${course} · ${channel}`,
            occurredAt: createdAt,
            actorId: userId,
          },
        ],
        { session, ordered: true },
      );
      if (stage !== "new")
        await Event.create(
          [
            {
              tenantId,
              leadId: id,
              type: "contact.recorded.v1",
              title: "Counselor connected",
              detail:
                "Discussed course goals and preferred batch. Synthetic activity.",
              occurredAt: new Date(+createdAt + 720000),
              actorId: userId,
            },
          ],
          { session, ordered: true },
        );
      if (stage === "enrolled") {
        const receiptId = randomUUID();
        await Receipt.create(
          [
            {
              _id: receiptId,
              tenantId,
              leadId: id,
              kind: "capture",
              amountMinor: "3500000",
              currency: "INR",
              reference: `DEMO-CAPTURE-${i}`,
              recordedBy: userId,
              channel,
              note: "Synthetic captured receipt",
              createdAt: new Date(+createdAt + 3600000),
            },
          ],
          { session, ordered: true },
        );
        await Event.create(
          [
            {
              tenantId,
              leadId: id,
              type: "payment.capture.v1",
              title: "Receipt recorded",
              detail: "₹35,000 · synthetic receipt",
              occurredAt: new Date(+createdAt + 3600000),
              actorId: userId,
            },
          ],
          { session, ordered: true },
        );
        if (i === 3) {
          await Receipt.create(
            [
              {
                tenantId,
                leadId: id,
                kind: "refund",
                amountMinor: "500000",
                currency: "INR",
                reference: "DEMO-REFUND-3",
                originalReceiptId: receiptId,
                recordedBy: userId,
                channel,
                note: "Synthetic partial refund",
                createdAt: new Date(+createdAt + 7200000),
              },
            ],
            { session, ordered: true },
          );
          await Receipt.updateOne(
            { _id: receiptId, tenantId },
            { $set: { refundedMinor: "500000" } },
            { session },
          );
        }
      }
    }
    await Connection.create(
      [
        {
          tenantId,
          provider: "meta",
          label: "CodeBegun acquisition",
          accountId: "demo-account",
          status: "draft",
        },
        {
          tenantId,
          provider: "razorpay",
          label: "Student payments",
          accountId: "demo-payments",
          status: "draft",
        },
      ],
      { session, ordered: true },
    );
    await Audit.create(
      [
        {
          tenantId,
          actorId: userId,
          action: "demo.seeded",
          targetId: tenantId,
          requestId: "demo-seed",
        },
      ],
      { session, ordered: true },
    );
  });
}
if (process.argv[1]?.endsWith("seed-demo.ts")) {
  const config = readConfig();
  await connectDatabase(config.MONGODB_URI);
  await seedDemo(config);
  await mongoose.disconnect();
  console.log("Synthetic demo workspace prepared.");
}
