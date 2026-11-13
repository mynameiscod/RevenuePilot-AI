import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { can, type Overview } from "../../../../packages/core/src/contracts.ts";
import { useLoad, useWorkspace } from "../workspace";
import {
  ErrorBox,
  Loading,
  Metric,
  formatMoney,
  timeLabel,
} from "../components";
import { setupNavigation } from "../navigation";
import { Heading } from "./Workspace";

export function Dashboard() {
  const { tenant, refresh } = useWorkspace();
  const [days, setDays] = useState(30);
  const summary = useLoad<Overview>(`/overview?days=${days}`);
  const work = useLoad<{
    tasks: {
      _id: string;
      leadId: string;
      leadName: string;
      title: string;
      dueAt: string;
    }[];
    demos: {
      _id: string;
      leadId: string;
      leadName: string;
      scheduledAt: string;
    }[];
  }>("/journey/work");
  const data = summary.data;
  return (
    <>
      <Heading
        eyebrow={tenant.name.toUpperCase()}
        title="Dashboard"
        text="Know what needs attention and where each lead stands."
      >
        <select
          className="form-select range-select"
          aria-label="Dashboard reporting period"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
        <Link className="btn btn-primary" to="/work">
          Open follow-ups <ArrowRight size={16} />
        </Link>
      </Heading>
      {summary.error ? (
        <ErrorBox message={summary.error} retry={refresh} />
      ) : summary.loading || !data ? (
        <Loading />
      ) : (
        <>
          {tenant.demo && (
            <div className="demo-notice">
              Sample workspace · All leads and payments are test data.
            </div>
          )}
          <div className="metrics-grid">
            <Metric
              label="Enquiries"
              value={data.leadCount}
              detail={`Created in the last ${days} days`}
              icon={<Users size={18} />}
            />
            <Metric
              label="First contact overdue"
              value={data.overdueCount}
              detail={`Beyond the ${tenant.firstResponseMinutes}-minute target`}
              icon={<Clock3 size={18} />}
            />
            <Metric
              label="Qualified leads"
              value={data.qualifiedCount}
              detail="Currently qualified, demo or enrolled"
              icon={<Target size={18} />}
            />
            <Metric
              label="Net collected"
              value={
                can(tenant.role, "revenue.read")
                  ? formatMoney(
                      data.cashByCurrency[tenant.currency]?.net ?? "0",
                      tenant.currency,
                    )
                  : "—"
              }
              detail={
                can(tenant.role, "revenue.read")
                  ? tenant.demo
                    ? "Sample receipts less refunds"
                    : "Manual + verified receipts, less refunds"
                  : "Finance access required"
              }
              icon={<Wallet size={18} />}
              accent
            />
          </div>
          <div className="dashboard-columns">
            <section className="panel padded">
              <div className="panel-heading">
                <div>
                  <h2>What needs attention</h2>
                  <p>Follow-ups across your workspace, ordered by due time.</p>
                </div>
                <Link to="/work" className="text-link">
                  View all <ArrowRight size={14} />
                </Link>
              </div>
              {work.error ? (
                <ErrorBox message={work.error} retry={refresh} />
              ) : work.loading ? (
                <Loading />
              ) : (
                <>
                  {work.data?.tasks.slice(0, 5).map((t) => (
                    <Link
                      className="journey-work-row"
                      to={`/leads/${t.leadId}?tab=followup`}
                      key={t._id}
                    >
                      <Clock3 size={18} />
                      <div>
                        <strong>{t.leadName}</strong>
                        <p>{t.title}</p>
                        <small>{timeLabel(t.dueAt, tenant.timezone)}</small>
                      </div>
                      <ArrowRight size={16} />
                    </Link>
                  ))}
                  {!work.data?.tasks.length && (
                    <div className="dashboard-empty">
                      <Clock3 size={25} />
                      <h3>No open follow-ups</h3>
                      <p>
                        Open an enquiry to record a conversation and set its
                        next step.
                      </p>
                      <Link
                        className="btn btn-outline-secondary"
                        to="/leads?stage=new"
                      >
                        Review new leads
                      </Link>
                    </div>
                  )}
                  {!!work.data?.demos.length && (
                    <div className="dashboard-demos">
                      <h3>Upcoming demos</h3>
                      {work.data.demos.slice(0, 3).map((d) => (
                        <Link
                          className="journey-work-row"
                          to={`/leads/${d.leadId}?tab=demo`}
                          key={d._id}
                        >
                          <CalendarDays size={18} />
                          <div>
                            <strong>{d.leadName}</strong>
                            <small>
                              {timeLabel(d.scheduledAt, tenant.timezone)}
                            </small>
                          </div>
                          <ArrowRight size={16} />
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
            <section className="panel padded">
              <div className="panel-heading">
                <div>
                  <h2>Your pipeline</h2>
                  <p>Current status of enquiries from this reporting period.</p>
                </div>
                <Link className="text-link" to="/leads">
                  All leads <ArrowRight size={14} />
                </Link>
              </div>
              <div className="pipeline-list">
                {data.stages.map((s) => (
                  <Link
                    to={`/leads?stage=${s.key}`}
                    className="pipeline-row"
                    key={s.key}
                  >
                    <div>
                      <span className={`pipeline-dot dot-${s.key}`} />
                      {s.label}
                      <strong>{s.count}</strong>
                    </div>
                    <div className="pipeline-track">
                      <i
                        className={`fill-${s.key}`}
                        style={{
                          width: `${data.leadCount ? (s.count / data.leadCount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
              <Link to="/flow" className="dashboard-report-link">
                See the full funnel and revenue <ArrowRight size={16} />
              </Link>
            </section>
          </div>
          <section
            className="workspace-guide"
            aria-label="How to use RevenuePilot"
          >
            {can(tenant.role, "marketing.read") && (
              <Link to="/marketing">
                <span>01</span>
                <div>
                  <strong>Bring in enquiries</strong>
                  <p>Create a campaign link and check its source.</p>
                </div>
                <ArrowRight size={16} />
              </Link>
            )}
            <Link to="/leads">
              <span>02</span>
              <div>
                <strong>Work each lead</strong>
                <p>One page for its history, demo and payment.</p>
              </div>
              <ArrowRight size={16} />
            </Link>
            <Link to="/flow">
              <span>03</span>
              <div>
                <strong>Review the results</strong>
                <p>Find gaps and see where revenue came from.</p>
              </div>
              <ArrowRight size={16} />
            </Link>
          </section>
        </>
      )}
    </>
  );
}

export function Setup() {
  const { tenant } = useWorkspace();
  return (
    <>
      <Heading
        eyebrow="WORKSPACE"
        title="Settings"
        text="Set up forms, team access and integrations in one place."
      />
      <div className="setup-grid">
        {setupNavigation
          .filter(
            (n) =>
              !("permission" in n) ||
              !n.permission ||
              can(tenant.role, n.permission),
          )
          .map((n) => (
            <Link to={n.path} className="panel setup-card" key={n.path}>
              <n.icon size={24} />
              <div>
                <h2>{n.label}</h2>
                <p>{n.text}</p>
              </div>
              <ArrowRight size={18} />
            </Link>
          ))}
      </div>
    </>
  );
}
