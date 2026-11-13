import { useState, useRef, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, CalendarDays, ExternalLink, Plus } from "lucide-react";
import { api, mutate } from "../api";
import { useLoad, useWorkspace } from "../workspace";
import {
  ErrorBox,
  Field,
  Loading,
  Modal,
  formatMoney,
  timeLabel,
} from "../components";
import { can } from "../../../../packages/core/src/contracts.ts";
export const values = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget)) as Record<
    string,
    string
  >;
export function Heading({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow: string;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <div className="d-flex gap-2 align-items-center flex-wrap">
        {children}
      </div>
    </div>
  );
}
export function useAction() {
  const { prefix, refresh, notify } = useWorkspace();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (
    path: string,
    body: unknown,
    method = "POST",
    message = "Saved",
    operationKey?: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      const result = await mutate<any>(
        `${prefix}${path}`,
        body,
        method,
        operationKey,
      );
      refresh();
      if (message) notify(message);
      return result;
    } catch (error: any) {
      setError(error.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, setError, busy };
}
export function IntakeForms() {
  const { tenant, refresh } = useWorkspace(),
    action = useAction();
  const { data, error, loading } = useLoad<{ items: any[] }>("/forms");
  const team = useLoad<{ items: { id: string; name: string }[] }>(
    "/journey/team",
  );
  const [open, setOpen] = useState(false),
    [created, setCreated] = useState("");
  const key = useRef(crypto.randomUUID());
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const assignees = new FormData(event.currentTarget)
      .getAll("assignees")
      .map(String);
    const v = values(event);
    if (!/^\d+(\.\d{1,2})?$/.test(v.amount)) {
      action.setError("Enter a positive amount with up to two decimal places.");
      return;
    }
    const [whole, cents = ""] = v.amount.split(".");
    const result = await action.run(
      "/forms",
      {
        name: v.name,
        course: v.course,
        amountMinor: (
          BigInt(whole) * 100n +
          BigInt(cents.padEnd(2, "0"))
        ).toString(),
        currency: v.currency,
        origins: v.origins
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        assignees,
      },
      "POST",
      "Intake form created",
      key.current,
    );
    if (result) {
      setCreated(result.url);
      setOpen(false);
      key.current = crypto.randomUUID();
    }
  }
  return (
    <>
      <Heading
        eyebrow="ACQUISITION"
        title="Enquiry forms"
        text="Capture enquiries from any channel, with consent and a counselor assigned."
      >
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} />
          Create form
        </button>
      </Heading>
      {created && (
        <div className="success-box">
          Your form is ready:{" "}
          <a href={created} target="_blank" rel="noreferrer">
            Open enquiry page <ExternalLink size={14} />
          </a>
        </div>
      )}
      {error && <ErrorBox message={error} retry={refresh} />}
      {action.error && <ErrorBox message={action.error} />}
      {loading ? (
        <Loading />
      ) : (
        <div className="journey-form-grid">
          {data?.items.map((form) => (
            <section className="panel padded" key={form._id}>
              <div className="d-flex justify-content-between gap-2">
                <span className="eyebrow">
                  {form.active ? "ACCEPTING ENQUIRIES" : "PAUSED"}
                </span>
                <button
                  className="btn btn-sm btn-outline-secondary"
                  disabled={action.busy}
                  onClick={() =>
                    action.run(
                      `/forms/${form._id}`,
                      { active: !form.active },
                      "PATCH",
                    )
                  }
                >
                  {form.active ? "Pause" : "Enable"}
                </button>
              </div>
              <h2 className="mt-3">{form.name}</h2>
              <p>
                {form.course} · {formatMoney(form.amountMinor, form.currency)}
              </p>
              <label className="small-note d-block">
                Enquiry link
                <input
                  className="form-control mt-1"
                  readOnly
                  value={form.url}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <div className="d-flex gap-2 mt-3">
                <a
                  href={form.url}
                  className="btn btn-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open form <ArrowRight size={16} />
                </a>
                <Link
                  className="btn btn-outline-secondary"
                  to={`/intake/${form._id}`}
                >
                  Payment setup
                </Link>
              </div>
              <p className="small-note mt-3">
                <Link to="/marketing">
                  Create a campaign link in Marketing sources
                </Link>{" "}
                to keep source and ad IDs consistent. Attribution is recorded
                when the visitor allows measurement.
              </p>
            </section>
          ))}
          {!data?.items.length && (
            <section className="panel padded">
              <h2>Start with your first course</h2>
              <p>
                Create a form, open its enquiry link and submit a sample lead.
                The next step is a clearly labeled sandbox checkout.
              </p>
            </section>
          )}
        </div>
      )}
      {open && (
        <Modal title="Create an enquiry form" close={() => setOpen(false)}>
          <form onSubmit={create}>
            {action.error && <ErrorBox message={action.error} />}
            <Field label="Form name">
              <input
                className="form-control"
                name="name"
                required
                minLength={2}
                placeholder="Java course enquiries"
              />
            </Field>
            <Field label="Course">
              <input
                className="form-control"
                name="course"
                required
                minLength={2}
                placeholder="Java Full Stack with AI"
              />
            </Field>
            <div className="row">
              <div className="col-8">
                <Field label="Full enrollment amount">
                  <input
                    className="form-control"
                    name="amount"
                    inputMode="decimal"
                    placeholder="35000.00"
                    required
                  />
                </Field>
              </div>
              <div className="col-4">
                <Field label="Currency">
                  <select
                    name="currency"
                    className="form-select"
                    defaultValue={tenant.currency}
                  >
                    <option>INR</option>
                    <option>USD</option>
                    <option>AED</option>
                  </select>
                </Field>
              </div>
            </div>
            <Field
              label="Allowed website origins"
              hint="One exact origin per line."
            >
              <textarea
                name="origins"
                className="form-control"
                defaultValue={window.location.origin}
                rows={2}
                required
              />
            </Field>
            <Field
              label="Assign enquiries to"
              hint="Select one or more team members for round-robin assignment. Leave empty to assign to yourself."
            >
              <select name="assignees" className="form-select" multiple>
                {team.data?.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn btn-primary" disabled={action.busy}>
              {action.busy ? "Creating…" : "Create enquiry form"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function FormPayment() {
  const { formId } = useParams(),
    action = useAction();
  const forms = useLoad<{ items: any[] }>("/forms"),
    connections = useLoad<{ items: any[] }>("/connections");
  const form = forms.data?.items.find((f) => f._id === formId);
  if (forms.error || connections.error)
    return <ErrorBox message={forms.error ?? connections.error!} />;
  if (!form) return forms.loading ? <Loading /> : <p>Form not found.</p>;
  return (
    <>
      <Heading
        eyebrow="ENROLLMENT"
        title={form.name}
        text="The server uses this form’s price. Customers cannot edit the checkout amount."
      />
      <section className="panel padded settings-panel">
        {action.error && <ErrorBox message={action.error} />}
        <h2>
          {formatMoney(form.amountMinor, form.currency)} · {form.course}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = values(e);
            void action.run(
              `/forms/${formId}/payment`,
              { connectionId: v.connectionId || null },
              "PUT",
            );
          }}
        >
          <Field label="Payment provider">
            <select
              name="connectionId"
              className="form-select"
              defaultValue={form.paymentConnectionId ?? ""}
            >
              <option value="">
                No provider — sandbox locally; unavailable in production
              </option>
              {connections.data?.items
                .filter(
                  (c) =>
                    ["stripe", "razorpay"].includes(c.provider) &&
                    ["test", "active"].includes(c.status),
                )
                .map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.label} · {c.status}
                  </option>
                ))}
            </select>
          </Field>
          <button className="btn btn-primary" disabled={action.busy}>
            Save payment provider
          </button>
        </form>
        <Link to="/operations" className="back-link mt-4">
          Configure a provider connection
        </Link>
      </section>
    </>
  );
}
export function WorkQueue() {
  const { tenant, refresh } = useWorkspace();
  const { data, error, loading } = useLoad<{ tasks: any[]; demos: any[] }>(
    "/journey/work",
  );
  return (
    <>
      <Heading
        eyebrow="COUNSELOR WORKSPACE"
        title="Follow-ups"
        text="Follow-ups and scheduled demos, ordered by when they need attention."
      />
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : loading ? (
        <Loading />
      ) : (
        <div className="two-column">
          <section className="panel padded">
            <h2>Follow-ups</h2>
            {data?.tasks.map((t) => (
              <Link
                className="journey-work-row"
                to={`/leads/${t.leadId}?tab=followup`}
                key={t._id}
              >
                <span
                  className={`work-dot ${Date.parse(t.dueAt) < Date.now() ? "overdue" : ""}`}
                />
                <div>
                  <strong>{t.leadName}</strong>
                  <p>{t.title}</p>
                  <small>{timeLabel(t.dueAt, tenant.timezone)}</small>
                </div>
                <ArrowRight size={16} />
              </Link>
            ))}
            {!data?.tasks.length && (
              <p className="muted mt-4">No open follow-ups.</p>
            )}
          </section>
          <section className="panel padded">
            <h2>Upcoming demos</h2>
            {data?.demos.map((d) => (
              <Link
                className="journey-work-row"
                to={`/leads/${d.leadId}?tab=demo`}
                key={d._id}
              >
                <CalendarDays size={20} />
                <div>
                  <strong>{d.leadName}</strong>
                  <p>{timeLabel(d.scheduledAt, tenant.timezone)}</p>
                  <small>{d.durationMinutes} minute session</small>
                </div>
                <ArrowRight size={16} />
              </Link>
            ))}
            {!data?.demos.length && (
              <p className="muted mt-4">No scheduled demos.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
const labels: Record<string, string> = {
  lead_accepted: "Accepted enquiries",
  contact_attempted: "Contact attempted",
  connected: "Connected",
  qualified: "Qualified",
  demo_scheduled: "Demo scheduled",
  demo_attended: "Demo attended",
  payment_captured: "Payment confirmed",
  enrollment_confirmed: "Enrollment confirmed",
};
export function FlowReport() {
  const [days, setDays] = useState(30),
    [model, setModel] = useState("first_touch");
  const { refresh, tenant } = useWorkspace();
  const { data, error, loading } = useLoad<any>(
    `/journey/analytics?days=${days}`,
  );
  return (
    <>
      <Heading
        eyebrow="FROM INTEREST TO REVENUE"
        title="Reports"
        text="See the enquiry-to-enrollment funnel and the revenue behind it."
      >
        <select
          className="form-select range-select"
          aria-label="Reporting period"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
        {can(tenant.role, "revenue.read") && (
          <Link className="btn btn-outline-secondary" to="/revenue">
            Payment records <ArrowRight size={16} />
          </Link>
        )}
      </Heading>
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="journey-report-metrics">
              <div className="panel padded">
                <span>Observed form visits</span>
                <strong>{data.tracking.views}</strong>
                <small>Consented activity only</small>
              </div>
              <div className="panel padded">
                <span>Leads in this report</span>
                <strong>{data.cohortSize}</strong>
                <small>Server-created lead cohort</small>
              </div>
              <div className="panel padded">
                <span>Started, not accepted</span>
                <strong>{data.tracking.matureWithoutAcceptance}</strong>
                <small>At least 30 minutes old</small>
              </div>
              <div className="panel padded">
                <span>Enrollment reviews</span>
                <strong>{data.enrollmentReviewCount}</strong>
                <small>Refund needs a decision</small>
              </div>
            </div>
            <div className="two-column">
              <section className="panel padded">
                <h2>Milestone coverage</h2>
                <p className="muted">
                  Leads created in this period. A lead may skip a milestone.
                </p>
                {data.funnel.map((f: any) => (
                  <div className="journey-funnel-row" key={f.type}>
                    <div>
                      <span>{labels[f.type]}</span>
                      <strong>{f.count}</strong>
                    </div>
                    <div className="journey-funnel-track">
                      <span
                        style={{
                          width: `${data.cohortSize ? (f.count / data.cohortSize) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </section>
              <section className="panel padded">
                <h2>Where follow-up is needed</h2>
                <p className="muted">
                  Open leads older than seven days, grouped by missing evidence.
                </p>
                {data.stalled.map((row: any) => (
                  <div className="journey-count-row" key={row.label}>
                    <span>{row.label}</span>
                    <strong>{row.count}</strong>
                  </div>
                ))}
                <h3 className="mt-4">Recorded loss reasons</h3>
                {data.lossReasons.length ? (
                  data.lossReasons.map((r: any) => (
                    <div className="journey-count-row" key={r.reason}>
                      <span>{r.reason}</span>
                      <strong>{r.count}</strong>
                    </div>
                  ))
                ) : (
                  <p className="small-note">
                    No loss reasons recorded in this cohort.
                  </p>
                )}
              </section>
            </div>
            <section className="panel padded mt-4">
              <div className="d-flex justify-content-between gap-3 flex-wrap">
                <div>
                  <h2>Revenue attribution</h2>
                  <p className="muted">
                    Thirty-day touch lookback. Currencies and evidence types
                    stay separate.
                  </p>
                </div>
                <select
                  className="form-select range-select"
                  aria-label="Attribution model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="first_touch">First touch</option>
                  <option value="last_touch">Last touch</option>
                  <option value="linear">Linear across touches</option>
                </select>
              </div>
              <div className="table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Evidence</th>
                      <th>Gross</th>
                      <th>Refunds</th>
                      <th>Net collected</th>
                      <th>Observed spend</th>
                      <th>ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.revenue
                      .filter((r: any) => r.model === model)
                      .map((r: any) => (
                        <tr key={`${r.source}-${r.currency}-${r.evidence}`}>
                          <td>{r.source}</td>
                          <td>
                            <span className="subtle-badge">
                              {r.evidence.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td>{formatMoney(r.grossMinor, r.currency)}</td>
                          <td>{formatMoney(r.refundMinor, r.currency)}</td>
                          <td>{formatMoney(r.netMinor, r.currency)}</td>
                          <td>
                            {r.observedSpendDays ? (
                              <>
                                {formatMoney(r.spendMinor, r.currency)}
                                <small className="d-block">
                                  {r.observedSpendDays} days observed
                                </small>
                              </>
                            ) : (
                              "Not connected"
                            )}
                          </td>
                          <td>
                            {r.roas === null ? "—" : `${r.roas.toFixed(2)}×`}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!data.revenue.length && (
                <p className="muted">
                  No receipts in this period, or your role cannot view revenue.
                </p>
              )}
              <p className="small-note">{data.methodology.spend}</p>
            </section>
            <section className="panel padded mt-4">
              <h2>Campaign and ad evidence</h2>
              <p className="muted">
                Exact account, campaign and ad IDs connect revenue to imported
                spend.
              </p>
              <div className="table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Source / campaign</th>
                      <th>Account / ad</th>
                      <th>Evidence</th>
                      <th>Net cash</th>
                      <th>Observed spend</th>
                      <th>ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns
                      .filter((r: any) => r.model === model)
                      .map((r: any, i: number) => (
                        <tr key={i}>
                          <td>
                            {r.source}
                            <small className="d-block">
                              {r.campaignId || r.campaign}
                            </small>
                          </td>
                          <td>
                            {r.accountId || "Missing account tag"}
                            <small className="d-block">
                              {r.adId || "Missing ad tag"}
                            </small>
                          </td>
                          <td>{r.evidence.replaceAll("_", " ")}</td>
                          <td>{formatMoney(r.netMinor, r.currency)}</td>
                          <td>
                            {r.observedSpendDays
                              ? formatMoney(r.spendMinor, r.currency)
                              : "No matching spend"}
                          </td>
                          <td>
                            {r.roas === null ? "—" : `${r.roas.toFixed(2)}×`}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="small-note">{data.methodology.ads}</p>
            </section>
            <section className="panel padded mt-4">
              <h2>Reported advertising activity</h2>
              <p className="muted">
                {data.advertising.length} daily ad records imported. These
                platform clicks are separate from observed form visits.
              </p>
              <div className="table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Campaign / ad</th>
                      <th>Impressions</th>
                      <th>Clicks</th>
                      <th>Spend</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.advertising.slice(0, 100).map((r: any, i: number) => (
                      <tr key={i}>
                        <td>{r.date}</td>
                        <td>
                          {r.campaign}
                          <small className="d-block">{r.adId}</small>
                        </td>
                        <td>{r.impressions}</td>
                        <td>{r.clicks}</td>
                        <td>{formatMoney(r.spendMinor, r.currency)}</td>
                        <td>{r.evidence.replaceAll("_", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.advertising.length > 100 && (
                <p className="small-note">
                  Showing the first 100 records. Narrow the report period for
                  detail.
                </p>
              )}
            </section>
            <details className="panel padded mt-4">
              <summary>How to read this report</summary>
              {Object.entries(data.methodology).map(([key, text]) => (
                <p className="small-note mt-3" key={key}>
                  {String(text)}
                </p>
              ))}
            </details>
          </>
        )
      )}
    </>
  );
}
export function PaymentLinkForm({
  leadId,
  onCreated,
}: {
  leadId: string;
  onCreated: (url: string) => void;
}) {
  const forms = useLoad<{ items: any[] }>("/checkout/forms"),
    action = useAction(),
    key = useRef(crypto.randomUUID());
  return (
    <form
      className="d-flex align-items-end gap-2 mb-3 flex-wrap"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = values(e);
        const result = await action.run(
          `/leads/${leadId}/checkout-link`,
          { formId: v.formId },
          "POST",
          "Payment link created",
          key.current,
        );
        if (result) onCreated(result.url);
      }}
    >
      <Field label="Enrollment offer">
        <select name="formId" className="form-select" required>
          {forms.data?.items.map((f) => (
            <option key={f._id} value={f._id}>
              {f.course} · {formatMoney(f.amountMinor, f.currency)}
            </option>
          ))}
        </select>
      </Field>
      <button
        className="btn btn-outline-secondary mb-3"
        disabled={action.busy || !forms.data?.items.length}
      >
        Create payment link
      </button>
      {action.error && <ErrorBox message={action.error} />}
    </form>
  );
}
export function LeadConsent({
  leadId,
  consent,
}: {
  leadId: string;
  consent: any[];
}) {
  const action = useAction();
  return (
    <section className="panel padded mt-4">
      <h2>Consent evidence</h2>
      <p className="muted">
        Record consent only when you have evidence from the contact. Declining a
        call or requesting a stop suppresses outbound actions.
      </p>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = values(e);
          await action.run(`/consent/${leadId}`, {
            purpose: v.purpose,
            granted: v.granted === "true",
            evidence: v.evidence,
          });
        }}
      >
        <div className="col-md-4">
          <Field label="Purpose">
            <select name="purpose" className="form-select">
              <option value="marketing">Calls and messages</option>
              <option value="tracking">Journey measurement</option>
              <option value="ad_measurement">Ad conversion sharing</option>
              <option value="ai_analysis">AI conversation analysis</option>
            </select>
          </Field>
        </div>
        <div className="col-md-3">
          <Field label="Decision">
            <select name="granted" className="form-select">
              <option value="false">Withdrawn</option>
              <option value="true">Granted</option>
            </select>
          </Field>
        </div>
        <div className="col-md-5">
          <Field label="Evidence or request reference">
            <input
              name="evidence"
              className="form-control"
              required
              minLength={10}
              maxLength={300}
            />
          </Field>
        </div>
        <div>
          <button className="btn btn-outline-secondary" disabled={action.busy}>
            Record consent evidence
          </button>
        </div>
      </form>
      {action.error && <ErrorBox message={action.error} />}
      <div className="mt-3">
        {["marketing", "tracking", "ad_measurement", "ai_analysis"].map((p) => {
          const record = consent.find((c) => c.purpose === p);
          return (
            <span className="subtle-badge me-2 mb-2" key={p}>
              {p.replaceAll("_", " ")}:{" "}
              {record
                ? record.granted
                  ? "granted"
                  : "withdrawn"
                : "not recorded"}
            </span>
          );
        })}
      </div>
    </section>
  );
}
