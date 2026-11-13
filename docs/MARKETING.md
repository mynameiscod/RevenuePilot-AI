# Marketing sources: campaign to accepted enquiry

This milestone connects source setup, consented browser activity and an accepted lead inside RevenuePilot. CodeBegun is the first workspace; the same flow is tenant-scoped for other customers. No external website, LMS, real ad account or production environment is changed by this implementation.

## Walk through the first source

1. Start `npm run dev:demo`, open the printed frontend address, and choose **Explore sample workspace**. Demo data is temporary and disappears when the process stops. For persistent work use the local Docker stack and your own account.
2. Open **Marketing → Create campaign link**. Select Meta Ads, Google Ads, YouTube Ads, organic search/social, referral, email, messaging, direct/offline or another source.
3. Choose an active **Intake form**, give the link and campaign readable names, and optionally enter exact ad account, campaign and ad IDs. These must be IDs from your selected account; labels do not establish a cost join. Leave Website page empty to use the hosted form immediately.
4. Generate and open the URL. On the enquiry form, explicitly grant optional measurement. Submit synthetic contact details using `example.test`. No paid ad or real student is needed for this local check.
5. Return to Marketing and refresh. **Campaign links** shows an observed visit, an accepted enquiry and a new lead. **Source evidence** shows the source, campaign and IDs. Open the lead to inspect **Journey → Where this lead came from → Source history** and its assigned follow-up.
6. Continue the **Leads → Follow-up → Demo → Payment** journey only when desired. This milestone stops at a verified source-to-lead handoff; source tags do not establish a purchase or a provider-reported conversion.

## External landing pages

An external page must be connected explicitly; generating a link alone cannot observe another website.

- Register its exact origin on the RevenuePilot intake form (scheme, hostname and port; no path). If a form was created with a different origin, create a form with the intended origins; this release does not edit form origin lists in place.
- Set **Website page** when creating the campaign link. Only a configured form origin or the RevenuePilot app origin is accepted. The destination must have no existing query/fragment or embedded credentials. Production destinations require HTTPS.
- Open **Campaign links → Setup & link → Connect your own website → Download website form**. The generated HTML uses the correct public form key and `/revenuepilot-sdk.js`. Review/adapt its consent language and styling, then place it at the chosen destination. Hosting that file is a separate explicit action; RevenuePilot does not publish it for you.
- Alternatively wire the `createIntake` API into your existing form. Import the SDK from the **RevenuePilot origin**, call `info()` for the current consent version, call `setConsent()` from actual unchecked-by-default visitor choices, record viewed/started/submitted when appropriate and submit the contact using `submit()`.
- Keep `rp_link` and campaign parameters in the visitor's destination URL. Instantiate intake on that destination before changing its URL. The SDK retains that page's initial source in memory. It does not persist source identity across full page reloads, browser sessions or devices. Separate landing-page and form-page navigation must preserve campaign parameters; do not add contact details to them.
- Both development Vite and built Nginx serve the public module with `Access-Control-Allow-Origin: *`. This applies only to the code asset. Form requests still require an exact registered origin and omit session credentials. A website's own CSP must permit the RevenuePilot script and API origin.
- A localhost API is reachable only from the same computer. Public websites need an approved reachable HTTPS RevenuePilot installation before real visitors can submit.

Example import, using your actual configured origin and form key:

```js
import { createIntake } from "https://revenuepilot.example/revenuepilot-sdk.js";
const intake = createIntake({
  apiOrigin: "https://revenuepilot.example",
  formKey: "PUBLIC_FORM_KEY_FROM_REVENUEPILOT",
});
const offer = await intake.info();
// Call from an actual visitor choice; never silently grant permission.
intake.setConsent({
  tracking: visitorAllowedMeasurement,
  advertising: visitorAllowedAdvertising,
});
await intake.record("viewed");
// After a valid form submit; checkbox values must come from the visitor.
const confirmation = await intake.submit({
  name,
  email,
  phone,
  privacyConsent: visitorAcceptedEnquiry,
  marketingConsent: visitorAllowedFollowups,
  consentVersion: offer.consentVersion,
});
```

The downloaded HTML is a complete runnable example including form fields, observation ordering, consent choices, errors and confirmation redirect. Serve it from an allowed HTTP(S) origin; opening a `file://` document is not supported.

## Evidence and counting rules

