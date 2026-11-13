import { Router } from "express";
import { z } from "zod";
import {
  can,
  channels,
  identifier,
} from "../../../../packages/core/src/contracts.ts";
import { marketingLinkInput } from "../../../../packages/core/src/journey.ts";
import { marketingPresets } from "../../../../packages/core/src/marketing.ts";
import { requirePermission, type AuthContext } from "../auth.ts";
import type { Config } from "../config.ts";
import { allowedWebOrigins } from "../config.ts";
import { Lead, Connection } from "../models.ts";
import {
  Form,
  MarketingLink,
  Attempt,
  Touch,
  AdSpend,
  IntegrationLink,
} from "./models.ts";
import { AppError } from "../errors.ts";
import { audit, idempotent, leadView } from "../services.ts";
import { lockTenant } from "./entitlements.ts";
import { randomToken } from "../security.ts";
import { transaction } from "../db.ts";

export function marketingUrl(link: any) {
  const url = new URL(String(link.landingUrl));
  for (const [key, value] of Object.entries({
    utm_source: link.source,
    utm_medium: link.medium,
    utm_campaign: link.campaign,
    utm_id: link.campaignId,
    ad_account_id: link.accountId,
    ad_id: link.adId,
    rp_link: link.publicKey,
  }))
    if (value) url.searchParams.set(key, String(value));
  return url.href;
}
const paid = (channel: string) =>
  ["Meta Ads", "Google Ads", "YouTube Ads"].includes(channel);
