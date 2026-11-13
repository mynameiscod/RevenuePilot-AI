import type { ClientSession } from "mongoose";
import { classifySource } from "../../../../packages/core/src/marketing.ts";
import { MarketingLink } from "./models.ts";
export async function resolveSource(
  form: any,
  input: any,
  session?: ClientSession,
) {
  const raw = input ?? {
    source: "Direct",
    medium: "",
    campaign: "",
    clickIds: {},
  };
  if (raw.marketingKey) {
    const query = MarketingLink.findOne({
      tenantId: form.tenantId,
      formId: form._id,
      publicKey: raw.marketingKey,
      active: true,
    });
    if (session) query.session(session);
    const link = await query.lean();
    if (!link)
      return {
        source: "Other",
        sourceDetail: "",
        medium: "",
        campaign: "",
        accountId: "",
        campaignId: "",
        adId: "",
        clickIds: {},
        tagStatus: "link_unavailable",
      };
    return {
      source: String(link.channel),
      sourceDetail: String(link.source),
      medium: String(link.medium),
      campaign: String(link.campaign),
      accountId: String(link.accountId ?? ""),
      campaignId: String(link.campaignId ?? ""),
      adId: String(link.adId ?? ""),
      clickIds: raw.clickIds ?? {},
      marketingLinkId: String(link._id),
      tagStatus: "managed_link",
    };
  }
  const source = classifySource(
    raw.source ?? "Direct",
    raw.medium ?? "",
    raw.clickIds ?? {},
  );
  return {
    source,
    sourceDetail: raw.source ?? "Direct",
    medium: raw.medium ?? "",
    campaign: raw.campaign ?? "",
    accountId: raw.accountId ?? "",
    campaignId: raw.campaignId ?? "",
    adId: raw.adId ?? "",
    clickIds: raw.clickIds ?? {},
    tagStatus:
      source === "Direct"
        ? "direct"
        : source === "Other"
          ? "unrecognized"
          : "browser_tags",
  };
}
