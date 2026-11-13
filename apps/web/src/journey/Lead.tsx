import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Mail,
  Phone,
  RefreshCw,
  Target,
  Wallet,
} from "lucide-react";
import {
  can,
  stages,
  stageLabels,
  type LeadView,
} from "../../../../packages/core/src/contracts.ts";
import { useLoad, useWorkspace } from "../workspace";
import {
  Channel,
  ErrorBox,
  Field,
  Loading,
  Modal,
  StageBadge,
  formatMoney,
  timeLabel,
} from "../components";
import {
  Heading,
  LeadConsent,
  PaymentLinkForm,
  useAction,
  values,
} from "./Workspace";
import { journeyProgress } from "./progress";

type TimelineEvent = {
  id: string;
  type: string;
  title: string;
  detail: string;
  occurredAt: string;
};
type Journey = {
  lead: LeadView;
  tasks: {
    _id: string;
    status: string;
    title: string;
    dueAt: string;
    outcome?: string;
  }[];
  demos: {
    _id: string;
    status: string;
    scheduledAt: string;
    durationMinutes: number;
    version: number;
    outcome?: string;
    note?: string;
  }[];
  milestones: {
    _id: string;
    type: string;
    occurredAt: string;
    evidence: string;
  }[];
  sources: {
    _id: string;
    source: string;
    sourceDetail?: string;
    medium?: string;
    campaign?: string;
    accountId?: string;
    campaignId?: string;
    adId?: string;
    occurredAt: string;
    tagStatus?: string;
  }[];
  orders: {
    _id: string;
    status: string;
    amountMinor: string;
    currency: string;
    provider: string;
    mode: string;
  }[];
  enrollments: {
    _id: string;
    status: string;
    course: string;
    evidence: string;
  }[];
  calls: {
    _id: string;
    status: string;
    endedAt: string;
    durationSeconds?: number;
    summary?: string;
    transcript?: string;
  }[];
  consent: any[];
  suppressed: boolean;
};
type Tab = "activity" | "followup" | "demo" | "payment";

export function LeadWorkspace() {
  const { leadId } = useParams();
  return <LeadJourney key={leadId} leadId={leadId!} />;
}