| Evidence                | Meaning                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaign link           | The public `rp_link` resolved to an active link belonging to this tenant and intake form at the first observation. Stored source metadata wins over edited URL UTM/ID fields. It does not authenticate a paid click. |
| Browser tags / referrer | Allowlisted URL tags or a recognized referrer hostname. Full referrer URLs, query strings and fragments are not stored in the touch. Tags can be forged by the visitor.                                              |
| Direct / no referrer    | No recognized acquisition signal was present. A withheld referrer is possible; this does not prove the user typed the URL.                                                                                           |
| Imported source         | A server-side CRM/provider import has a recorded source but no browser touch. No visit or marketing consent is fabricated.                                                                                           |
| Manually recorded       | An operator or historical seed supplied the source. No visit history is fabricated.                                                                                                                                  |
| Tracking not granted    | The enquiry was accepted without measurement permission. The source remains Other and no touch is saved.                                                                                                             |
| Link unavailable        | A link was invalid, paused or belonged to another form/tenant. The enquiry can still succeed, but the attempted source is not credited.                                                                              |
| Source needs review     | Browser tags could not be classified reliably.                                                                                                                                                                       |

Google organic medium maps to Organic, paid Google/YouTube to their advertising channels, organic Instagram/Facebook to Organic Social, and explicit paid social to Meta Ads. `fbclid` alone is insufficient to classify a paid ad. Untagged Google click identifiers provide an observed Google Ads source, still subject to independent provider verification.

- **Observed visits** count distinct consented form attempts with a viewed observation. They are neither ad clicks nor unique people. No observation is backfilled when someone declines tracking.
- **Started / submitted** count attempts with those recorded events. **Visits without acceptance** counts viewed attempts lacking an accepted submission. This is an observed gap, not a proven abandonment reason; in-progress visits are included. Missing steps are never reconstructed to make a funnel appear complete.
- **Accepted enquiries** count tracked attempts whose submission committed. Returning enquiries can increase this count without increasing new leads. Untracked accepted submissions still create leads but are absent from this telemetry count.
- **New leads** count records created in the selected UTC calendar period. Same normalized email + course inside one tenant reuses a lead. The report credits the earliest retained source touch; later enquiries are visible in lead source history. No cross-device identity graph is claimed.
- An attempt's first source survives later events and submission. Pausing a link blocks attribution for newly observed attempts; previously captured history remains. Re-enabling does not reconstruct missing observations.
- The report uses the last 7, 30 or 90 UTC calendar days including today. Lead and attempt cohorts are independently date-filtered; a visit before the window and a lead inside it need not have matching counts. Attempt retention can also reduce historical visit coverage. The evidence table displays only the latest 50 leads in that period; its filter applies to those 50, while summary totals cover the full bounded cohort.
- Costs use imported provider rows, separate by currency and evidence mode. Same account/source/campaign/ad/day/currency/evidence imported through multiple connections uses the most recently updated row. Exact account/campaign/ad joins report matching source leads; these are not provider-certified conversions, causal results or click-to-lead rates. Missing account IDs do not qualify for joins.
- The Marketing report does not invent spend or ROAS from sample leads. Use **Settings → Integrations** for explicit paged spend imports and **Reports** for evidence-separated revenue allocation. A live account needs its own credentials, scope checks, account certification and activation approval.

## Boundaries and acceptance

Owners/admins create and pause links; analysts can read marketing with contact masking. Counselors, finance and viewers cannot read this workspace-wide marketing report. Campaign metadata is immutable; create a new link for a different campaign. There is a 500-link workspace limit including paused links. Public link keys are routing identifiers, not secrets or authentication credentials.

Reports reject oversized windows instead of silently truncating calculations: 10,000 leads, 20,000 attempts, 20,000 imported spend rows, and 100,000 touches/import links. The maximum 200 active forms matches the highest current plan allowance. Larger customers require materialized/paginated analytics before expansion.

No request URLs should carry names, email, phone or other contact data. The supplied Nginx access log excludes query strings. The SDK sends only allowlisted acquisition fields after consent; its initial snapshot is memory-only. Third-party web servers/proxies may have their own URL logs and require their own review. Revoking measurement at submit removes this attempt's earlier observation; a later observation cannot recreate a committed untracked attempt. Consent withdrawal cannot recall a request already in flight.

Run `tests/marketing.test.ts` for source classification, canonical link resolution, concurrent attempt dedupe, returning enquiries, opt-out, tenant/role boundaries, paused links and exact ad-cost joins. Startup and Docker smoke checks verify cross-origin SDK asset delivery. The browser acceptance path is steps 1–5 above, plus the downloaded external form on an allowed origin. Real ad account reconciliation and public website installation remain separate activation work.
