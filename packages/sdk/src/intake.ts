import { readAcquisitionTouch } from "../../core/src/marketing.ts";
export type IntakeConsent = { tracking: boolean; advertising: boolean };
export type IntakeInput = {
  name: string;
  email: string;
  phone?: string;
  privacyConsent: true;
  marketingConsent: boolean;
  consentVersion: string;
  website?: string;
  message?: string;
};
export type IntakeConfirmation = {
  accepted: true;
  acceptanceToken: string;
  expiresInSeconds: number;
};
export type IntakeInfo = {
  name: string;
  course: string;
  workspaceName: string;
  consentVersion: string;
  amountMinor: string;
  currency: string;
  sandboxAvailable: boolean;
};
export class IntakeError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable = false,
    public requestId?: string,
  ) {
    super(message);
    this.name = "IntakeError";
  }
}
/** Public capture only. Never supply API credentials or a tenant ID. */
export function createIntake(options: {
  apiOrigin: string;
  formKey: string;
  timeoutMs?: number;
  /** Explicitly opt into 30-minute, same-tab continuity AFTER measurement consent. */
  storage?: "memory" | "session";
}) {
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
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(options.formKey))
    throw new Error("Use the public form key from RevenuePilot.");
  const endpoint = `${url.origin}/api/v1/public/forms/${encodeURIComponent(options.formKey)}`;
  let attemptId = crypto.randomUUID(),
    anonymousId = crypto.randomUUID();
  let consent: IntakeConsent = { tracking: false, advertising: false };
  const initial = readAcquisitionTouch(
    window.location.search,
    typeof document === "undefined" ? "" : document.referrer,
    window.location.origin ?? "",
  );
  let acquisition = initial;
  const storageKey = `rp:intake:v1:${url.origin}:${options.formKey}`;
  const ttl = 30 * 60 * 1000;
  function clearStorage() {
    try {
      if (options.storage === "session")
        window.sessionStorage.removeItem(storageKey);
    } catch {
      /* storage may be disabled */
    }
  }
  function remember() {
    if (options.storage !== "session" || !consent.tracking) return;
    try {
      const stored = JSON.parse(
        window.sessionStorage.getItem(storageKey) ?? "null",
      );
      const tagged =
        initial.marketingKey ||
        initial.medium ||
        Object.keys(initial.clickIds).length;
      if (
        stored &&
        stored.expiresAt > Date.now() &&
        stored.expiresAt <= Date.now() + ttl &&
        /^[a-f0-9-]{36}$/.test(stored.attemptId) &&
        /^[a-f0-9-]{36}$/.test(stored.anonymousId) &&
        typeof stored.search === "string" &&
        stored.search.length < 2500 &&
        (!tagged || stored.search === sourceSearch(initial))
      ) {
        attemptId = stored.attemptId;
        anonymousId = stored.anonymousId;
        acquisition = readAcquisitionTouch(stored.search);
      }
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          attemptId,
          anonymousId,
          search: sourceSearch(acquisition),
          expiresAt: Date.now() + ttl,
        }),
      );
    } catch {
      /* Functional enquiry still works when browser storage is blocked. */
    }
  }
  // Persist only the allowlisted source fields, never a full URL, referrer or contact.
  function sourceSearch(t: ReturnType<typeof readAcquisitionTouch>) {
    const p = new URLSearchParams({
      utm_source: t.source,
      utm_medium: t.medium,
      utm_campaign: t.campaign,
      ad_account_id: t.accountId,
      utm_id: t.campaignId,
      ad_id: t.adId,
    });
    if (t.marketingKey) p.set("rp_link", t.marketingKey);
    for (const [key, value] of Object.entries(t.clickIds)) p.set(key, value);
    return p.toString();
  }
  const send = async (path: string, body?: string) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 12000,
    );
    try {
      const response = await fetch(`${endpoint}${path}`, {
        method: body ? "POST" : "GET",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new IntakeError(
          result?.title ?? "The enquiry could not be saved.",
          result?.code ?? "HTTP_ERROR",
          response.status >= 500 ||
            response.status === 429 ||
            response.status === 408,
          result?.requestId,
        );
      if (
        !result ||
        (path === "/submit" &&
          (result.accepted !== true ||
            typeof result.acceptanceToken !== "string"))
      )
        throw new IntakeError(
          "Confirmation could not be read. Retry the same enquiry.",
          "INVALID_RESPONSE",
          true,
        );
      return result;
    } catch (error) {
      if (error instanceof IntakeError) throw error;
      throw new IntakeError(
        "We could not confirm your enquiry. Please retry the same details.",
        "NETWORK_ERROR",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  };
  let pendingInput: string | undefined;
  let pendingBody: string | undefined,
    pendingPromise: Promise<IntakeConfirmation> | undefined;
  let confirmed: IntakeConfirmation | undefined;
  const observed = new Map<string, Promise<unknown>>();
  return {
    info: () => send("") as Promise<IntakeInfo>,
    setConsent: (next: IntakeConsent) => {
      const previous = consent.tracking;
      consent = {
        tracking: next.tracking,
        advertising: next.tracking && next.advertising,
      };
      if (consent.tracking && !previous && !pendingBody && !confirmed)
        remember();
      if (!consent.tracking) clearStorage();
    },
    record: async (type: "viewed" | "started" | "submitted") => {
      if (!consent.tracking || confirmed) return { collected: false };
      if (observed.has(type)) return observed.get(type);
      const promise = send(
        "/events",
        JSON.stringify({
          attemptId,
          anonymousId,
          type,
          path: window.location.pathname,
          trackingConsent: true,
          touch: acquisition,
        }),
      ).catch((error) => {
        observed.delete(type);
        throw error;
      });
      observed.set(type, promise);
      return promise;
    },
    submit: (input: IntakeInput): Promise<IntakeConfirmation> => {
      const inputKey = JSON.stringify(input);
      // Keep the already-sent body immutable while applying withdrawal to future telemetry.
      const body =
        pendingBody ??
        JSON.stringify({
          ...input,
          entryPoint: "website",
          attemptId,
          anonymousId,
          trackingConsent: consent.tracking,
          adConsent: consent.advertising,
          ...(consent.tracking ? { touch: acquisition } : {}),
        });
      if (pendingInput && pendingInput !== inputKey)
        return Promise.reject(
          new IntakeError(
            "Retry the original details first; the earlier enquiry may already be saved.",
            "RETRY_ORIGINAL",
            true,
          ),
        );
      if (confirmed) return Promise.resolve(confirmed);
      if (pendingPromise) return pendingPromise;
      pendingInput = inputKey;
      pendingBody = body;
      pendingPromise = send("/submit", body)
        .then((result: IntakeConfirmation) => {
          confirmed = result;
          clearStorage();
          return result;
        })
        .catch((error: IntakeError) => {
          // Definitive validation failures permit correction; conflicts require review.
          if (
            !error.retryable &&
            !["IDEMPOTENCY_CONFLICT", "ATTEMPT_CONFLICT"].includes(error.code)
          ) {
            pendingInput = undefined;
            pendingBody = undefined;
          }
          throw error;
        })
        .finally(() => {
          pendingPromise = undefined;
        });
      return pendingPromise;
    },
  };
}
