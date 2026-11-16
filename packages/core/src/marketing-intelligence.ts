/** Aggregate diagnostics, never identity or advertising eligibility inference. */
export type Observation = {
  formId?: string;
  path?: string;
  createdAt?: Date | string;
  viewedAt?: Date | string;
  startedAt?: Date | string;
  submittedAt?: Date | string;
  failedAt?: Date | string;
  acceptedAt?: Date | string;
  failureCode?: string;
  touch?: { source?: string; campaign?: string };
};
export const gapLabels = {
  accepted: "Accepted enquiry",
  pending: "Recent activity — still pending",
  technical: "Observed problem — no acceptance",
  submitted: "Submitted — acceptance not recorded",
  started: "Started — acceptance not recorded",
  viewed: "Viewed — start not recorded",
  unknown: "Earlier activity unavailable",
} as const;
export type Gap = keyof typeof gapLabels;
const millis = (value?: Date | string) =>
  value ? new Date(value).getTime() : 0;
export function classifyAttempt(
  a: Observation,
  now: number,
  maturityMinutes = 30,
): Gap {
  if (a.acceptedAt) return "accepted";
  const observed = [a.viewedAt, a.startedAt, a.submittedAt, a.failedAt]
    .map(millis)
    .filter(Number.isFinite);
  const last = Math.max(0, ...observed);
  if (!last) return "unknown";
  if (last > now - maturityMinutes * 60_000) return "pending";
  if (a.failedAt) return "technical";
  if (a.submittedAt) return "submitted";
  if (a.startedAt) return "started";
  if (a.viewedAt) return "viewed";
  return "unknown";
}
export function summarizeAttempts(
  attempts: Observation[],
  now: number,
  maturityMinutes = 30,
) {
  const empty = () =>
    Object.fromEntries(Object.keys(gapLabels).map((k) => [k, 0])) as Record<
      Gap,
      number
    >;
  const counts = empty();
  const groups = new Map<
    string,
    {
      formId: string;
      source: string;
      campaign: string;
      attempts: number;
      counts: Record<Gap, number>;
    }
  >();
  for (const a of attempts) {
    const gap = classifyAttempt(a, now, maturityMinutes);
    counts[gap]++;
    const dimensions = [
      a.formId ?? "",
      a.touch?.source ?? "Unknown",
      a.touch?.campaign ?? "",
    ];
    const key = JSON.stringify(dimensions);
    if (!groups.has(key))
      groups.set(key, {
        formId: dimensions[0],
        source: dimensions[1],
        campaign: dimensions[2],
        attempts: 0,
        counts: empty(),
      });
    const row = groups.get(key)!;
    row.attempts++;
    row.counts[gap]++;
  }
  return {
    total: attempts.length,
    counts,
    groups: [...groups.values()],
    maturityMinutes,
    basis:
      "Consented form attempts created in the selected period; not unique people or ad clicks. Pending uses the latest observed event.",
  };
}
export const recoveryProviders = {
  google_ads: { label: "Google / YouTube", recipe: true, audienceSync: false },
  meta: { label: "Meta", recipe: false, audienceSync: false },
} as const;
export function recoveryRecipe(
  plan: {
    name: string;
    provider: keyof typeof recoveryProviders;
    segment: string;
    membershipDays: number;
  },
  form: { publicKey: string; course?: string },
) {
  const supported = recoveryProviders[plan.provider].recipe;
  return {
    schemaVersion: 1,
    name: plan.name,
    provider: plan.provider,
    destination: plan.provider === "google_ads" ? "YouTube" : "Meta",
    readiness: supported
      ? "manual_provider_setup_required"
      : "connector_backlog",
    membershipDays: plan.membershipDays,
    include: supported
      ? {
          event:
            plan.segment === "started_not_accepted"
              ? "rp_form_start"
              : "rp_form_view",
          form_id: form.publicKey,
        }
      : null,
    exclude: supported
      ? [{ event: "generate_lead", form_id: form.publicKey }]
      : [],
    events: supported
      ? [
          "rp_form_view",
          "rp_form_start",
          "rp_submit_attempt",
          "rp_form_error",
          "generate_lead",
        ]
      : [],
    requirements: supported
      ? [
          "Use a Google tag with explicit advertising personalization consent; analytics consent alone is insufficient.",
          "Link GA4 and Google Ads, enable permitted advertising features and verify the event parameters in DebugView/Tag Assistant.",
          "Exclude accepted enquiries for this offering in the provider audience; generate_lead fires only after server acceptance.",
          "Inspect the provider's actual audience eligibility and size. Local attempt counts cannot predict matched users.",
          "Choose the audience in a reviewed campaign. Saving this plan does not publish ads, sync audiences or spend money.",
          "Provider inclusion is asynchronous and does not implement RevenuePilot's 30-minute diagnostic maturity rule. Add a supported delay rule separately if required.",
        ]
      : [
          "Meta audience synchronization and its event mapping remain in the connector backlog. This plan cannot activate a Meta audience.",
          "Google event names are not a Meta integration. Configure and certify the Meta connector before using this plan.",
        ],
    identityExport: false,
    automaticActivation: false,
  };
}
