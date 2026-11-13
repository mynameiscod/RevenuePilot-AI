/** Browser-safe source rules shared by capture, reporting and link creation. */
export const marketingPresets = [
  {
    id: "meta",
    label: "Meta Ads",
    channel: "Meta Ads",
    source: "meta",
    medium: "paid_social",
    provider: "meta",
  },
  {
    id: "google",
    label: "Google Ads",
    channel: "Google Ads",
    source: "google",
    medium: "cpc",
    provider: "google_ads",
  },
  {
    id: "youtube",
    label: "YouTube Ads",
    channel: "YouTube Ads",
    source: "youtube",
    medium: "paid_video",
    provider: "google_ads",
  },
  {
    id: "organic",
    label: "Organic search",
    channel: "Organic",
    source: "google",
    medium: "organic",
    provider: "",
  },
  {
    id: "social",
    label: "Organic social",
    channel: "Organic Social",
    source: "instagram",
    medium: "social",
    provider: "",
  },
  {
    id: "referral",
    label: "Referral / partner",
    channel: "Referral",
    source: "partner",
    medium: "referral",
    provider: "",
  },
  {
    id: "email",
    label: "Email",
    channel: "Email",
    source: "newsletter",
    medium: "email",
    provider: "",
  },
  {
    id: "messaging",
    label: "WhatsApp / messaging",
    channel: "Messaging",
    source: "whatsapp",
    medium: "messaging",
    provider: "",
  },
  {
    id: "direct",
    label: "Direct / offline",
    channel: "Direct",
    source: "direct",
    medium: "offline",
    provider: "",
  },
  {
    id: "other",
    label: "Other source",
    channel: "Other",
    source: "custom",
    medium: "other",
    provider: "",
  },
] as const;
export function classifySource(
  source: string,
  medium = "",
  clickIds: Record<string, unknown> = {},
) {
  const s = source.trim().toLowerCase(),
    m = medium.trim().toLowerCase();
  if (["organic", "organic_search", "seo"].includes(m)) return "Organic";
  if (["social", "organic_social"].includes(m)) return "Organic Social";
  if (m === "email") return "Email";
  if (["messaging", "whatsapp", "sms"].includes(m)) return "Messaging";
  if (m === "referral") return "Referral";
  const paid = [
    "paid",
    "cpc",
    "ppc",
    "paid_social",
    "paid_video",
    "display",
    "cpm",
  ].includes(m);
  if (
    s === "meta ads" ||
    (paid && ["meta", "facebook", "instagram", "fb"].includes(s))
  )
    return "Meta Ads";
  if (s === "youtube ads" || (paid && s === "youtube")) return "YouTube Ads";
  if (
    s === "google ads" ||
    (paid && s === "google") ||
    clickIds.gclid ||
    clickIds.gbraid ||
    clickIds.wbraid
  )
    return "Google Ads";
  if (s === "organic") return "Organic";
  if (s === "organic social") return "Organic Social";
  if (s === "email") return "Email";
  if (s === "messaging") return "Messaging";
  if (s === "referral") return "Referral";
  if (["direct", ""].includes(s) && !paid) return "Direct";
  // fbclid can also appear on organic Facebook links; it never proves ad spend.
  return "Other";
}
export function readAcquisitionTouch(
  search: string,
  referrer = "",
  currentOrigin = "",
) {
  const params = new URLSearchParams(search);
  const value = (key: string, max: number) =>
    (params.get(key) ?? "").slice(0, max);
  let source = value("utm_source", 80),
    medium = value("utm_medium", 80);
  if (
    !source &&
    !medium &&
    ["gclid", "gbraid", "wbraid"].some((k) => params.get(k))
  ) {
    source = "google";
    medium = "cpc";
  }
  if (!source && !medium) {
    try {
      const ref = new URL(referrer);
      if (
        ["https:", "http:"].includes(ref.protocol) &&
        ref.origin !== currentOrigin
      ) {
        const host = ref.hostname.toLowerCase().replace(/^www\./, "");
        source = host.slice(0, 80);
        medium =
          /^(?:google\.(?:com|co\.in|co\.uk)|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(
            host,
          )
            ? "organic"
            : /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|youtube\.com|t\.co)$/.test(
                  host,
                )
              ? "social"
              : "referral";
      }
    } catch {
      /* Referrers can be missing or withheld. */
    }
  }
  return {
    source: source || "Direct",
    medium,
    campaign: value("utm_campaign", 120),
    accountId: value("ad_account_id", 100),
    campaignId: value("utm_id", 100),
    adId: value("ad_id", 100),
    ...(params.has("rp_link") ? { marketingKey: value("rp_link", 100) } : {}),
    clickIds: Object.fromEntries(
      ["gclid", "fbclid", "gbraid", "wbraid"]
        .filter((k) => params.has(k))
        .map((k) => [k, value(k, 256)]),
    ),
  };
}
