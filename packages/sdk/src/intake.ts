export type IntakeConsent = { tracking: boolean; advertising: boolean };
export function createIntake(options: { apiOrigin: string; formKey: string }) {
  const url = new URL(options.apiOrigin);
  if (
    url.origin !== options.apiOrigin ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Use an exact HTTPS API origin, or localhost for development.",
    );
  const endpoint = `${url.origin}/api/v1/public/forms/${encodeURIComponent(options.formKey)}`;
  const attemptId = crypto.randomUUID(),
    anonymousId = crypto.randomUUID();
  let consent: IntakeConsent = { tracking: false, advertising: false };
  const touch = () => {
    const params = new URLSearchParams(window.location.search);
    const value = (key: string, max: number) =>
      (params.get(key) ?? "").slice(0, max);
    return {
      source: value("utm_source", 80) || "Direct",
      medium: value("utm_medium", 80),
      campaign: value("utm_campaign", 120),
      accountId: value("ad_account_id", 100),
      campaignId: value("utm_id", 100),
      adId: value("ad_id", 100),
      clickIds: Object.fromEntries(
        ["gclid", "gbraid", "wbraid", "fbclid"]
          .filter((key) => params.has(key))
          .map((key) => [key, value(key, 256)]),
      ),
    };
  };
  const send = async (path: string, body?: unknown) => {
    const response = await fetch(`${endpoint}${path}`, {
      method: body ? "POST" : "GET",
      credentials: "omit",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.title ?? "The enquiry could not be saved.");
    return result;
  };
  return {
    info: () => send(""),
    setConsent: (next: IntakeConsent) => {
      consent = {
        tracking: next.tracking,
        advertising: next.tracking && next.advertising,
      };
    },
    record: async (type: "viewed" | "started" | "submitted") => {
      if (!consent.tracking) return { collected: false };
      return send("/events", {
        attemptId,
        anonymousId,
        type,
        path: window.location.pathname,
        trackingConsent: true,
        touch: touch(),
      });
    },
    submit: (input: {
      name: string;
      email: string;
      phone?: string;
      privacyConsent: true;
      marketingConsent: boolean;
      consentVersion: string;
      website?: string;
    }) =>
      send("/submit", {
        ...input,
        attemptId,
        anonymousId,
        trackingConsent: consent.tracking,
        adConsent: consent.advertising,
        ...(consent.tracking ? { touch: touch() } : {}),
      }) as Promise<{
        accepted: true;
        acceptanceToken: string;
        expiresInSeconds: number;
      }>,
  };
}
