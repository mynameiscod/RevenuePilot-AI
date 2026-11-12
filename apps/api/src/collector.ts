import { Router } from "express";
import { collectInput } from "../../../packages/core/src/contracts.ts";
import { Site, WebEvent } from "./models.ts";
import { AppError } from "./errors.ts";
import { rateLimit } from "./rate-limit.ts";

export function collectorRouter() {
  const router = Router();
  router.options("/", async (req, res) => {
    const origin = req.get("Origin");
    if (!origin || !(await Site.exists({ origins: origin, active: true })))
      throw new AppError(
        403,
        "ORIGIN_DENIED",
        "This origin is not registered.",
      );
    res
      .set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      })
      .sendStatus(204);
  });
  router.post("/", async (req, res) => {
    const input = collectInput.parse(req.body);
    const site = await Site.findOne({
      publicKey: input.siteKey,
      active: true,
    }).lean();
    const origin = req.get("Origin");
    if (!site || !origin || !site.origins.includes(origin))
      throw new AppError(
        403,
        "SITE_OR_ORIGIN_INVALID",
        "Site key or origin is not allowed.",
      );
    res.set({ "Access-Control-Allow-Origin": origin, Vary: "Origin" });
    await rateLimit(`site:${site._id}`, 600);
    const acceptedIds: string[] = [],
      duplicateIds: string[] = [],
      rejected: { eventId: string; code: string }[] = [];
    for (const event of input.events) {
      const occurredAt = new Date(event.occurredAt),
        age = Date.now() - +occurredAt;
      if (age < -300000 || age > 7 * 86400000) {
        rejected.push({
          eventId: event.eventId,
          code: "TIMESTAMP_OUT_OF_WINDOW",
        });
        continue;
      }
      try {
        const { consent: _consent, ...fields } = event;
        const result = await WebEvent.updateOne(
          { tenantId: site.tenantId, siteId: site._id, eventId: event.eventId },
          {
            $setOnInsert: {
              ...fields,
              tenantId: site.tenantId,
              siteId: site._id,
              occurredAt,
              expiresAt: new Date(Date.now() + 90 * 86400000),
            },
          },
          { upsert: true },
        );
        (result.upsertedCount ? acceptedIds : duplicateIds).push(event.eventId);
      } catch (error: any) {
        if (error.code === 11000) duplicateIds.push(event.eventId);
        else throw error;
      }
    }
    res.status(202).json({ acceptedIds, duplicateIds, rejected });
  });
  return router;
}
