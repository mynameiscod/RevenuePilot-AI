import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  GraduationCap,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  Wallet,
} from "lucide-react";
import {
  Channel,
  ErrorBox,
  Loading,
  StageBadge,
  timeLabel,
} from "../components";
import { useWorkspace } from "../workspace";
import type { Journey, Tab, TimelineEvent } from "./Lead";
import type { JourneyStep } from "./progress";

type Common = { data: Journey; openTab: (tab: Tab) => void };
export function DetailCard({
  title,
  icon,
  children,
  action,
  className = "",
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ld-card ${className}`}>
      <div className="ld-card-heading">
        <h2>
          <span>{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
function Datum({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function LeadProfile({
  data,
  owner,
  write,
  addNote,
  updateStatus,
}: {
  data: Journey;
  owner: string;
  write: boolean;
  addNote: () => void;
  updateStatus: () => void;
}) {
  const { tenant } = useWorkspace();
  const { lead } = data;
  return (
    <section className="ld-profile" aria-label="Lead profile">
      <div className="ld-profile-top">
        <div className="ld-avatar" aria-hidden="true">
          {lead.name
            .split(/\s+/)
            .map((p) => p[0])
            .slice(0, 2)
            .join("")}
        </div>
        <div className="ld-identity">
          <div className="ld-name">
            <h1>{lead.name}</h1>
            <StageBadge stage={lead.stage} />
          </div>
          <div className="ld-contact">
            <span>
              <Phone size={14} />
              {lead.phone || "Phone unavailable"}
            </span>
            <span>
              <Mail size={14} />
              {lead.email || "Email unavailable"}
            </span>
            <span>
              <UserRound size={14} />
              {owner}
            </span>
          </div>
        </div>
        {write && (
          <div className="ld-profile-actions">
            <button className="btn btn-primary" onClick={addNote}>
              <Plus size={15} />
              Add note
            </button>
            <button
              className="btn btn-outline-secondary"
              onClick={updateStatus}
            >
              Update status
            </button>
          </div>
        )}
      </div>
      <dl className="ld-metadata">
        <Datum label="Source">
          <Channel name={lead.channel} />
        </Datum>
        <Datum label="Campaign">{lead.campaign || "Not recorded"}</Datum>
        <Datum label="Entry point">
          {lead.entryPoint === "website"
            ? "Website form"
            : lead.entryPoint === "hosted_form"
              ? "RevenuePilot form"
              : "Not recorded"}
        </Datum>
        <Datum label="Lead created">
          <CalendarDays size={14} />
          {timeLabel(lead.createdAt, tenant.timezone)}
        </Datum>
      </dl>
    </section>
  );
}
const stepIcons = [UserRound, Phone, CalendarDays, Wallet, GraduationCap];
export function LeadProgress({
  steps,
  openTab,
}: {
  steps: JourneyStep[];
  openTab: (tab: Tab) => void;
}) {
  return (
    <ol className="ld-progress" aria-label="Recorded lead journey">
      {steps.map((step, index) => {
        const Icon = stepIcons[index];
        return (
          <li key={step.label} className={`ld-step-${step.state}`}>
            <button
              onClick={() => openTab(index === 4 ? "payment" : step.tab)}
              aria-label={`${step.label}: ${step.detail}`}
            >
              <span className="ld-step-icon">
                {step.state === "recorded" ? (
                  <Check size={17} />
                ) : (
                  <Icon size={17} />
                )}
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              {index < steps.length - 1 && (
                <ChevronRight className="ld-step-arrow" size={15} />
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
export function LeadOverview({
  data,
  steps,
  owner,
  write,
  money,
  openTab,
  addNote,
  next,
  nextEnabled,
}: Common & {
  steps: JourneyStep[];
  owner: string;
  write: boolean;
  money: boolean;
  addNote: () => void;
  next: { title: string; text: string; tab: Tab; button: string };
  nextEnabled: boolean;
}) {
  const { tenant } = useWorkspace();
  const { lead } = data;
  const visibleSteps = steps.filter((s) => money || s.label !== "Payment");
  const recorded = visibleSteps.filter((s) => s.state === "recorded").length;
  const pending = visibleSteps.filter((s) => s.state !== "recorded");
  const latestSource = data.sources.at(-1);
  return (
    <div className="ld-overview">
      <div className="ld-column">
        <DetailCard title="Lead information" icon={<UserRound size={16} />}>
          <dl className="ld-facts">
            <Datum label="Name">{lead.name}</Datum>
            <Datum label="Interested in">
              <span className="ld-course-tag">{lead.course}</span>
            </Datum>
            <Datum label="Phone">
              <Phone size={13} />
              {lead.phone || "Unavailable for this record or role"}
            </Datum>
            <Datum label="Assigned to">
              <UserRound size={13} />
              {owner}
            </Datum>
            <Datum label="Email">
              <Mail size={13} />
              {lead.email || "Unavailable for this record or role"}
            </Datum>
            <Datum label="Source">
              <Channel name={lead.channel} />
            </Datum>
            <Datum label="Last contact">
              {lead.lastContactAt
                ? timeLabel(lead.lastContactAt, tenant.timezone)
                : "No contact recorded"}
            </Datum>
            <Datum label="Last updated">
              {timeLabel(lead.updatedAt, tenant.timezone)}
            </Datum>
          </dl>
        </DetailCard>
        <DetailCard
          title="Interest & acquisition"
          icon={<GraduationCap size={16} />}
        >
          <dl className="ld-facts">
            <Datum label="Course / offering">{lead.course}</Datum>
            <Datum label="Latest recorded campaign">
              {latestSource?.campaign || lead.campaign || "Not recorded"}
            </Datum>
            <Datum label="Latest campaign ID">
              {latestSource?.campaignId || "Not recorded"}
            </Datum>
            <Datum label="Latest ad ID">
              {latestSource?.adId || "Not recorded"}
            </Datum>
          </dl>
          <div className="ld-enquiry-note">
            <span>Original enquiry</span>
            <p>{lead.note || "No enquiry message was provided."}</p>
          </div>
          <button
            className="ld-text-button"
            onClick={() => openTab("activity")}
          >
            View source history <ArrowRight size={14} />
          </button>
        </DetailCard>
      </div>
      <div className="ld-column">
        <DetailCard title="Lead insights" icon={<Sparkles size={16} />}>
          <div className="ld-insights">
            <div className="ld-coverage">
              <div
                className="ld-ring"
                role="img"
                aria-label={`${recorded} of ${visibleSteps.length} journey steps recorded`}
              >
                <svg viewBox="0 0 110 110" aria-hidden="true">
                  <circle cx="55" cy="55" r="46" />
                  <circle
                    cx="55"
                    cy="55"
                    r="46"
                    pathLength="100"
                    strokeDasharray={`${(recorded / visibleSteps.length) * 100} 100`}
                  />
                </svg>
                <div>
                  <strong>
                    {recorded}
                    <small>/{visibleSteps.length}</small>
                  </strong>
                  <span>Steps recorded</span>
                </div>
              </div>
              <span className="ld-coverage-label">Journey coverage</span>
            </div>
            <ul className="ld-insight-list">
              <li>
                <Target size={16} />
                <span>
                  {lead.campaign
                    ? "Campaign recorded"
                    : "Campaign not recorded"}
                  <small>{lead.channel}</small>
                </span>
              </li>
              <li>
                <Phone size={16} />
                <span>
                  {steps[1].detail}
                  <small>Conversation evidence</small>
                </span>
              </li>
              <li>
                <ShieldCheck size={16} />
                <span>
                  {data.suppressed
                    ? "Outreach paused"
                    : "No stop request recorded"}
                  <small>
                    {data.suppressed
                      ? "Review contact preferences"
                      : "Check consent before outreach"}
                  </small>
                </span>
              </li>
            </ul>
          </div>
          <div className="ld-insight-foot">
            <span className="ld-status-dot" />
            {pending.length
              ? `${pending.length} step${pending.length === 1 ? "" : "s"} need evidence or review`
              : "All displayed steps have evidence"}
            <span>AI scoring not configured</span>
          </div>
        </DetailCard>
        <DetailCard title="Quick actions" icon={<CalendarDays size={16} />}>
          <div className="ld-quick-actions">
            {write && (
              <>
                <button
                  className="btn btn-primary"
                  onClick={() => openTab("followup")}
                >
                  <Phone size={15} />
                  Log conversation
                </button>
                <button className="btn btn-outline-secondary" onClick={addNote}>
                  <FileText size={15} />
                  Add note
                </button>
                <button
                  className="btn btn-outline-secondary"
                  onClick={() => openTab("demo")}
                >
                  <CalendarDays size={15} />
                  Schedule demo
                </button>
              </>
            )}
            <button
              className="btn btn-outline-secondary"
              onClick={() => openTab("payment")}
            >
              <Wallet size={15} />
              {money ? "Payments & enrollment" : "View enrollment"}
            </button>
            <button
              className="ld-wide-action"
              onClick={() => openTab("followup")}
            >
              <Clock3 size={15} />
              {write ? "Manage follow-ups" : "View follow-ups"}
            </button>
          </div>
        </DetailCard>
        <section
          className={`ld-next ${data.suppressed || steps[4].state === "review" ? "ld-next-review" : ""}`}
          aria-label="Next action"
        >
          <span className="ld-next-icon">
            <ArrowRight size={18} />
          </span>
          <div>
            <span className="ld-overline">NEXT BEST STEP</span>
            <h2>{next.title}</h2>
            <p>{next.text}</p>
            {nextEnabled && (
              <button
                className="ld-text-button"
                onClick={() => openTab(next.tab)}
              >
                {next.button}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const milestoneLabels: Record<string, string> = {
  lead_created: "Lead created",
  contact_attempted: "Contact attempted",
  connected: "Conversation connected",
  qualified: "Qualified",
  demo_scheduled: "Demo scheduled",
  demo_attended: "Demo attended",
  payment_captured: "Payment recorded",
  payment_refunded: "Refund recorded",
  enrollment_confirmed: "Enrollment confirmed",
  lost: "Closed lost",
};
export function LeadSidebar({
  data,
  events,
  loading,
  error,
  money,
  openTab,
}: Common & {
  events: TimelineEvent[];
  loading: boolean;
  error?: string;
  money: boolean;
}) {
  const { tenant, refresh } = useWorkspace();
  const journey = [
    {
      id: "created",
      title: "Lead created",
      at: data.lead.createdAt,
      source: false,
    },
    ...data.milestones
      .filter(
        (m) =>
          m.type !== "lead_created" &&
          (money || !m.type.startsWith("payment_")),
      )
      .map((m) => ({
        id: m._id,
        title: milestoneLabels[m.type] || m.type.replaceAll("_", " "),
        at: m.occurredAt,
        source: false,
      })),
    ...data.sources.map((s) => ({
      id: `source-${s._id}`,
      title: `${s.source} touchpoint`,
      at: s.occurredAt,
      source: true,
    })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 5);
  return (
    <aside className="ld-rail" aria-label="Lead journey and recent activity">
      <DetailCard title="Lead journey" icon={<FileText size={16} />}>
        <ol className="ld-journey-list">
          {journey.map((event) => (
            <li key={event.id}>
              <span
                className={`ld-event-icon ${event.source ? "ld-event-purple" : "ld-event-green"}`}
              >
                {event.source ? <Target size={15} /> : <Check size={15} />}
              </span>
              <div>
                <strong>{event.title}</strong>
                <time>{timeLabel(event.at, tenant.timezone)}</time>
              </div>
            </li>
          ))}
        </ol>
        <button className="ld-text-button" onClick={() => openTab("activity")}>
          View full journey <ArrowRight size={14} />
        </button>
        <p className="ld-rail-note">Only linked, recorded events appear.</p>
      </DetailCard>
      <DetailCard title="Recent activity" icon={<Clock3 size={16} />}>
        {error ? (
          <ErrorBox message={error} retry={refresh} />
        ) : loading ? (
          <Loading />
        ) : events.length ? (
          <ol className="ld-recent-list">
            {events.slice(0, 4).map((event) => (
              <li key={event.id}>
                <button
                  onClick={() =>
                    openTab(
                      event.type === "lead.note_added.v1"
                        ? "notes"
                        : "activity",
                    )
                  }
                >
                  <span className="ld-event-icon ld-event-blue">
                    {event.type.includes("note") ? (
                      <FileText size={15} />
                    ) : (
                      <MessageSquare size={15} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {event.type === "contact.outcome.v1" &&
                      event.title === "Contact: answered"
                        ? "Conversation connected"
                        : event.title}
                    </strong>
                    <time>{timeLabel(event.occurredAt, tenant.timezone)}</time>
                  </span>
                  <ChevronRight size={14} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="ld-empty">No activity recorded yet.</p>
        )}
      </DetailCard>
      <div className="ld-timezone">
        <Clock3 size={13} />
        Times shown in {tenant.timezone}
      </div>
    </aside>
  );
}
export function LeadNotes({
  data,
  events,
  loading,
  error,
  pendingNote,
  write,
  addNote,
}: {
  data: Journey;
  events: TimelineEvent[];
  loading: boolean;
  error?: string;
  pendingNote: string;
  write: boolean;
  addNote: () => void;
}) {
  const { tenant, refresh } = useWorkspace();
  const notes = events.filter((e) => e.type === "lead.note_added.v1");
  return (
    <DetailCard
      title="Notes"
      icon={<FileText size={16} />}
      action={
        write && (
          <button className="btn btn-primary" onClick={addNote}>
            <Plus size={14} />
            Add note
          </button>
        )
      }
    >
      <p className="ld-description">
        Context for your team. Adding a note does not record a contact attempt
        or change the lead’s status.
      </p>
      {pendingNote && !notes.some((note) => note.detail === pendingNote) && (
        <p className="info-strip" role="status">
          Note saved. The activity timeline is updating; use Refresh data if it
          has not appeared yet.
        </p>
      )}
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : loading ? (
        <Loading />
      ) : notes.length ? (
        <div className="ld-notes">
          {notes.map((note) => (
            <article key={note.id}>
              <time>{timeLabel(note.occurredAt, tenant.timezone)}</time>
              <p>
                {note.detail || "Note content is restricted for your role."}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="ld-empty-block">
          <FileText size={26} />
          <h3>No team notes yet</h3>
          <p>Add useful context before the next conversation.</p>
        </div>
      )}
      {data.lead.note && (
        <div className="ld-enquiry-note">
          <span>
            Original enquiry · {timeLabel(data.lead.createdAt, tenant.timezone)}
          </span>
          <p>{data.lead.note}</p>
        </div>
      )}
      <p className="ld-rail-note">
        Notes from the latest 100 lead activities. Conversation and status notes
        appear in Activity.
      </p>
    </DetailCard>
  );
}