const exactIds = (t: any) => !!(t?.accountId && t?.campaignId && t?.adId);
export async function marketingReport(
  auth: AuthContext,
  config: Config,
  days: number,
) {
  const tenantId = auth.tenantId!,
    now = new Date();
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - days + 1,
    ),
  );
  const [leads, attempts, links, connections, imported, forms] =
    await Promise.all([
      Lead.find({
        tenantId,
        erasedAt: { $exists: false },
        createdAt: { $gte: start, $lte: now },
      })
        .select("+contactCipher")
        .sort({ createdAt: -1, _id: -1 })
        .limit(10001)
        .lean(),
      Attempt.find({ tenantId, createdAt: { $gte: start, $lte: now } })
        .limit(20001)
        .lean(),
      MarketingLink.find({ tenantId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(501)
        .lean(),
      Connection.find({
        tenantId,
        provider: { $in: ["meta", "google_ads", "hubspot", "generic_crm"] },
      })
        .select("_id label provider status mode health lastSyncAt config")
        .lean(),
      AdSpend.find({
        tenantId,
        date: {
          $gte: start.toISOString().slice(0, 10),
          $lte: now.toISOString().slice(0, 10),
        },
      })
        .sort({ updatedAt: -1, _id: -1 })
        .limit(20001)
        .lean(),
      can(auth.role!, "settings.write")
        ? Form.find({ tenantId, active: true })
            .select("_id name course publicKey origins")
            .limit(200)
            .lean()
        : [],
    ]);
  if (
    leads.length > 10000 ||
    attempts.length > 20000 ||
    imported.length > 20000 ||
    links.length > 500
  )
    throw new AppError(
      422,
      "REPORT_TOO_LARGE",
      "Select a shorter reporting window or contact the workspace administrator.",
    );
  const leadIds = leads.map((l) => l._id);
  const [touches, imports] = await Promise.all([
    Touch.find({ tenantId, leadId: { $in: leadIds } })
      .sort({ occurredAt: 1, _id: 1 })
      .limit(100001)
      .lean(),
    IntegrationLink.find({ tenantId, leadId: { $in: leadIds } })
      .select("leadId")
      .limit(100001)
      .lean(),
  ]);
  if (touches.length > 100000 || imports.length > 100000)
    throw new AppError(
      422,
      "REPORT_TOO_LARGE",
      "Select a shorter reporting window.",
    );
  const first = new Map<string, any>();
  for (const t of touches)
    if (!first.has(String(t.leadId))) first.set(String(t.leadId), t);
  const importedIds = new Set(imports.map((l) => String(l.leadId)));
  const sourceRows = new Map<string, any>(
    channels.map((source) => [
      source,
      {
        source,
        leads: 0,
        trackedLeads: 0,
        recordedLeads: 0,
        visits: 0,
        starts: 0,
        submissions: 0,
        unacceptedVisits: 0,
        acceptedEnquiries: 0,
      },
    ]),
  );
  const linkRows = new Map<string, any>(
    links.map((l) => [
      String(l._id),
      {
        ...l,
        id: l._id,
        url: marketingUrl(l),
        visits: 0,
        starts: 0,
        submissions: 0,
        unacceptedVisits: 0,
        acceptedEnquiries: 0,
        newLeads: 0,
        lastObservedAt: null,
        paidIdsComplete: !paid(String(l.channel)) || exactIds(l),
      },
    ]),
  );
  let unknownLeads = 0,
    incompletePaidTags = 0;
  const recentLeads = leads.map((lead) => {
    const t = first.get(String(lead._id));
    const evidence =
      t?.tagStatus === "link_unavailable"
        ? "link_unavailable"
        : t
          ? (t.tagStatus ?? "browser_tags")
          : importedIds.has(String(lead._id))
            ? "provider_import"
            : lead.formId
              ? "no_tracking_consent"
              : "recorded_source";
    const source = t?.source ?? lead.channel;
    const row = sourceRows.get(source) ?? sourceRows.get("Other")!;
    row.leads++;
    if (t?.eligible) row.trackedLeads++;
    else row.recordedLeads++;
    if (
      ["link_unavailable", "no_tracking_consent", "unrecognized"].includes(
        evidence,
      )
    )
      unknownLeads++;
    if (paid(source) && !exactIds(t)) incompletePaidTags++;
    const link = t?.marketingLinkId
      ? linkRows.get(String(t.marketingLinkId))
      : null;
    if (link) link.newLeads++;
    return {
      ...leadView(lead, auth.role!, config.DATA_ENCRYPTION_KEY),
      source,
      sourceDetail: t?.sourceDetail ?? "",
      medium: t?.medium ?? "",
      campaign: t?.campaign ?? lead.campaign,
      accountId: t?.accountId ?? "",
      campaignId: t?.campaignId ?? "",
      adId: t?.adId ?? "",
      evidence,
      marketingLinkId: t?.marketingLinkId ?? null,
      marketingLinkName: link?.name ?? null,
    };
  });
  for (const a of attempts) {
    const t = a.touch as any;
    const row = sourceRows.get(t?.source) ?? sourceRows.get("Other")!;
    const link = t?.marketingLinkId
      ? linkRows.get(String(t.marketingLinkId))
      : null;
    for (const r of [row, link].filter(Boolean)) {
      if (a.viewedAt) r.visits++;
      if (a.startedAt) r.starts++;
      if (a.submittedAt) r.submissions++;
      if (a.viewedAt && !a.acceptedAt) r.unacceptedVisits++;
      if (a.acceptedAt) r.acceptedEnquiries++;
    }
    if (
      link &&
      (!link.lastObservedAt || +a.updatedAt > +new Date(link.lastObservedAt))
    )
      link.lastObservedAt = a.updatedAt;
  }
  // Different connections to the same ad account must not double its spend.
  const seen = new Set<string>(),
    ads = new Map<string, any>();
  for (const row of imported) {
    const accountId = String(row.accountId ?? "").replace(/^act_/, "");
    const dimensions = [
      row.source,
      accountId || row.connectionId,
      row.campaignId,
      row.adId,
      row.currency,
      row.evidence,
    ];
    const daily = JSON.stringify([...dimensions, row.date]);
    if (seen.has(daily)) continue;
    seen.add(daily);
    const key = JSON.stringify(dimensions);
    if (!ads.has(key))
      ads.set(key, {
        source: row.source,
        accountId,
        campaignId: row.campaignId,
        campaign: row.campaign,
        adId: row.adId,
        currency: row.currency,
        evidence: row.evidence,
        spend: 0n,
        clicks: 0,
        impressions: 0,
        dates: new Set<string>(),
      });
    const ad = ads.get(key)!;
    ad.spend += BigInt(row.amountMinor!);
    ad.clicks += Number(row.clicks ?? 0);
    ad.impressions += Number(row.impressions ?? 0);
    ad.dates.add(row.date);
  }
  const sourceMatches = new Map<string, number>();
  for (const lead of recentLeads) {
    if (!exactIds(lead)) continue;
    const key = JSON.stringify([
      lead.source,
      String(lead.accountId).replace(/^act_/, ""),
      lead.campaignId,
      lead.adId,
    ]);
    sourceMatches.set(key, (sourceMatches.get(key) ?? 0) + 1);
  }
  const advertising = [...ads.values()].map(({ spend, dates, ...ad }) => ({
    ...ad,
    spendMinor: spend.toString(),
    observedDays: dates.size,
    matchingSourceLeads: exactIds(ad)
      ? (sourceMatches.get(
          JSON.stringify([ad.source, ad.accountId, ad.campaignId, ad.adId]),
        ) ?? 0)
      : null,
  }));
  return {
    period: {
      days,
      from: start.toISOString(),
      to: now.toISOString(),
      timezone: "UTC",
    },
    presets: marketingPresets,
    totals: {
      leads: leads.length,
      trackedLeads: [...sourceRows.values()].reduce(
        (n, r) => n + r.trackedLeads,
        0,
      ),
      observedVisits: attempts.filter((a) => a.viewedAt).length,
      acceptedEnquiries: attempts.filter((a) => a.acceptedAt).length,
      unknownLeads,
      incompletePaidTags,
    },
    sources: [...sourceRows.values()],
    links: [...linkRows.values()],
    advertising,
    recentLeads: recentLeads.slice(0, 50),
    recentLeadsTotal: recentLeads.length,
    forms: forms.map((f) => ({
      id: f._id,
      name: f.name,
      course: f.course,
      origins: f.origins,
      publicKey: f.publicKey,
    })),
    ...(can(auth.role!, "settings.write")
      ? { integration: { apiOrigin: config.WEB_ORIGIN } }
      : {}),
    connections: connections.map((c) => ({
      id: c._id,
      label: c.label,
      provider: c.provider,
      status: c.status,
      mode: c.mode,
      checkedAt: c.health?.checkedAt ?? null,
      healthStatus: c.health?.status ?? "not_checked",
    })),
  };
}
export function marketingRouter(config: Config) {
  const router = Router({ mergeParams: true });
  router.get(
    "/marketing",
    requirePermission("marketing.read"),
    async (req, res) => {
      const days = z.coerce
        .number()
        .int()
        .refine((n) => [7, 30, 90].includes(n))
        .parse(req.query.days ?? 30);
      res.json(await marketingReport(req.auth!, config, days));
    },
  );
  router.post(
    "/marketing/links",
    requirePermission("settings.write"),
    async (req, res) => {
      const input = marketingLinkInput.parse(req.body);
      const result = await idempotent(
        req.auth!,
        "POST/marketing/links",
        req.get("Idempotency-Key") ?? "",
        input,
        async (session) => {
          await lockTenant(req.auth!.tenantId!, session);
          if (
            (await MarketingLink.countDocuments({
              tenantId: req.auth!.tenantId,
            }).session(session)) >= 500
          )
            throw new AppError(
              429,
              "LINK_LIMIT",
              "This workspace has reached its 500-link allowance.",
            );
          const form = await Form.findOne({
            tenantId: req.auth!.tenantId,
            _id: input.formId,
            active: true,
          })
            .session(session)
            .lean();
          if (!form)
            throw new AppError(
              404,
              "FORM_NOT_FOUND",
              "Choose an active form in this workspace.",
            );
          const preset = marketingPresets.find((p) => p.id === input.preset)!;
          if (
            input.medium !== preset.medium ||
            (preset.provider && input.source !== preset.source)
          )
            throw new AppError(
              422,
              "SOURCE_MISMATCH",
              "Use the source and medium defined by this channel preset.",
            );
          let url: URL;
          try {
            url = new URL(
              input.landingUrl ||
                `${config.WEB_ORIGIN}/enquire/${form.publicKey}`,
            );
          } catch {
            throw new AppError(
              422,
              "LANDING_URL_INVALID",
              "Enter an absolute landing page URL.",
            );
          }
          const origins = new Set([
            ...(form.origins ?? []),
            ...allowedWebOrigins(config),
          ]);
          if (
            !origins.has(url.origin) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            url.pathname.length > 500 ||
            (config.NODE_ENV === "production" && url.protocol !== "https:")
          )
            throw new AppError(
              422,
              "LANDING_URL_DENIED",
              "Use a page on a form's allowed origin, without credentials, query parameters or a fragment.",
            );
          const [link] = await MarketingLink.create(
            [
              {
                ...input,
                landingUrl: url.href,
                tenantId: req.auth!.tenantId,
                channel: preset.channel,
                publicKey: `ml_${randomToken()}`,
                createdBy: req.auth!.userId,
              },
            ],
            { session },
          );
          await audit(
            req.auth!,
            "marketing.link_created",
            String(link._id),
            req.requestId,
            session,
          );
          return { id: String(link._id), url: marketingUrl(link) };
        },
      );
      res.status(201).json(result);
    },
  );
  router.patch(
    "/marketing/links/:id",
    requirePermission("settings.write"),
    async (req, res) => {
      const id = identifier.parse(req.params.id),
        { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
      await transaction(async (session) => {
        const updated = await MarketingLink.updateOne(
          { tenantId: req.auth!.tenantId, _id: id },
          { $set: { active } },
          { session },
        );
        if (!updated.matchedCount)
          throw new AppError(
            404,
            "LINK_NOT_FOUND",
            "Marketing link not found.",
          );
        await audit(
          req.auth!,
          active ? "marketing.link_enabled" : "marketing.link_paused",
          id,
          req.requestId,
          session,
        );
      });
      res.json({ updated: true });
    },
  );
  return router;
}
