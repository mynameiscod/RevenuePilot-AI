import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  Radar,
  RefreshCw,
  Target,
} from "lucide-react";
import { can } from "../../../../packages/core/src/contracts.ts";
import { marketingPresets } from "../../../../packages/core/src/marketing.ts";
import { useLoad, useWorkspace } from "../workspace";
import {
  Channel,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  StageBadge,
  formatMoney,
  timeLabel,
} from "../components";
import { intakeExample } from "../../../../packages/sdk/src/example.ts";
import { Heading, useAction } from "./Workspace";

type Report = {
  totals: Record<string, number>;
  sources: any[];
  links: any[];
  advertising: any[];
  recentLeads: any[];
  recentLeadsTotal: number;
  forms: any[];
  connections: any[];
  period: { from: string; to: string };
  integration?: { apiOrigin: string };
};
const evidenceLabel = (e: string) =>
  ({
    managed_link: "Campaign link",
    browser_tags: "Browser tags / referrer",
    provider_import: "Imported source",
    recorded_source: "Manually recorded",
    no_tracking_consent: "Tracking not granted",
    link_unavailable: "Link unavailable",
    unrecognized: "Source needs review",
    direct: "Direct / no referrer",
  })[e] ?? "Recorded source";
export function MarketingSources() {
  const { tenant, refresh, notify } = useWorkspace(),
    action = useAction();
  const [days, setDays] = useState(30),
    [tab, setTab] = useState("links"),
    [filter, setFilter] = useState("all"),
    [preset, setPreset] = useState<string | null>(null),
    [created, setCreated] = useState(""),
    [setup, setSetup] = useState<any>(null);
  const { data, error, loading } = useLoad<Report>(
    can(tenant.role, "marketing.read") ? `/marketing?days=${days}` : null,
  );
  const manage = can(tenant.role, "settings.write");
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("Campaign link copied");
    } catch {
      notify("Select the link text and copy it manually.");
    }
  }
  function downloadExample(formKey: string, apiOrigin: string) {
    const url = URL.createObjectURL(
      new Blob([intakeExample(apiOrigin, formKey)], { type: "text/html" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "revenuepilot-enquiry.html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Website form downloaded. Host it on an allowed website to test.");
  }
  if (!can(tenant.role, "marketing.read"))
    return (
      <Empty
        title="Marketing access required"
        text="An owner, administrator or analyst can review marketing sources."
      />
    );
  if (error) return <ErrorBox message={error} retry={refresh} />;
  if (loading || !data) return <Loading />;
  const filteredLeads = data.recentLeads.filter(
    (l) => filter === "all" || l.source === filter,
  );
  return (
    <>
      <Heading
        eyebrow="MARKETING SOURCES"
        title="Marketing"
        text="Create campaign links, follow consented visits and see where your leads came from."
      >
        <select
          className="form-select"
          aria-label="Marketing reporting period"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
        <button className="btn btn-outline-secondary" onClick={refresh}>
          <RefreshCw size={16} /> Refresh
        </button>
        {manage && (
          <button
            className="btn btn-primary"
            onClick={() => {
              action.setError("");
              setPreset("meta");
            }}
          >
            <Plus size={17} /> Create campaign link
          </button>
        )}
      </Heading>
      {action.error && !preset && <ErrorBox message={action.error} />}
      {created && (
        <div className="marketing-created panel padded">
          <div>
            <strong>Your campaign link is ready</strong>
            <p>
              Open it, grant optional measurement and submit a synthetic enquiry
              to verify the source.
            </p>
          </div>
          <input
            aria-label="Created campaign link"
            className="form-control"
            value={created}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button
            className="btn btn-outline-primary"
            onClick={() => copy(created)}
          >
            <Copy size={16} /> Copy link
          </button>
          <a
            className="btn btn-primary"
            href={created}
            target="_blank"
            rel="noreferrer"
          >
            Open link <ExternalLink size={15} />
          </a>
        </div>
      )}
      <div className="marketing-metrics">
        {[
          [
            "Observed form visits",
            data.totals.observedVisits,
            "Consented attempts, not ad clicks",
          ],
          ["New leads", data.totals.leads, "Created in this reporting period"],
          [
            "Leads with source evidence",
            data.totals.trackedLeads,
            "A consented browser touch is linked",
          ],
          [
            "Paid leads missing exact IDs",
            data.totals.incompletePaidTags,
            "Account, campaign or ad ID absent",
          ],
        ].map(([label, value, hint]) => (
          <section className="panel marketing-metric" key={String(label)}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </section>
        ))}
      </div>
      <div
        className="marketing-tabs"
        role="tablist"
        aria-label="Marketing views"
      >
        {[
          ["links", "Campaign links"],
          ["sources", "Sources"],
          ["evidence", "Source evidence"],
        ].map(([value, label]) => (
          <button
            key={value}
            role="tab"
            tabIndex={tab === value ? 0 : -1}
            aria-selected={tab === value}
            aria-controls="marketing-panel"
            id={`marketing-tab-${value}`}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              const values = ["links", "sources", "evidence"];
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : (values.indexOf(value) +
                        (event.key === "ArrowRight" ? 1 : 2)) %
                      3;
              setTab(values[next]);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("button[role=tab]")
                [next]?.focus();
            }}
          >
            {label}
            {value === "links" && <span>{data.links.length}</span>}
          </button>
        ))}
      </div>
      <div
        id="marketing-panel"
        role="tabpanel"
        aria-labelledby={`marketing-tab-${tab}`}
      >
        {tab === "sources" && (
          <>
            <div className="marketing-guide panel padded">
              <div>
                <span className="eyebrow">YOUR SOURCE FLOW</span>
                <h2>Link the campaign. Check the evidence.</h2>
                <p>
                  Start with a hosted enquiry form or connect your own landing
                  page.
                </p>
              </div>
              <ol>
                <li>
                  <span>1</span>Create a campaign link
                </li>
                <li>
                  <span>2</span>Capture a consented visit
                </li>
                <li>
                  <span>3</span>Verify the lead’s source
                </li>
              </ol>
            </div>
            <section className="panel padded mb-4">
              <h2>Form progress by source</h2>
              <p>
                Follow observed visits through to accepted enquiries. Visits
                without acceptance may still be in progress; they do not
                establish why someone stopped.
              </p>
              {data.sources.some(
                (row) => row.visits || row.starts || row.acceptedEnquiries,
              ) ? (
                <div className="table-responsive">
                  <table className="table marketing-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Visited</th>
                        <th>Started</th>
                        <th>Submitted</th>
                        <th>Accepted enquiries</th>
                        <th>Visits without acceptance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sources
                        .filter(
                          (row) =>
                            row.visits || row.starts || row.acceptedEnquiries,
                        )
                        .map((row) => (
                          <tr key={row.source}>
                            <td>
                              <Channel name={row.source} />
                            </td>
                            <td>{row.visits}</td>
                            <td>{row.starts}</td>
                            <td>{row.submissions}</td>
                            <td>{row.acceptedEnquiries}</td>
                            <td>{row.unacceptedVisits}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="small-note">
                  No consented form activity yet. Open a campaign link and allow
                  measurement to check the flow.
                </p>
              )}
              <p className="small-note">
                Each column counts recorded events on distinct attempts. Missing
                observations are not filled in. Ad clicks come from account
                imports and are shown separately under Source evidence.
              </p>
            </section>
            <div className="marketing-source-grid">
              {marketingPresets.map((p) => {
                const row = data.sources.find((s) => s.source === p.channel),
                  matching = data.connections.filter(
                    (c) => c.provider === p.provider,
                  ),
                  count = data.links.filter(
                    (l) => l.preset === p.id && l.active,
                  ).length;
                return (
                  <section className="panel marketing-source-card" key={p.id}>
                    <div className="d-flex justify-content-between align-items-start">
                      <Channel name={p.channel} />
                      <span className="marketing-chip">
                        {count} active links
                      </span>
                    </div>
                    <strong className="marketing-source-count">
                      {row?.leads ?? 0}
                      <small>new leads</small>
                    </strong>
                    <p>
                      {row?.trackedLeads ?? 0} with browser evidence ·{" "}
                      {row?.visits ?? 0} observed visits
                    </p>
                    <div className="marketing-source-status">
                      <i
                        className={
                          matching.some((c) => c.status === "active")
                            ? "live"
                            : ""
                        }
                      />
                      {p.provider
                        ? matching.length
                          ? matching
                              .map((c) => `${c.label}: ${c.mode} / ${c.status}`)
                              .join(" · ")
                          : "Ad account not connected"
                        : "Tagged link or referrer capture"}
                    </div>
                    <div className="d-flex gap-2 flex-wrap">
                      {manage && (
                        <button
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => {
                            action.setError("");
                            setPreset(p.id);
                          }}
                        >
                          Create link
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-link"
                        onClick={() => {
                          setFilter(p.channel);
                          setTab("evidence");
                        }}
                      >
                        View leads <ArrowRight size={13} />
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
            <section className="panel padded mt-4">
              <div className="d-flex justify-content-between flex-wrap gap-2">
                <div>
                  <h2>Readiness and coverage</h2>
                  <p>
                    Missing evidence remains visible. Imported ad clicks and
                    consented visits use different counting methods.
                  </p>
                </div>
                {manage && (
                  <Link
                    to="/operations"
                    className="btn btn-outline-secondary align-self-start"
                  >
                    Connect and sync accounts <ArrowRight size={16} />
                  </Link>
                )}
              </div>
              <div className="marketing-checks">
                <p>
                  <Check size={17} />
                  <span>
                    <strong>
                      {data.links.filter((l) => l.active).length} active links
                    </strong>{" "}
                    · link tags are resolved against this workspace and form.
                  </span>
                </p>
                <p>
                  <Radar size={17} />
                  <span>
                    <strong>
                      {data.totals.unknownLeads} leads with unavailable source
                      evidence
                    </strong>{" "}
                    · includes missing tracking permission or unavailable
                    campaign links.
                  </span>
                </p>
                <p>
                  <Target size={17} />
                  <span>
                    <strong>
                      {data.advertising.length} imported ad rows in this period
                    </strong>{" "}
                    · no imported spend means cost and return cannot yet be
                    evaluated.
                  </span>
                </p>
              </div>
            </section>
          </>
        )}
        {tab === "links" && (
          <section className="panel padded">
            <div className="d-flex justify-content-between flex-wrap">
              <div>
                <h2>Your campaign links</h2>
                <p>
                  Source details remain fixed so historical attribution is
                  consistent. Create a new link when a campaign changes.
                </p>
              </div>
              {manage && (
                <Link to="/intake" className="btn btn-link">
                  Manage enquiry forms
                </Link>
              )}
            </div>
            {!data.links.length ? (
              <Empty
                title="Create your first campaign link"
                text="Choose a source and an enquiry form. RevenuePilot generates a tagged address you can use in your campaign."
              />
            ) : (
              <div className="table-responsive">
                <table className="table marketing-table">
                  <thead>
                    <tr>
                      <th>Campaign link</th>
                      <th>Source</th>
                      <th>Form activity</th>
                      <th>Accepted enquiries</th>
                      <th>New leads</th>
                      <th>Coverage</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.links.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.name}</strong>
                          <small>{l.campaign}</small>
                          <span
                            className={`marketing-chip ${l.active ? "" : "muted"}`}
                          >
                            {l.active ? "Active" : "Paused"}
                          </span>
                        </td>
                        <td>
                          {l.channel}
                          <small>
                            {l.source} / {l.medium}
                          </small>
                        </td>
                        <td>
                          {l.visits} visits
                          <small>
                            {l.starts} started · {l.submissions} submitted
                          </small>
                        </td>
                        <td>{l.acceptedEnquiries}</td>
                        <td>{l.newLeads}</td>
                        <td>
                          {l.lastObservedAt ? (
                            <>
                              Observed
                              <small>
                                {timeLabel(l.lastObservedAt, tenant.timezone)}
                              </small>
                            </>
                          ) : (
                            "Awaiting first visit"
                          )}
                          {!l.paidIdsComplete && (
                            <small className="marketing-warning">
                              Exact ad IDs incomplete
                            </small>
                          )}
                        </td>
                        <td>
                          <div className="d-flex gap-2 flex-wrap">
                            <button
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => setSetup(l)}
                            >
                              Setup & link
                            </button>
                            {manage && (
                              <button
                                className="btn btn-sm btn-link"
                                disabled={action.busy}
                                onClick={() =>
                                  action.run(
                                    `/marketing/links/${l.id}`,
                                    { active: !l.active },
                                    "PATCH",
                                    l.active
                                      ? "Campaign link paused"
                                      : "Campaign link enabled",
                                  )
                                }
                              >
                                {l.active ? "Pause" : "Enable"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {tab === "evidence" && (
          <>
            <section className="panel padded">
              <div className="d-flex justify-content-between flex-wrap gap-2">
                <div>
                  <h2>Recent leads and their first source</h2>
                  <p>
                    Showing up to 50 recent leads from {data.recentLeadsTotal}{" "}
                    in this period. A returning enquiry does not create another
                    new lead.
                  </p>
                </div>
                <select
                  aria-label="Filter marketing source"
                  className="form-select marketing-source-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All sources</option>
                  {data.sources.map((s) => (
                    <option key={s.source}>{s.source}</option>
                  ))}
                </select>
              </div>
              {!filteredLeads.length ? (
                <Empty
                  title="No matching leads yet"
                  text="Open a campaign link, grant measurement and submit an enquiry. Refresh this view to check its source."
                />
              ) : (
                <div className="table-responsive">
                  <table className="table marketing-table">
                    <thead>
                      <tr>
                        <th>Lead</th>
                        <th>Source / medium</th>
                        <th>Campaign</th>
                        <th>Evidence</th>
                        <th>Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <Link to={`/leads/${l.id}`}>{l.name}</Link>
                            <small>{l.course}</small>
                          </td>
                          <td>
                            {l.source}
                            <small>
                              {l.sourceDetail} {l.medium && ` / ${l.medium}`}
                            </small>
                          </td>
                          <td>
                            {l.campaign || "No campaign"}
                            <small>{l.marketingLinkName ?? ""}</small>
                          </td>
                          <td>
                            {evidenceLabel(l.evidence)}
                            <small>
                              {l.accountId && `Account ${l.accountId}`}
                              {l.campaignId && ` · Campaign ${l.campaignId}`}
                              {l.adId && ` · Ad ${l.adId}`}
                            </small>
                          </td>
                          <td>
                            <StageBadge stage={l.stage} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="panel padded mt-4">
              <h2>Imported advertising costs</h2>
              <p>
                Values come from account imports. “Matching source leads” joins
                exact account, campaign and ad IDs; it is not a provider
                conversion count. Test rows remain labeled.
              </p>
              {!data.advertising.length ? (
                <Empty
                  title="No advertising costs imported"
                  text="Configure Meta or Google Ads, check access and run a spend import in Integration controls. No spend is invented from sample leads."
                />
              ) : (
                <div className="table-responsive">
                  <table className="table marketing-table">
                    <thead>
                      <tr>
                        <th>Source / campaign</th>
                        <th>Account / ad</th>
                        <th>Spend</th>
                        <th>Impressions</th>
                        <th>Clicks</th>
                        <th>Matching source leads</th>
                        <th>Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.advertising.map((a, i) => (
                        <tr key={i}>
                          <td>
                            {a.source}
                            <small>
                              {a.campaign} · {a.campaignId}
                            </small>
                          </td>
                          <td>
                            {a.accountId || "Missing account ID"}
                            <small>{a.adId}</small>
                          </td>
                          <td>{formatMoney(a.spendMinor, a.currency)}</td>
                          <td>{a.impressions}</td>
                          <td>{a.clicks}</td>
                          <td>{a.matchingSourceLeads ?? "Missing IDs"}</td>
                          <td>
                            {a.observedDays} days
                            <small>
                              {a.evidence === "provider_verified"
                                ? "Live provider import"
                                : "Provider test import"}
                            </small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Link to="/flow" className="btn btn-link px-0 mt-2">
                Continue to revenue attribution <ArrowRight size={15} />
              </Link>
            </section>
          </>
        )}
      </div>
      <p className="small-note mt-3">
        Reporting dates use UTC. No cross-device identity matching. Unknown
        sources and withheld consent remain visible; a source tag alone does not
        prove a paid click.
      </p>
      {preset && (
        <LinkBuilder
          initialPreset={preset}
          forms={data.forms}
          action={action}
          close={() => setPreset(null)}
          saved={(url) => {
            setCreated(url);
            setPreset(null);
            setTab("links");
          }}
        />
      )}
      {setup && (
        <Modal title="Set up your campaign link" close={() => setSetup(null)}>
          <p>
            <strong>{setup.name}</strong> · {setup.channel}
          </p>
          <Field label="Campaign URL">
            <textarea
              className="form-control"
              readOnly
              value={setup.url}
              rows={4}
              onFocus={(e) => e.target.select()}
            />
          </Field>
          <div className="d-flex gap-2">
            <button
              className="btn btn-outline-primary"
              onClick={() => copy(setup.url)}
            >
              <Copy size={15} /> Copy link
            </button>
            <a
              className="btn btn-primary"
              href={setup.url}
              target="_blank"
              rel="noreferrer"
            >
              Open campaign link <ExternalLink size={15} />
            </a>
          </div>
          <ol className="marketing-setup-steps">
            <li>
              Use this exact URL as the campaign destination. Do not place
              names, phone numbers or email addresses in its tags.
            </li>
            <li>
              The hosted enquiry form captures this link automatically after
              measurement consent. On your own website, connect the RevenuePilot
              intake SDK and preserve the link parameters.
            </li>
            <li>
              Open the URL, grant measurement, submit a synthetic enquiry, then
              refresh Marketing sources. The lead should show “Campaign link”
              evidence.
            </li>
            <li>
              For spend matching, use the same account, campaign and ad IDs as
              your ad account import.
            </li>
          </ol>
          {manage && (
            <Link
              to="/intake"
              onClick={() => setSetup(null)}
              className="btn btn-link px-0"
            >
              Review the form’s allowed websites
            </Link>
          )}
          {manage &&
            data.integration &&
            data.forms.find((f) => f.id === setup.formId) && (
              <details className="marketing-ids mt-3">
                <summary>Connect your own website</summary>
                <p>
                  Download a ready-to-review HTML enquiry form with this
                  workspace’s public form key and SDK address. Host it at your
                  campaign destination on an allowed website. Keep the URL tags
                  when linking to it. Measurement and advertising consent start
                  unchecked.
                </p>
                <button
                  className="btn btn-outline-primary"
                  onClick={() =>
                    downloadExample(
                      data.forms.find((f) => f.id === setup.formId)!.publicKey,
                      data.integration!.apiOrigin,
                    )
                  }
                >
                  Download website form
                </button>
                <p>
                  The website must be able to reach your RevenuePilot address. A
                  localhost address works only on your computer. Review the
                  consent text before public use.
                </p>
              </details>
            )}
        </Modal>
      )}
    </>
  );
}
function LinkBuilder({
  initialPreset,
  forms,
  action,
  close,
  saved,
}: {
  initialPreset: string;
  forms: any[];
  action: ReturnType<typeof useAction>;
  close: () => void;
  saved: (url: string) => void;
}) {
  const [selected, setSelected] = useState(initialPreset),
    [formId, setFormId] = useState(forms[0]?.id ?? "");
  const preset = marketingPresets.find((p) => p.id === selected)!,
    form = forms.find((f) => f.id === formId),
    operation = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const result = await action.run(
      "/marketing/links",
      {
        ...values,
        formId,
        preset: selected,
        medium: preset.medium,
        source: preset.provider ? preset.source : values.source,
      },
      "POST",
      "Campaign link created",
      operation.current,
    );
    if (result) saved(result.url);
  }
  return (
    <Modal title="Create campaign link" close={close}>
      {action.error && <ErrorBox message={action.error} />}
      <p>
        Keep source details consistent from the campaign to the accepted
        enquiry.
      </p>
      {!forms.length ? (
        <Empty
          title="Create an enquiry form first"
          text="An active form provides the workspace, course and allowed websites."
          action={
            <Link to="/intake" className="btn btn-primary">
              Create enquiry form
            </Link>
          }
        />
      ) : (
        <form onSubmit={submit}>
          <Field label="Marketing source">
            <select
              className="form-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {marketingPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Link name">
            <input
              name="name"
              className="form-control"
              required
              minLength={2}
              maxLength={100}
              placeholder="Java November — enquiry campaign"
            />
          </Field>
          <Field label="Enquiry form">
            <select
              className="form-select"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
            >
              {forms.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.name} · {f.course}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Campaign name">
            <input
              name="campaign"
              className="form-control"
              required
              minLength={2}
              maxLength={120}
              placeholder="java_november_2026"
            />
          </Field>
          <div className="row">
            <div className="col-sm-6">
              <Field label="Source tag">
                <input
                  key={selected}
                  name="source"
                  className="form-control"
                  defaultValue={preset.source}
                  readOnly={!!preset.provider}
                  required
                  maxLength={80}
                />
              </Field>
            </div>
            <div className="col-sm-6">
              <Field label="Medium">
                <input
                  className="form-control"
                  value={preset.medium}
                  readOnly
                />
              </Field>
            </div>
          </div>
          <details className="marketing-ids" open={!!preset.provider}>
            <summary>Match advertising costs with exact IDs</summary>
            <p>
              Optional now. All three IDs are needed for an exact match to
              imported ad costs. Use IDs, not display names.
            </p>
            <div className="row">
              {[
                ["accountId", "Ad account ID"],
                ["campaignId", "Campaign ID"],
                ["adId", "Ad ID"],
              ].map(([name, label]) => (
                <div className="col-sm-4" key={name}>
                  <Field label={label}>
                    <input
                      name={name}
                      className="form-control"
                      maxLength={100}
                      pattern="[a-zA-Z0-9_-]*"
                    />
                  </Field>
                </div>
              ))}
            </div>
          </details>
          <Field
            label="Website page (optional)"
            hint={`Leave blank to use the hosted enquiry form. An external page must use the intake SDK. Allowed websites: ${(form?.origins ?? []).join(", ")}`}
          >
            <input
              name="landingUrl"
              className="form-control"
              type="url"
              maxLength={1000}
              placeholder="https://your-website.com/java"
            />
          </Field>
          <button className="btn btn-primary w-100" disabled={action.busy}>
            {action.busy ? "Creating…" : "Generate campaign link"}
            <Link2 size={16} />
          </button>
        </form>
      )}
    </Modal>
  );
}
