import { allocate, can } from "../../../../packages/core/src/contracts.ts";
import { Lead, Receipt, Tenant } from "../models.ts";
import { Attempt, Milestone, Touch, AdSpend, Enrollment } from "./models.ts";
import { leadScope, type AuthContext } from "../auth.ts";
import { AppError } from "../errors.ts";

export function attributionWeights(
  amount: string,
  touches: { _id: string; source: string; occurredAt: Date }[],
  model: string,
) {
  const ordered = [...touches].sort(
    (a, b) => +a.occurredAt - +b.occurredAt || a._id.localeCompare(b._id),
  );
  const selected =
    model === "first_touch"
      ? ordered.slice(0, 1)
      : model === "last_touch"
        ? ordered.slice(-1)
        : ordered;
  const distribution = allocate(
    BigInt(amount),
    selected.map((t) => t._id),
  );
  const channels: Record<string, string> = {};
  for (const [id, minor] of Object.entries(distribution)) {
    const source = selected.find((t) => t._id === id)?.source ?? "Unattributed";
    channels[source] = (
      BigInt(channels[source] ?? "0") + BigInt(minor)
    ).toString();
  }
  return channels;
}

export async function journeyAnalytics(auth: AuthContext, days: number) {
  const now = new Date(),
    start = new Date(+now - days * 86400000),
    tenantId = auth.tenantId!;
  const tenant = await Tenant.findById(tenantId).lean();
  const cohort = await Lead.find({
    ...leadScope(auth),
    createdAt: { $gte: start, $lte: now },
  })
    .limit(10001)
    .lean();
  if (cohort.length > 10000)
    throw new AppError(
      422,
      "REPORT_TOO_LARGE",
      "Select a shorter reporting window.",
    );
  const ids = cohort.map((l) => l._id);
  const [milestones, attempts, enrolled] = await Promise.all([
    Milestone.find({
      tenantId,
      leadId: { $in: ids },
      occurredAt: { $lte: now },
    }).lean(),
    auth.role === "counselor"
      ? []
      : Attempt.find({ tenantId, createdAt: { $gte: start, $lte: now } })
          .limit(20001)
          .lean(),
    Enrollment.find({ tenantId, leadId: { $in: ids } }).lean(),
  ]);
  if (attempts.length > 20000)
    throw new AppError(
      422,
      "REPORT_TOO_LARGE",
      "Select a shorter reporting window.",
    );
  const reached = (type: string) =>
    new Set(milestones.filter((m) => m.type === type).map((m) => m.leadId));
  const funnel = [
    "lead_accepted",
    "contact_attempted",
    "connected",
    "qualified",
    "demo_scheduled",
    "demo_attended",
    "payment_captured",
    "enrollment_confirmed",
  ].map((type) => ({ type, count: reached(type).size }));
  const reasons = new Map<string, number>();
  for (const l of cohort.filter((l) => l.stage === "lost"))
    reasons.set(
      l.lossReason || "Reason not recorded",
      (reasons.get(l.lossReason || "Reason not recorded") ?? 0) + 1,
    );
  const mature = cohort.filter(
    (l) =>
      +now - +l.createdAt > 7 * 86400000 &&
      !["lost", "enrolled"].includes(l.stage),
  );
  const stalled = [
    {
      label: "First contact not recorded",
      count: mature.filter((l) => !reached("contact_attempted").has(l._id))
        .length,
    },
    {
      label: "Contact attempted; no connection recorded",
      count: mature.filter(
        (l) =>
          reached("contact_attempted").has(l._id) &&
          !reached("connected").has(l._id),
      ).length,
    },
    {
      label: "Connected; no attended demo recorded",
      count: mature.filter(
        (l) =>
          reached("connected").has(l._id) &&
          !reached("demo_attended").has(l._id),
      ).length,
    },
    {
      label: "Demo attended; no confirmed payment",
      count: mature.filter(
        (l) =>
          reached("demo_attended").has(l._id) &&
          !reached("payment_captured").has(l._id),
      ).length,
    },
  ];
  const matureAttempts = attempts.filter(
    (a) => +now - +new Date(a.createdAt as Date) >= 30 * 60000,
  );
  const revenue: any[] = [];
  const campaigns: any[] = [];
  let advertising: any[] = [];
  if (can(auth.role!, "revenue.read")) {
    const periodReceipts = await Receipt.find({
      tenantId,
      createdAt: { $gte: start, $lte: now },
    })
      .limit(10001)
      .lean();
    if (periodReceipts.length > 10000)
      throw new AppError(
        422,
        "REPORT_TOO_LARGE",
        "Select a shorter reporting window.",
      );
    const captureIds = periodReceipts.map((r) =>
      r.kind === "capture" ? r._id : r.originalReceiptId!,
    );
    const captures = await Receipt.find({
      tenantId,
      kind: "capture",
      _id: { $in: captureIds },
    }).lean();
    const [touches, refunds, importedSpend] = await Promise.all([
      Touch.find({
        tenantId,
        leadId: { $in: captures.map((c) => c.leadId) },
        eligible: true,
        occurredAt: { $lte: now },
      })
        .limit(100001)
        .lean(),
      Receipt.find({
        tenantId,
        kind: "refund",
        originalReceiptId: { $in: captureIds },
        createdAt: { $lte: now },
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean(),
      AdSpend.find({
        tenantId,
        date: {
          $gte: start.toISOString().slice(0, 10),
          $lte: now.toISOString().slice(0, 10),
        },
      })
        .sort({ updatedAt: -1 })
        .limit(20001)
        .lean(),
    ]);
    if (touches.length > 100000)
      throw new AppError(
        422,
        "REPORT_TOO_LARGE",
        "Select a shorter reporting window.",
      );
    const touchesByLead = new Map<string, typeof touches>();
    for (const touch of touches) {
      const list = touchesByLead.get(String(touch.leadId)) ?? [];
      list.push(touch);
      touchesByLead.set(String(touch.leadId), list);
    }
    const refundsByCapture = new Map<string, typeof refunds>();
    for (const refund of refunds) {
      const list = refundsByCapture.get(String(refund.originalReceiptId)) ?? [];
      list.push(refund);
      refundsByCapture.set(String(refund.originalReceiptId), list);
    }
    if (importedSpend.length > 20000)
      throw new AppError(
        422,
        "REPORT_TOO_LARGE",
        "Select a shorter reporting window.",
      );
    const seenSpend = new Set<string>();
    const spend = importedSpend.filter((row) => {
      const key = JSON.stringify([
        row.source,
        row.accountId || row.connectionId,
        row.campaignId,
        row.adId,
        row.date,
        row.currency,
        row.evidence,
      ]);
      if (seenSpend.has(key)) return false;
      seenSpend.add(key);
      return true;
    });
    advertising = spend.map((row) => ({
      source: row.source,
      accountId: row.accountId,
      campaignId: row.campaignId,
      campaign: row.campaign,
      adId: row.adId,
      date: row.date,
      currency: row.currency,
      spendMinor: row.amountMinor,
      clicks: row.clicks,
      impressions: row.impressions,
      evidence: row.evidence,
    }));
    // Match exact account/campaign/ad identifiers; never infer a join from a name.
    const descriptor = (t: any) => ({
      source: String(t.source ?? "Unattributed"),
      accountId: String(t.accountId ?? "").replace(/^act_/, ""),
      campaignId: String(t.campaignId ?? ""),
      adId: String(t.adId ?? ""),
    });
    const dimensionKey = (t: any) => JSON.stringify(descriptor(t));
    for (const model of ["first_touch", "last_touch", "linear"]) {
      const details = new Map<string, any>();
      const detail = (key: string, currency: string, evidence: string) => {
        const composite = JSON.stringify([key, currency, evidence]);
        if (!details.has(composite))
          details.set(composite, {
            ...JSON.parse(key),
            currency,
            evidence,
            gross: 0n,
            refunds: 0n,
            spend: 0n,
            days: new Set<string>(),
          });
        return details.get(composite)!;
      };
      const allocateDetail = (amount: string, list: any[]) =>
        attributionWeights(
          amount,
          list.map((t) => ({
            _id: String(t._id),
            source: dimensionKey(t),
            occurredAt: new Date(t.occurredAt),
          })),
          model,
        );
      const safeKey = (key: string) =>
        key === "Unattributed" ? dimensionKey({}) : key;
      for (const capture of captures) {
        const eligible = (touchesByLead.get(capture.leadId) ?? []).filter(
          (t) =>
            +new Date(t.occurredAt!) <= +capture.createdAt &&
            +new Date(t.occurredAt!) >= +capture.createdAt - 30 * 86400000,
        );
        if (capture.createdAt >= start)
          for (const [key, amount] of Object.entries(
            allocateDetail(capture.amountMinor, eligible),
          ))
            detail(safeKey(key), capture.currency, capture.evidence).gross +=
              BigInt(amount);
        let cumulative = 0n;
        for (const refund of refundsByCapture.get(capture._id) ?? []) {
          const before = allocateDetail(cumulative.toString(), eligible);
          cumulative += BigInt(refund.amountMinor);
          const after = allocateDetail(cumulative.toString(), eligible);
          if (refund.createdAt >= start)
            for (const [key, amount] of Object.entries(after))
              detail(
                safeKey(key),
                capture.currency,
                capture.evidence,
              ).refunds += BigInt(amount) - BigInt(before[key] ?? "0");
        }
      }
      for (const row of spend.filter(
        (s) => s.evidence === "provider_verified",
      )) {
        const d = detail(
          dimensionKey(row),
          String(row.currency),
          "provider_verified",
        );
        d.spend += BigInt(row.amountMinor!);
        d.days.add(row.date);
        d.campaign = row.campaign;
      }
      for (const d of details.values())
        campaigns.push({
          model,
          source: d.source,
          accountId: d.accountId,
          campaignId: d.campaignId,
          campaign: d.campaign ?? "Unmatched source tags",
          adId: d.adId,
          currency: d.currency,
          evidence: d.evidence,
          netMinor: (d.gross - d.refunds).toString(),
          spendMinor: d.spend.toString(),
          observedSpendDays: d.days.size,
          roas:
            d.spend > 0n
              ? Number(
                  ((BigInt(d.gross) - BigInt(d.refunds)) * 10000n) /
                    BigInt(d.spend),
                ) / 10000
              : null,
        });
      const buckets = new Map<
        string,
        {
          source: string;
          currency: string;
          evidence: string;
          gross: bigint;
          refunds: bigint;
          spend: bigint;
          spendDays: Set<string>;
        }
      >();
      const bucket = (source: string, currency: string, evidence: string) => {
        const key = `${currency}:${evidence}:${source}`;
        if (!buckets.has(key))
          buckets.set(key, {
            source,
            currency,
            evidence,
            gross: 0n,
            refunds: 0n,
            spend: 0n,
            spendDays: new Set(),
          });
        return buckets.get(key)!;
      };
      for (const capture of captures) {
        const eligible = (touchesByLead.get(capture.leadId) ?? [])
          .filter(
            (t) =>
              +new Date(t.occurredAt!) <= +capture.createdAt &&
              +new Date(t.occurredAt!) >= +capture.createdAt - 30 * 86400000,
          )
          .map((t) => ({
            _id: String(t._id),
            source: String(t.source),
            occurredAt: new Date(t.occurredAt!),
          }));
        if (capture.createdAt >= start)
          for (const [source, amount] of Object.entries(
            attributionWeights(capture.amountMinor, eligible, model),
          ))
            bucket(source, capture.currency, capture.evidence).gross +=
              BigInt(amount);
        let cumulative = 0n;
        for (const refund of refundsByCapture.get(capture._id) ?? []) {
          const before = attributionWeights(
            cumulative.toString(),
            eligible,
            model,
          );
          cumulative += BigInt(refund.amountMinor);
          const after = attributionWeights(
            cumulative.toString(),
            eligible,
            model,
          );
          if (refund.createdAt >= start)
            for (const [source, amount] of Object.entries(after))
              bucket(source, capture.currency, capture.evidence).refunds +=
                BigInt(amount) - BigInt(before[source] ?? "0");
        }
      }
      // Only verified live cash is compared with live provider spend. Missing days
      // remain explicit; sandbox/manual receipts never inflate live ROAS.
      for (const row of spend.filter(
        (s) => s.evidence === "provider_verified",
      )) {
        const b = bucket(
          String(row.source),
          String(row.currency),
          "provider_verified",
        );
        b.spend += BigInt(row.amountMinor!);
        b.spendDays.add(String(row.date));
      }
      for (const b of buckets.values())
        revenue.push({
          model,
          source: b.source,
          currency: b.currency,
          evidence: b.evidence,
          grossMinor: b.gross.toString(),
          refundMinor: b.refunds.toString(),
          netMinor: (b.gross - b.refunds).toString(),
          spendMinor: b.spend.toString(),
          observedSpendDays: b.spendDays.size,
          roas:
            b.spend > 0n
              ? Number(((b.gross - b.refunds) * 10000n) / b.spend) / 10000
              : null,
        });
    }
  }
  return {
    asOf: now.toISOString(),
    start: start.toISOString(),
    days,
    cohortSize: cohort.length,
    funnel,
    tracking: {
      observedAttempts: attempts.length,
      views: attempts.filter((a) => a.viewedAt).length,
      starts: attempts.filter((a) => a.startedAt).length,
      submitAttempts: attempts.filter((a) => a.submittedAt).length,
      accepted: attempts.filter((a) => a.acceptedAt).length,
      matureWithoutStart: matureAttempts.filter(
        (a) => a.viewedAt && !a.startedAt && !a.acceptedAt,
      ).length,
      matureWithoutAcceptance: matureAttempts.filter(
        (a) => a.startedAt && !a.acceptedAt,
      ).length,
    },
    stalled,
    lossReasons: [...reasons].map(([reason, count]) => ({ reason, count })),
    enrollmentReviewCount: enrolled.filter(
      (e) => e.status === "review_required",
    ).length,
    revenue,
    campaigns,
    advertising,
    selectedModel: tenant?.attributionModel,
    methodology: {
      ads: "Platform clicks and impressions are aggregate provider reports, not individually identified visitors. Ad-level joins require source plus ad_account_id, utm_id (campaign ID) and ad_id URL tags. Missing identifiers remain unmatched. Consent and browser blocking create coverage gaps.",
      funnel:
        "Unique leads created in this period with recorded milestones; milestones can be skipped and counts need not be monotonic.",
      abandonment:
        "Observed consented attempts only; 30 minutes without acceptance is inferred, not a known rejection reason.",
      stalls: "Open leads older than 7 days. Recent leads are excluded.",
      attribution:
        "30-day lookback before capture; browser source tags are self-reported. Refund allocation uses cumulative deltas. Recomputed from retained touch evidence as of this report.",
      spend:
        "Available UTC daily provider spend, not guaranteed complete coverage. ROAS is descriptive attributed cash divided by observed spend; it is not causal incrementality.",
    },
  };
}
