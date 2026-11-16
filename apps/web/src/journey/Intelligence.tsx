import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Download, Plus, Target, Lightbulb } from "lucide-react";
import { can } from "../../../../packages/core/src/contracts.ts";
import {
  gapLabels,
  type Gap,
} from "../../../../packages/core/src/marketing-intelligence.ts";
import { useLoad, useWorkspace } from "../workspace";
import { api } from "../api";
import { Empty, ErrorBox, Field, Loading, Modal } from "../components";
import { useAction, values } from "./Workspace";

type Intelligence = {
  observations: {
    total: number;
    counts: Record<Gap, number>;
    basis: string;
    groups: {
      formId: string;
      formName: string;
      offering: string;
      source: string;
      campaign: string;
      attempts: number;
      counts: Record<Gap, number>;
    }[];
  };
  sales: {
    leads: number;
    overdueTasks: number;
    closedLost: number;
    milestones: { type: string; count: number }[];
  };
  forms: { id: string; name: string; offering: string; active: boolean }[];
  ideas: {
    id: string;
    title: string;
    evidence: string;
    action: string;
    href: string;
    metric: string;
  }[];
  ideaMethod: string;
  limits: string[];
  plans: {
    id: string;
    name: string;
    provider: string;
    formId: string;
    formName: string;
    segment: string;
    membershipDays: number;
    status: string;
    version: number;
    observedCandidates: number;
    previewDays: number;
    readiness: string;
  }[];
};
const milestoneLabels: Record<string, string> = {
  lead_accepted: "Enquiries",
  contact_attempted: "Contact attempted",
  connected: "Connected",
  qualified: "Qualified",
  demo_scheduled: "Appointment booked",
  demo_attended: "Appointment attended",
  payment_captured: "Payment recorded",
  enrollment_confirmed: "Outcome confirmed",
};
export function MarketingIntelligence({
  view,
  days,
}: {
  view: string;
  days: number;
}) {
  const { tenant, prefix, refresh } = useWorkspace();
  const { data, error, loading } = useLoad<Intelligence>(
    `/marketing/intelligence?days=${days}`,
  );
  const action = useAction(),
    operation = useRef(crypto.randomUUID());
  const [create, setCreate] = useState(false),
    [recipe, setRecipe] = useState<any>(null),
    [recipeError, setRecipeError] = useState("");
  const manage = can(tenant.role, "settings.write");
  if (error) return <ErrorBox message={error} retry={refresh} />;
  if (loading || !data) return <Loading />;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = values(event);
    if (
      await action.run(
        "/marketing/recovery-plans",
        { ...v, membershipDays: Number(v.membershipDays) },
        "POST",
        "Recovery plan saved — provider setup is still required",
        operation.current,
      )
    ) {
      operation.current = crypto.randomUUID();
      setCreate(false);
    }
  }
  async function openRecipe(id: string) {
    setRecipeError("");
    try {
      setRecipe(await api(`${prefix}/marketing/recovery-plans/${id}/recipe`));
    } catch (e) {
      setRecipeError((e as Error).message);
    }
  }
  const counts = data.observations.counts;
  return (
    <>
      {view === "overview" && (
        <>
          <section className="panel padded intelligence-intro">
            <div>
              <span className="eyebrow">FROM FIRST INTEREST TO OUTCOME</span>
              <h2>See the gap. Choose the next action.</h2>
              <p>
                Website observations and sales evidence stay separate, so you
                can see what happened and what is still unknown.
              </p>
            </div>
            <Link className="btn btn-outline-primary" to="/leads">
              Open a lead journey <ArrowRight size={16} />
            </Link>
          </section>
          <div className="intelligence-stats">
            {[
              [
                "Awaiting acceptance",
                counts.started + counts.submitted + counts.technical,
                "Observed activity at least 30 minutes old",
                "gaps",
              ],
              [
                "Observed problems",
                counts.technical,
                "Check capture before spending on recovery",
                "gaps",
              ],
              [
                "Overdue follow-ups",
                data.sales.overdueTasks,
                "Open tasks for this period's new leads",
                "ideas",
              ],
            ].map(([label, count, text, tab]) => (
              <Link
                key={String(label)}
                className="panel padded"
                to={`/marketing?view=${tab}`}
              >
                <span>{label}</span>
                <strong>{count}</strong>
                <small>{text}</small>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
          <section className="panel padded mt-3">
            <div className="panel-heading">
              <div>
                <h2>Recorded milestones</h2>
                <p>
                  Leads created in the last {days} days. Steps can be skipped;
                  these are not sequential conversion rates.
                </p>
              </div>
              <Link className="text-link" to="/flow">
                Revenue and outcome reports <ArrowRight size={15} />
              </Link>
            </div>
            <div className="intelligence-milestones">
              {data.sales.milestones.map((m) => (
                <div key={m.type}>
                  <strong>{m.count}</strong>
                  <span>{milestoneLabels[m.type]}</span>
                </div>
              ))}
            </div>
          </section>
          <div className="two-column mt-3">
            <section className="panel padded">
              <h2>Recovery audiences</h2>
              <p>
                Plan a course-specific audience and exclude accepted enquiries.
                Provider matching and ad delivery are verified separately.
              </p>
              <Link
                to="/marketing?view=recovery"
                className="btn btn-outline-primary"
              >
                Prepare retargeting <Target size={16} />
              </Link>
            </section>
            <section className="panel padded">
              <h2>Ideas backed by your observations</h2>
              <p>
                {data.ideas.length} review actions from capture gaps and
                follow-up evidence. Each explains the observation and how to
                measure a change.
              </p>
              <Link
                to="/marketing?view=ideas"
                className="btn btn-outline-primary"
              >
                Review ideas <Lightbulb size={16} />
              </Link>
            </section>
          </div>
        </>
      )}
      {view === "gaps" && (
        <>
          <section className="panel padded">
            <h2>Where observed activity stops</h2>
            <p>{data.observations.basis}</p>
            <div className="intelligence-milestones">
              {Object.entries(gapLabels).map(([key, label]) => (
                <div key={key}>
                  <strong>{counts[key as Gap]}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p className="small-note mt-3">
              An observed problem is a symptom. A missing next event is not a
              verified loss reason. Visitors who decline tracking are not in
              this table.
            </p>
          </section>
          <section className="panel padded mt-3">
            <h2>By form, source and campaign</h2>
            {!data.observations.groups.length ? (
              <Empty
                title="No observed form activity yet"
                text="Verify a form with measurement permission. No observations does not mean no visitors."
              />
            ) : (
              <div className="table-responsive">
                <table className="table marketing-table mt-3">
                  <thead>
                    <tr>
                      <th>Form / offering</th>
                      <th>Source / campaign</th>
                      <th>Accepted</th>
                      <th>Pending</th>
                      <th>Started / no acceptance</th>
                      <th>Submit / no acceptance</th>
                      <th>Problem</th>
                      <th>Viewed / no start</th>
                      <th>Unknown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.observations.groups.map((g, i) => (
                      <tr key={i}>
                        <td>
                          <strong>{g.formName}</strong>
                          <small>{g.offering}</small>
                        </td>
                        <td>
                          {g.source}
                          <small>{g.campaign || "No campaign recorded"}</small>
                        </td>
                        <td>{g.counts.accepted}</td>
                        <td>{g.counts.pending}</td>
                        <td>{g.counts.started}</td>
                        <td>{g.counts.submitted}</td>
                        <td>{g.counts.technical}</td>
                        <td>{g.counts.viewed}</td>
                        <td>{g.counts.unknown}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {view === "ideas" && (
        <>
          <section className="panel padded mb-3">
            <h2>Suggested actions</h2>
            <p>{data.ideaMethod}</p>
            <p className="small-note">
              Change one thing at a time and compare compatible cohorts. A
              change in attributed conversions alone does not prove advertising
              uplift.
            </p>
          </section>
          <div className="intelligence-ideas">
            {data.ideas.map((idea) => (
              <section className="panel padded" key={idea.id}>
                <h2>{idea.title}</h2>
                <p className="intelligence-evidence">{idea.evidence}</p>
                <p>{idea.action}</p>
                <small>Measure: {idea.metric}</small>
                <Link className="text-link mt-3" to={idea.href}>
                  Review evidence <ArrowRight size={15} />
                </Link>
              </section>
            ))}
          </div>
          {!data.ideas.length && (
            <Empty
              title="No rule-based action triggered"
              text="Keep recording outcomes. This does not establish that every stage is healthy."
            />
          )}
        </>
      )}
      {view === "recovery" && (
        <>
          <section className="panel padded intelligence-intro">
            <div>
              <h2>Prepare retargeting with evidence</h2>
              <p>
                Start with Google / YouTube. A saved plan contains audience
                rules, not a customer list. It does not activate a campaign.
              </p>
            </div>
            {manage && (
              <button
                className="btn btn-primary"
                onClick={() => setCreate(true)}
              >
                <Plus size={16} /> Create recovery plan
              </button>
            )}
          </section>
          {(action.error || recipeError) && (
            <ErrorBox message={action.error || recipeError} />
          )}
          {!data.plans.length ? (
            <section className="panel mt-3">
              <Empty
                title="No recovery plans yet"
                text="Choose an existing form, a visitor behavior and an audience duration. Then use the setup recipe in your advertising account."
              />
            </section>
          ) : (
            <div className="intelligence-ideas mt-3">
              {data.plans.map((p) => (
                <section className="panel padded" key={p.id}>
                  <span className="eyebrow">
                    {p.provider === "google_ads"
                      ? "GOOGLE / YOUTUBE"
                      : "META — CONNECTOR BACKLOG"}
                  </span>
                  <h2>{p.name}</h2>
                  <p>
                    {p.formName} · {p.membershipDays} day membership
                  </p>
                  <span className="subtle-badge">
                    {p.readiness.replaceAll("_", " ")}
                  </span>
                  <p className="mt-3">
                    <strong>{p.observedCandidates}</strong> mature observed
                    attempts match the behavior in the last {p.previewDays}{" "}
                    days. Actual provider audience size:{" "}
                    <strong>not verified</strong>.
                  </p>
                  <p className="small-note">
                    Exclude accepted enquiries. Review observed submission
                    errors before running recovery ads.
                  </p>
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      className="btn btn-outline-primary"
                      onClick={() => openRecipe(p.id)}
                    >
                      Setup recipe
                    </button>
                    {manage && (
                      <button
                        disabled={action.busy}
                        className="btn btn-outline-secondary"
                        onClick={() =>
                          action.run(
                            `/marketing/recovery-plans/${p.id}`,
                            {
                              version: p.version,
                              status:
                                p.status === "paused" ? "draft" : "paused",
                            },
                            "PATCH",
                            "Plan updated in RevenuePilot only",
                          )
                        }
                      >
                        {p.status === "paused" ? "Reopen draft" : "Pause plan"}
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
          <section className="panel padded mt-3">
            <h2>What this plan can do</h2>
            <ul className="mb-0">
              {data.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        </>
      )}
      {create && (
        <Modal title="Create recovery plan" close={() => setCreate(false)}>
          <form onSubmit={save}>
            {action.error && <ErrorBox message={action.error} />}
            <Field label="Plan name">
              <input
                className="form-control"
                name="name"
                required
                minLength={3}
                maxLength={100}
                placeholder="Java form starters — YouTube"
              />
            </Field>
            <Field label="Enquiry form">
              <select
                className="form-select"
                name="formId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a form
                </option>
                {data.forms
                  .filter((f) => f.active)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} · {f.offering}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Advertising provider">
              <select className="form-select" name="provider">
                <option value="google_ads">
                  Google / YouTube — manual setup recipe
                </option>
                <option value="meta">
                  Meta — planning only, connector backlog
                </option>
              </select>
            </Field>
            <Field label="Behavior to include">
              <select className="form-select" name="segment">
                <option value="started_not_accepted">
                  Started the form; enquiry not accepted
                </option>
                <option value="viewed_not_accepted">
                  Viewed the form; enquiry not accepted
                </option>
              </select>
            </Field>
            <Field label="Audience membership (days)">
              <input
                type="number"
                className="form-control"
                name="membershipDays"
                min={1}
                max={90}
                defaultValue={30}
                required
              />
            </Field>
            <p>
              Accepted enquiries are excluded. Advertising consent and provider
              eligibility are required. Saving will not launch ads.
            </p>
            <button className="btn btn-primary" disabled={action.busy}>
              Save draft plan
            </button>
          </form>
        </Modal>
      )}
      {recipe && (
        <Modal title="Audience setup recipe" close={() => setRecipe(null)}>
          <p>
            <strong>{recipe.readiness.replaceAll("_", " ")}</strong>
          </p>
          {recipe.include && (
            <p>
              Include <code>{recipe.include.event}</code> with{" "}
              <code>form_id = {recipe.include.form_id}</code>. Exclude{" "}
              <code>generate_lead</code> with the same form ID. Membership:{" "}
              {recipe.membershipDays} days.
            </p>
          )}
          <ol>
            {recipe.requirements.map((s: string) => (
              <li className="mb-2" key={s}>
                {s}
              </li>
            ))}
          </ol>
          <button
            className="btn btn-outline-primary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(recipe, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "revenuepilot-audience-recipe.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={16} /> Download recipe
          </button>
        </Modal>
      )}
    </>
  );
}