function LeadJourney({ leadId }: { leadId: string }) {
  const { tenant, refresh } = useWorkspace();
  const { data, error, loading } = useLoad<Journey>(`/leads/${leadId}/journey`);
  const history = useLoad<{ lead: LeadView; events: TimelineEvent[] }>(
    `/leads/${leadId}`,
  );
  const write = can(tenant.role, "leads.write");
  const money = can(tenant.role, "revenue.read");
  const team = useLoad<{ items: { id: string; name: string }[] }>(
    write ? "/journey/team" : null,
  );
  const action = useAction();
  const [params, setParams] = useSearchParams();
  const [stageModal, setStageModal] = useState(false);
  const [resultDemo, setResultDemo] = useState<Journey["demos"][number] | null>(
    null,
  );
  const [checkout, setCheckout] = useState("");
  const operation = useRef(crypto.randomUUID());
  const delayedRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(delayedRefresh.current), []);
  const tabs: { id: Tab; label: string }[] = [
    { id: "activity", label: "Journey" },
    { id: "followup", label: "Follow-up" },
    { id: "demo", label: "Demo" },
    ...(money ? [{ id: "payment" as const, label: "Payment" }] : []),
  ];
  const tab = tabs.find((t) => t.id === params.get("tab"))?.id ?? "activity";
  function openTab(value: Tab) {
    action.setError("");
    setParams(value === "activity" ? {} : { tab: value });
  }
  function saved() {
    operation.current = crypto.randomUUID();
    clearTimeout(delayedRefresh.current);
    delayedRefresh.current = setTimeout(refresh, 1500);
  }
  async function contact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = values(event);
    if (
      await action.run(
        `/leads/${leadId}/outcomes`,
        {
          outcome: v.outcome,
          note: v.note,
          ...(v.nextFollowupAt
            ? { nextFollowupAt: new Date(v.nextFollowupAt).toISOString() }
            : {}),
        },
        "POST",
        "Conversation saved",
        operation.current,
      )
    )
      saved();
  }
  if (error) return <ErrorBox message={error} retry={refresh} />;
  if (loading || !data) return <Loading />;
  const { lead } = data;
  const steps = journeyProgress({ ...data, canReadMoney: money });
  const openTasks = data.tasks
    .filter((t) => t.status === "open")
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const scheduled = data.demos
    .filter((d) => d.status === "scheduled")
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  const connected = data.milestones.some((m) => m.type === "connected");
  const attended = data.milestones.some((m) => m.type === "demo_attended");
  const confirmed = steps[4].state === "recorded";
  const review = steps[4].state === "review";
  let next = {
    title: "Start the conversation",
    text: "Record the first contact attempt and give this enquiry a next step.",
    tab: "followup" as Tab,
    button: "Record conversation",
  };
  if (connected)
    next = {
      title: "Arrange a course demo",
      text: "Choose a host and time, then record the student's response.",
      tab: "demo",
      button: "Schedule demo",
    };
  if (scheduled)
    next = {
      title: "Demo scheduled",
      text: timeLabel(scheduled.scheduledAt, tenant.timezone),
      tab: "demo",
      button: "View demo",
    };
  if (attended && !scheduled)
    next = {
      title: "Follow up after the demo",
      text: "Confirm the next step with the student and review their enrollment payment.",
      tab: money ? "payment" : "followup",
      button: money ? "Review payment" : "Record follow-up",
    };
  if (openTasks[0])
    next = {
      title: "Next follow-up",
      text: `${openTasks[0].title} · ${timeLabel(openTasks[0].dueAt, tenant.timezone)}`,
      tab: "followup",
      button: "Record conversation",
    };
  if (lead.stage === "enrolled" && !confirmed)
    next = {
      title: "Review enrollment evidence",
      text: "The lead is marked Enrolled. A confirmed enrollment record is still needed.",
      tab: money ? "payment" : "activity",
      button: money ? "Review payment" : "View history",
    };
  if (confirmed)
    next = {
      title: "Enrollment confirmed",
      text: "The enrollment is backed by a recorded payment. Review its evidence below.",
      tab: money ? "payment" : "activity",
      button: money ? "View enrollment" : "View history",
    };
  if (review)
    next = {
      title: "Enrollment needs review",
      text: "A refund has been recorded. Review the payment and enrollment before following up.",
      tab: money ? "payment" : "activity",
      button: money ? "Review refund" : "View history",
    };
  if (lead.stage === "lost" || data.suppressed)
    next = {
      title: data.suppressed ? "Outreach is paused" : "Lead closed",
      text: data.suppressed
        ? "A stop request or contact issue is recorded. Review the history before further outreach."
        : "The recorded history remains available. Reopen the status only when appropriate.",
      tab: "activity",
      button: "View history",
    };
  const nextEnabled =
    next.tab === "activity" || next.tab === "payment" || write;

  return (
    <>
      <Link className="back-link" to="/leads">
        <ArrowLeft size={15} /> All leads
      </Link>
      <Heading eyebrow="LEAD JOURNEY" title={lead.name} text={lead.course}>
        <StageBadge stage={lead.stage} />
        {write && (
          <button
            className="btn btn-outline-secondary"
            onClick={() => {
              action.setError("");
              setStageModal(true);
            }}
          >
            Update status <ChevronDown size={15} />
          </button>
        )}
      </Heading>
      <div className="lead-contact-line">
        <span>
          <Mail size={15} /> {lead.email || "Email unavailable"}
        </span>
        <span>
          <Phone size={15} /> {lead.phone || "Phone unavailable"}
        </span>
        <Channel name={lead.channel} />
      </div>
      <section
        className={`lead-next-action ${review || data.suppressed ? "needs-review" : ""}`}
        aria-label="Next action"
      >
        <span className="next-action-icon">
          <ArrowRight size={22} />
        </span>
        <div>
          <span className="eyebrow">
            {confirmed ? "CURRENT OUTCOME" : "NEXT STEP"}
          </span>
          <h2>{next.title}</h2>
          <p>{next.text}</p>
        </div>
        {nextEnabled && (
          <button className="btn btn-primary" onClick={() => openTab(next.tab)}>
            {next.button}
            <ArrowRight size={15} />
          </button>
        )}
      </section>
      <ol className="lead-progress" aria-label="Recorded lead journey">
        {steps.map((s, index) => (
          <li key={s.label} className={s.state}>
            <button
              onClick={() => openTab(s.tab)}
              aria-label={`${s.label}: ${s.detail}`}
            >
              <span className="lead-progress-marker">
                {s.state === "recorded" ? <Check size={16} /> : index + 1}
              </span>
              <strong>{s.label}</strong>
              <small>{s.detail}</small>
            </button>
          </li>
        ))}
      </ol>
      <p className="journey-reading-note">
        Only recorded steps are checked. A skipped step stays visible.
      </p>
      <div className="lead-tabs" role="tablist" aria-label="Lead workspace">
        {tabs.map((t, index) => (
          <button
            key={t.id}
            id={`lead-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`lead-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => openTab(t.id)}
            onKeyDown={(event) => {
              const delta =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (!delta && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              const n =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + delta + tabs.length) % tabs.length;
              openTab(tabs[n].id);
              document.getElementById(`lead-tab-${tabs[n].id}`)?.focus();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={`lead-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`lead-tab-${tab}`}
        className="lead-tab-content"
      >
        {action.error && !stageModal && !resultDemo && (
          <ErrorBox message={action.error} />
        )}
        {tab === "activity" && (
          <div className="lead-activity-layout">
            <section className="panel padded">
              <div className="panel-heading">
                <div>
                  <h2>Activity timeline</h2>
                  <p>Source, conversations and outcomes in one place.</p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Refresh activity"
                  onClick={refresh}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              {history.error ? (
                <ErrorBox message={history.error} retry={refresh} />
              ) : history.loading ? (
                <Loading />
              ) : !history.data?.events.length ? (
                <p className="muted">
                  No activity recorded yet. Your next update will appear here.
                </p>
              ) : (
                <ol className="timeline">
                  {history.data.events.map((event) => (
                    <li key={event.id}>
                      <span className="timeline-node">
                        <Check size={14} />
                      </span>
                      <div>
                        <time>
                          {timeLabel(event.occurredAt, tenant.timezone)}
                        </time>
                        <h3>
                          {event.type === "contact.outcome.v1" &&
                          event.title === "Contact: answered"
                            ? "Conversation connected"
                            : event.title}
                        </h3>
                        <p>
                          {event.type === "demo.scheduled.v1" &&
                          Number.isFinite(Date.parse(event.detail))
                            ? timeLabel(event.detail, tenant.timezone)
                            : event.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <details className="journey-disclosure">
                <summary>
                  Recorded milestones ({data.milestones.length})
                </summary>
                <div className="journey-evidence">
                  {data.milestones.map((m) => (
                    <div key={m._id}>
                      <Check size={15} />
                      <div>
                        <strong>{m.type.replaceAll("_", " ")}</strong>
                        <small>
                          {timeLabel(m.occurredAt, tenant.timezone)} ·{" "}
                          {m.evidence.replaceAll("_", " ")}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </section>
            <aside className="lead-context">
              <section className="panel padded">
                <div className="panel-heading">
                  <h2>Where this lead came from</h2>
                  <Target size={18} />
                </div>
                <Channel name={lead.channel} />
                <p className="mt-3 mb-1">
                  <strong>{lead.campaign || "No campaign recorded"}</strong>
                </p>
                <p className="small-note">
                  Received {timeLabel(lead.createdAt, tenant.timezone)}
                </p>
                {data.sources.length ? (
                  <details className="journey-disclosure">
                    <summary>Source history ({data.sources.length})</summary>
                    {data.sources.map((s) => (
                      <div className="source-history-entry" key={s._id}>
                        <strong>
                          {s.source} · {s.campaign || "No campaign"}
                        </strong>
                        <small>
                          {timeLabel(s.occurredAt, tenant.timezone)}
                        </small>
                        <p>
                          {s.tagStatus === "managed_link"
                            ? "Campaign link"
                            : s.tagStatus === "link_unavailable"
                              ? "Unavailable campaign link"
                              : "Browser source tags"}
                          {s.medium ? ` · ${s.medium}` : ""}
                        </p>
                        {(s.accountId || s.campaignId || s.adId) && (
                          <p className="small-note">
                            Account: {s.accountId || "—"}
                            <br />
                            Campaign: {s.campaignId || "—"}
                            <br />
                            Ad: {s.adId || "—"}
                          </p>
                        )}
                      </div>
                    ))}
                  </details>
                ) : (
                  <p className="small-note">
                    No consented browser history is linked to this lead.
                  </p>
                )}
              </section>
              <section className="panel padded">
                <h2>Next appointment or follow-up</h2>
                {openTasks[0] ? (
                  <p className="mt-3">
                    <Clock3 size={15} />{" "}
                    {timeLabel(openTasks[0].dueAt, tenant.timezone)}
                    <br />
                    {openTasks[0].title}
                  </p>
                ) : (
                  <p className="muted mt-3">No open follow-up.</p>
                )}
                {scheduled && (
                  <p>
                    <CalendarDays size={15} /> Demo ·{" "}
                    {timeLabel(scheduled.scheduledAt, tenant.timezone)}
                  </p>
                )}
                {write && (
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => openTab("followup")}
                  >
                    Manage follow-up
                  </button>
                )}
              </section>
              {lead.note && (
                <section className="panel padded">
                  <h2>Enquiry note</h2>
                  <p className="preserve-lines mt-3 mb-0">{lead.note}</p>
                </section>
              )}
            </aside>
          </div>
        )}
        {tab === "followup" && (
          <div className="two-column">
            <section className="panel padded">
              <h2>Record a conversation</h2>
              <p className="muted">
                Save what happened and when to follow up next.
              </p>
              {write ? (
                <form onSubmit={contact}>
                  <Field label="Outcome">
                    <select name="outcome" className="form-select">
                      <option value="answered">Connected</option>
                      <option value="no_answer">No answer</option>
                      <option value="unreachable">Unreachable</option>
                      <option value="wrong_number">
                        Wrong number — stop outreach
                      </option>
                      <option value="not_interested">
                        Not interested — stop outreach
                      </option>
                    </select>
                  </Field>
                  <Field label="Conversation note">
                    <textarea
                      name="note"
                      className="form-control"
                      rows={4}
                      minLength={3}
                      maxLength={1000}
                      required
                    />
                  </Field>
                  <Field label="Next follow-up (your browser time)">
                    <input
                      name="nextFollowupAt"
                      type="datetime-local"
                      className="form-control"
                    />
                  </Field>
                  <button className="btn btn-primary" disabled={action.busy}>
                    Save conversation
                  </button>
                </form>
              ) : (
                <p className="small-note">
                  Your role can view this journey. A counselor can record the
                  next conversation.
                </p>
              )}
            </section>
            <section className="panel padded">
              <h2>Follow-up history</h2>
              {data.tasks.length ? (
                data.tasks.map((t) => (
                  <div className="journey-count-row" key={t._id}>
                    <div>
                      <strong>{t.title}</strong>
                      <p>{timeLabel(t.dueAt, tenant.timezone)}</p>
                      {t.outcome && (
                        <small>{t.outcome.replaceAll("_", " ")}</small>
                      )}
                    </div>
                    <span
                      className={`subtle-badge ${t.status === "open" ? "text-amber" : ""}`}
                    >
                      {t.status === "open" ? "Due" : t.status}
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted mt-3">No follow-ups recorded.</p>
              )}
              {data.calls.length > 0 && (
                <details className="journey-disclosure">
                  <summary>Imported call history ({data.calls.length})</summary>
                  {data.calls.map((c) => (
                    <details className="note-card" key={c._id}>
                      <summary>
                        {c.status} · {timeLabel(c.endedAt, tenant.timezone)}
                      </summary>
                      <p>{c.durationSeconds ?? 0} seconds</p>
                      <p className="preserve-lines">
                        {c.summary || "No summary retained."}
                      </p>
                      <p className="preserve-lines small-note">
                        {c.transcript || ""}
                      </p>
                    </details>
                  ))}
                </details>
              )}
            </section>
          </div>
        )}
        {tab === "demo" && (
          <div className="two-column">
            <section className="panel padded">
              <h2>Schedule a demo</h2>
              <p className="muted">Choose a time with an available host.</p>
              {team.error && <ErrorBox message={team.error} retry={refresh} />}
              {write ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const v = values(e);
                    if (
                      await action.run(
                        `/leads/${leadId}/demos`,
                        {
                          hostId: v.hostId,
                          scheduledAt: new Date(v.scheduledAt).toISOString(),
                          durationMinutes: Number(v.durationMinutes),
                        },
                        "POST",
                        "Demo scheduled",
                      )
                    )
                      saved();
                  }}
                >
                  <Field label="Host">
                    <select name="hostId" className="form-select" required>
                      {team.data?.items.map((u) => (
                        <option value={u.id} key={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Start time (your browser time)">
                    <input
                      name="scheduledAt"
                      type="datetime-local"
                      className="form-control"
                      required
                    />
                  </Field>
                  <Field label="Duration">
                    <select name="durationMinutes" className="form-select">
                      <option value="30">30 minutes</option>
                      <option value="45">45 minutes</option>
                      <option value="60">60 minutes</option>
                    </select>
                  </Field>
                  <button
                    className="btn btn-primary"
                    disabled={action.busy || !team.data?.items.length}
                  >
                    Schedule demo
                  </button>
                </form>
              ) : (
                <p className="small-note">
                  A counselor can schedule and update demos.
                </p>
              )}
              <p className="small-note mt-3">
                Calendar invitations and meeting links are arranged separately.
              </p>
            </section>
            <section className="panel padded">
              <h2>Demos and attendance</h2>
              {data.demos.length ? (
                data.demos.map((d) => (
                  <div className="journey-count-row" key={d._id}>
                    <div>
                      <strong>
                        {timeLabel(d.scheduledAt, tenant.timezone)}
                      </strong>
                      <p>
                        {d.status.replaceAll("_", " ")} · {d.durationMinutes}{" "}
                        minutes
                        {d.outcome
                          ? ` · ${d.outcome.replaceAll("_", " ")}`
                          : ""}
                      </p>
                      {d.note && <p>{d.note}</p>}
                    </div>
                    {write && d.status === "scheduled" && (
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          action.setError("");
                          setResultDemo(d);
                        }}
                      >
                        Record outcome
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted mt-3">No demos scheduled yet.</p>
              )}
            </section>
          </div>
        )}
        {tab === "payment" && money && (
          <section className="panel padded">
            <div className="panel-heading">
              <div>
                <h2>Payment and enrollment</h2>
                <p>
                  Payment confirmation and enrollment are recorded together.
                </p>
              </div>
              <Wallet size={20} />
            </div>
            {can(tenant.role, "revenue.write") && (
              <PaymentLinkForm leadId={leadId!} onCreated={setCheckout} />
            )}
            {checkout && (
              <div className="success-box">
                <a href={checkout} target="_blank" rel="noreferrer">
                  Open payment link <ArrowRight size={16} />
                </a>
                <input
                  aria-label="Created payment link"
                  className="form-control"
                  readOnly
                  value={checkout}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}
            {data.orders.map((o) => (
              <div className="journey-count-row" key={o._id}>
                <div>
                  <strong>{formatMoney(o.amountMinor, o.currency)}</strong>
                  <p>
                    {o.provider} · {o.mode} · {o.status}
                  </p>
                </div>
                {can(tenant.role, "revenue.write") &&
                  (o.mode === "sandbox" && o.status === "paid" ? (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={action.busy}
                      onClick={async () => {
                        if (
                          await action.run(`/orders/${o._id}/sandbox-refund`, {
                            cumulativeMinor: o.amountMinor,
                          })
                        )
                          saved();
                      }}
                    >
                      Simulate full refund
                    </button>
                  ) : o.mode !== "sandbox" ? (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={action.busy}
                      onClick={async () => {
                        if (await action.run(`/orders/${o._id}/reconcile`, {}))
                          saved();
                      }}
                    >
                      Reconcile status
                    </button>
                  ) : null)}
              </div>
            ))}
            {!data.orders.length && (
              <p className="muted">No payment recorded yet.</p>
            )}
            {data.enrollments.map((en) => (
              <div
                className={
                  en.status === "confirmed" ? "success-box" : "info-strip"
                }
                key={en._id}
              >
                {en.course} · {en.status.replaceAll("_", " ")} ·{" "}
                {en.evidence.replaceAll("_", " ")}
              </div>
            ))}
            {!data.enrollments.length && (
              <p className="small-note">
                A confirmed full payment creates enrollment evidence. Updating
                the lead's status alone does not.
              </p>
            )}
          </section>
        )}
      </div>
      {can(tenant.role, "connections.write") && (
        <details className="panel padded mt-4">
          <summary>Consent and contact preferences</summary>
          <LeadConsent leadId={leadId!} consent={data.consent} />
        </details>
      )}
      {stageModal && (
        <Modal title="Update lead status" close={() => setStageModal(false)}>
          {action.error && <ErrorBox message={action.error} />}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const v = values(e);
              if (
                await action.run(
                  `/leads/${leadId}/stage`,
                  { ...v, version: lead.version },
                  "PATCH",
                  "Lead status updated",
                  operation.current,
                )
              ) {
                setStageModal(false);
                saved();
              }
            }}
          >
            <Field label="New status">
              <select
                name="stage"
                className="form-select"
                defaultValue={stages.find((s) => s !== lead.stage)}
              >
                {stages
                  .filter((s) => s !== lead.stage)
                  .map((s) => (
                    <option value={s} key={s}>
                      {stageLabels[s]}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Reason for this change">
              <textarea
                name="note"
                className="form-control"
                minLength={3}
                maxLength={1000}
                rows={4}
                required
              />
            </Field>
            <button className="btn btn-primary" disabled={action.busy}>
              Save status
            </button>
          </form>
        </Modal>
      )}
      {resultDemo && (
        <Modal title="Record demo outcome" close={() => setResultDemo(null)}>
          {action.error && <ErrorBox message={action.error} />}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const v = values(e);
              if (
                await action.run(
                  `/demos/${resultDemo._id}`,
                  { ...v, version: resultDemo.version },
                  "PATCH",
                  "Demo outcome recorded",
                )
              ) {
                setResultDemo(null);
                saved();
              }
            }}
          >
            <p className="small-note">
              Attendance can be recorded after the scheduled start. Future demos
              can be cancelled.
            </p>
            <Field label="Attendance">
              <select className="form-select" name="status">
                <option value="attended">Attended</option>
                <option value="no_show">No show</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Next step">
              <select className="form-select" name="outcome">
                <option value="interested">Interested</option>
                <option value="follow_up">Follow up</option>
                <option value="not_interested">Not interested</option>
                <option value="not_applicable">Not applicable</option>
              </select>
            </Field>
            <Field label="Note">
              <textarea
                name="note"
                className="form-control"
                minLength={3}
                maxLength={1000}
                required
              />
            </Field>
            <button className="btn btn-primary" disabled={action.busy}>
              Save outcome
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
