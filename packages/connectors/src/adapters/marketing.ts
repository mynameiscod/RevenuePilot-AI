import { z } from "zod";
import { createHash } from "node:crypto";
import {
  providerJson,
  providerId,
  ProviderError,
  type Transport,
} from "../http.ts";
export type ProviderContext = {
  provider: string;
  mode: "test" | "live";
  settings: any;
  credentials: Record<string, string>;
  transport?: Transport;
};
const auth = (c: ProviderContext) => ({
  Authorization: `Bearer ${c.credentials.accessToken}`,
});
export const decimalToMinor = (value: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new ProviderError("INVALID_SPEND_VALUE");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
};
export async function googleToken(c: ProviderContext) {
  const result = z
    .object({ access_token: z.string() })
    .parse(
      await providerJson(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: c.credentials.clientId,
            client_secret: c.credentials.clientSecret,
            refresh_token: c.credentials.refreshToken,
            grant_type: "refresh_token",
          }),
        },
        c.transport,
      ),
    );
  return result.access_token;
}
export async function pullSpend(
  c: ProviderContext,
  since: string,
  until: string,
  cursor?: string,
) {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  date.parse(since);
  date.parse(until);
  if (c.provider === "meta") {
    const url = new URL(
      `https://graph.facebook.com/${c.settings.apiVersion}/${c.settings.adAccountId}/insights`,
    );
    url.search = new URLSearchParams({
      fields:
        "campaign_id,campaign_name,ad_id,date_start,spend,clicks,impressions,account_currency",
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      limit: "100",
      ...(cursor ? { after: cursor } : {}),
    }).toString();
    const row = z.object({
      campaign_id: z.string(),
      campaign_name: z.string(),
      ad_id: z.string(),
      date_start: z.string(),
      spend: z.string(),
      clicks: z.string(),
      impressions: z.string(),
      account_currency: z.enum(["INR", "USD", "AED"]),
    });
    const response = z
      .object({
        data: z.array(row),
        paging: z
          .object({
            cursors: z.object({ after: z.string().optional() }).optional(),
            next: z.string().optional(),
          })
          .optional(),
      })
      .parse(await providerJson(url, { headers: auth(c) }, c.transport));
    return {
      items: response.data.map((r) => ({
        source: "Meta Ads",
        campaign: r.campaign_name,
        campaignId: r.campaign_id,
        adId: r.ad_id,
        date: r.date_start,
        currency: r.account_currency,
        amountMinor: decimalToMinor(r.spend),
        clicks: Number(r.clicks),
        impressions: Number(r.impressions),
      })),
      nextCursor: response.paging?.next
        ? response.paging.cursors?.after
        : undefined,
    };
  }
  if (c.provider === "google_ads") {
    const token = await googleToken(c);
    const query = `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ad_group_ad.ad.id, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, customer.currency_code FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`;
    const data = z
      .object({
        results: z
          .array(
            z.object({
              campaign: z.object({
                id: z.string(),
                name: z.string(),
                advertisingChannelType: z.string(),
              }),
              adGroupAd: z.object({ ad: z.object({ id: z.string() }) }),
              segments: z.object({ date: z.string() }),
              metrics: z.object({
                costMicros: z.string(),
                clicks: z.string(),
                impressions: z.string(),
              }),
              customer: z.object({
                currencyCode: z.enum(["INR", "USD", "AED"]),
              }),
            }),
          )
          .default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(
        await providerJson(
          `https://googleads.googleapis.com/${c.settings.apiVersion}/customers/${c.settings.customerId}/googleAds:search`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "developer-token": c.credentials.developerToken,
              ...(c.settings.loginCustomerId
                ? { "login-customer-id": c.settings.loginCustomerId }
                : {}),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query,
              ...(cursor ? { pageToken: cursor } : {}),
            }),
          },
          c.transport,
        ),
      );
    return {
      items: data.results.map((r) => ({
        source:
          r.campaign.advertisingChannelType === "VIDEO"
            ? "YouTube Ads"
            : "Google Ads",
        campaign: r.campaign.name,
        campaignId: r.campaign.id,
        adId: r.adGroupAd.ad.id,
        date: r.segments.date,
        currency: r.customer.currencyCode,
        amountMinor: (
          (BigInt(r.metrics.costMicros) + 5000n) /
          10000n
        ).toString(),
        clicks: Number(r.metrics.clicks),
        impressions: Number(r.metrics.impressions),
      })),
      nextCursor: data.nextPageToken,
    };
  }
  throw new ProviderError("CAPABILITY_UNAVAILABLE");
}
export async function pullContacts(c: ProviderContext, cursor?: string) {
  if (c.provider === "hubspot") {
    const url = new URL("https://api.hubapi.com/crm/objects/2026-03/contacts");
    url.search = new URLSearchParams({
      limit: "100",
      properties: "firstname,lastname,email,phone",
      ...(cursor ? { after: cursor } : {}),
    }).toString();
    const data = z
      .object({
        results: z.array(
          z.object({
            id: z.string(),
            properties: z.record(z.string(), z.string().nullable()),
          }),
        ),
        paging: z
          .object({ next: z.object({ after: z.string() }).optional() })
          .optional(),
      })
      .parse(await providerJson(url, { headers: auth(c) }, c.transport));
    return {
      items: data.results.map((r) => ({
        externalId: r.id,
        name:
          [r.properties.firstname, r.properties.lastname]
            .filter(Boolean)
            .join(" ") || "CRM enquiry",
        email: r.properties.email ?? "",
        phone: r.properties.phone?.replace(/[ ()-]/g, "") ?? "",
        source: "Other",
        campaign: "HubSpot import",
      })),
      nextCursor: data.paging?.next?.after,
    };
  }
  if (c.provider === "meta" && c.settings.leadFormId) {
    const url = new URL(
      `https://graph.facebook.com/${c.settings.apiVersion}/${c.settings.leadFormId}/leads`,
    );
    url.search = new URLSearchParams({
      fields: "id,created_time,field_data,ad_id,campaign_id",
      limit: "100",
      ...(cursor ? { after: cursor } : {}),
    }).toString();
    const response = z
      .object({
        data: z.array(
          z.object({
            id: z.string(),
            field_data: z.array(
              z.object({ name: z.string(), values: z.array(z.string()) }),
            ),
          }),
        ),
        paging: z
          .object({
            cursors: z.object({ after: z.string().optional() }).optional(),
            next: z.string().optional(),
          })
          .optional(),
      })
      .parse(await providerJson(url, { headers: auth(c) }, c.transport));
    return {
      items: response.data.map((r) => {
        const field = (name: string) =>
          r.field_data.find((f) => f.name === name)?.values[0] ?? "";
        return {
          externalId: r.id,
          name:
            field("full_name") ||
            [field("first_name"), field("last_name")]
              .filter(Boolean)
              .join(" ") ||
            "Meta enquiry",
          email: field("email"),
          phone: field("phone_number").replace(/[ ()-]/g, ""),
          source: "Meta Ads",
          campaign: "Meta lead form",
        };
      }),
      nextCursor: response.paging?.next
        ? response.paging.cursors?.after
        : undefined,
    };
  }
  throw new ProviderError("CAPABILITY_UNAVAILABLE");
}
export type Conversion = {
  id: string;
  occurredAt: string;
  stage: "lead_accepted" | "qualified" | "enrollment_confirmed";
  email: string;
  phone: string;
  amountMinor?: string;
  currency?: string;
  clickIds: {
    gclid?: string;
    gbraid?: string;
    wbraid?: string;
    fbclid?: string;
  };
  touchTime?: number;
};
export async function submitConversion(c: ProviderContext, event: Conversion) {
  if (c.provider === "meta") {
    if (!c.settings.pixelId || (c.mode === "test" && !c.settings.testEventCode))
      throw new ProviderError("CONVERSION_DESTINATION_REQUIRED");
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    const userData = {
      ...(event.email ? { em: [hash(event.email.toLowerCase().trim())] } : {}),
      ...(event.phone ? { ph: [hash(event.phone.replace(/\D/g, ""))] } : {}),
      ...(event.clickIds.fbclid && event.touchTime
        ? { fbc: `fb.1.${event.touchTime}.${event.clickIds.fbclid}` }
        : {}),
    };
    const body = {
      data: [
        {
          event_name: {
            lead_accepted: "Lead",
            qualified: "QualifiedLead",
            enrollment_confirmed: "Purchase",
          }[event.stage],
          event_time: Math.floor(Date.parse(event.occurredAt) / 1000),
          event_id: event.id,
          action_source: "system_generated",
          user_data: userData,
          ...(event.amountMinor
            ? {
                custom_data: {
                  value: Number(event.amountMinor) / 100,
                  currency: event.currency,
                },
              }
            : {}),
        },
      ],
      ...(c.mode === "test"
        ? { test_event_code: c.settings.testEventCode }
        : {}),
    };
    const response = z
      .object({
        events_received: z.number(),
        fbtrace_id: z.string().optional(),
      })
      .parse(
        await providerJson(
          `https://graph.facebook.com/${c.settings.apiVersion}/${c.settings.pixelId}/events`,
          {
            method: "POST",
            headers: { ...auth(c), "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          c.transport,
        ),
      );
    if (response.events_received !== 1)
      throw new ProviderError("CONVERSION_NOT_ACCEPTED");
    return {
      providerReference: response.fbtrace_id,
      disposition:
        c.mode === "test"
          ? "test_accepted"
          : "accepted_not_attribution_confirmed",
    };
  }
  if (c.provider === "google_ads") {
    if (
      !c.settings.conversionActionId ||
      ![
        event.clickIds.gclid,
        event.clickIds.gbraid,
        event.clickIds.wbraid,
      ].some(Boolean)
    )
      throw new ProviderError("GOOGLE_CLICK_OR_DESTINATION_MISSING");
    const token = await googleToken(c);
    const response = z
      .object({
        requestId: z.string().optional(),
        fieldWarnings: z.array(z.unknown()).optional(),
      })
      .parse(
        await providerJson(
          "https://datamanager.googleapis.com/v1/events:ingest",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              destinations: [
                {
                  reference: "rp",
                  operatingAccount: {
                    accountType: "GOOGLE_ADS",
                    accountId: c.settings.customerId,
                  },
                  ...(c.settings.loginCustomerId
                    ? {
                        loginAccount: {
                          accountType: "GOOGLE_ADS",
                          accountId: c.settings.loginCustomerId,
                        },
                      }
                    : {}),
                  productDestinationId: c.settings.conversionActionId,
                },
              ],
              events: [
                {
                  destinationReferences: ["rp"],
                  transactionId: event.id,
                  eventTimestamp: event.occurredAt,
                  adIdentifiers: {
                    ...(event.clickIds.gclid
                      ? { gclid: event.clickIds.gclid }
                      : event.clickIds.gbraid
                        ? { gbraid: event.clickIds.gbraid }
                        : { wbraid: event.clickIds.wbraid }),
                  },
                  ...(event.amountMinor
                    ? {
                        conversionValue: Number(event.amountMinor) / 100,
                        currency: event.currency,
                      }
                    : { conversionCount: 1 }),
                },
              ],
              consent: {
                adUserData: "CONSENT_GRANTED",
                adPersonalization: "CONSENT_DENIED",
              },
              validateOnly: c.mode === "test",
            }),
          },
          c.transport,
        ),
      );
    return {
      providerReference: response.requestId,
      warningCount: response.fieldWarnings?.length ?? 0,
      disposition:
        c.mode === "test"
          ? "validated_only"
          : "accepted_not_attribution_confirmed",
    };
  }
  throw new ProviderError("CAPABILITY_UNAVAILABLE");
}
