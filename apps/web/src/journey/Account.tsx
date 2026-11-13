import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mutate } from "../api";
import { useLoad, useWorkspace } from "../workspace";
import { ErrorBox, Field, Loading, timeLabel } from "../components";
import { Heading, useAction, values } from "./Workspace";
import type { SessionView } from "../../../../packages/core/src/contracts.ts";
export function AccountSettings() {
  const { session, tenant, prefix, updateSession, refresh } = useWorkspace(),
    action = useAction();
  const usage = useLoad<any>("/account/usage"),
    members = useLoad<any>("/members"),
    invites = useLoad<any>("/account/invites");
  const [sessions, setSessions] = useState<any[]>([]),
    [mail, setMail] = useState<any>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api<{ items: any[] }>("/auth/sessions")
      .then((v) => setSessions(v.items))
      .catch((e) => setError(e.message));
  }, []);
  async function verify() {
    try {
      await mutate("/auth/verify-email/request", {});
      setMessage(
        "Verification link queued. Check your inbox, or the local email preview when running in development.",
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <>
      <Heading
        eyebrow="WORKSPACE ADMINISTRATION"
        title="Team & account"
        text="Manage account protection, seats, invitations, billing and privacy."
      />
      {action.error && <ErrorBox message={action.error} />}
      {error && <ErrorBox message={error} />}
      {message && <div className="success-box">{message}</div>}
      <div className="two-column">
        <section className="panel padded">
          <h2>Account protection</h2>
          <div className="journey-count-row">
            <span>{session.user.email}</span>
            <strong>
              {session.user.emailVerified ? "Verified" : "Unverified"}
            </strong>
          </div>
          <div className="journey-count-row">
            <span>Two-factor authentication</span>
            <strong>
              {session.user.mfaEnabled ? "Enabled" : "Not enabled"}
            </strong>
          </div>
          <div className="d-flex flex-wrap gap-2 mt-3">
            {!session.user.emailVerified && (
              <button className="btn btn-outline-secondary" onClick={verify}>
                Send verification link
              </button>
            )}
            <Link to="/settings" className="btn btn-outline-secondary">
              Security settings
            </Link>
            <button
              className="btn btn-outline-secondary"
              onClick={async () => {
                try {
                  updateSession(await api<SessionView>("/auth/session"));
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Refresh status
            </button>
          </div>
          <h3 className="mt-4">Signed-in sessions</h3>
          {sessions.map((s) => (
            <div className="journey-count-row" key={s.id}>
              <span>
                {s.current ? "This session" : "Other session"}
                <small className="d-block">
                  {timeLabel(s.authenticatedAt, tenant.timezone)}
                </small>
              </span>
              {!s.current && (
                <button
                  className="btn btn-sm btn-outline-secondary"
                  onClick={async () => {
                    try {
                      await mutate(`/auth/sessions/${s.id}`, {}, "DELETE");
                      setSessions((list) => list.filter((x) => x.id !== s.id));
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </section>
        <section className="panel padded">
          <h2>Plan and usage</h2>
          {usage.error && <ErrorBox message={usage.error} />}
          {usage.loading ? (
            <Loading />
          ) : (
            usage.data && (
              <>
                <span className="subtle-badge">
                  {usage.data.plan} · {usage.data.billingStatus}
                </span>
                <div className="journey-count-row">
                  <span>Active seats</span>
                  <strong>
                    {usage.data.seats} / {usage.data.limits.seats}
                  </strong>
                </div>
                {["leads", "commands"].map((metric) => (
                  <div className="journey-count-row" key={metric}>
                    <span>
                      {metric === "leads"
                        ? "Leads this month"
                        : "Actions prepared this month"}
                    </span>
                    <strong>
                      {usage.data.usage.find((u: any) => u.metric === metric)
                        ?.count ?? 0}{" "}
                      / {usage.data.limits[metric]}
                    </strong>
                  </div>
                ))}
                <p className="small-note mt-3">
                  These are installation quotas. Commercial pricing is
                  configured separately. Retention for transient tracking and
                  conversation content: {usage.data.retentionDays} days.
                </p>
              </>
            )
          )}
          {tenant.role === "owner" && <BillingControls />}
        </section>
      </div>
      <div className="two-column mt-4">
        <section className="panel padded">
          <h2>Invite a teammate</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await action.run(
                "/account/invites",
                values(e),
                "POST",
                "Invitation queued",
              );
              if (result)
                setMessage(
                  "Invitation prepared. The recipient must sign in with the invited email address.",
                );
            }}
          >
            <Field label="Work email">
              <input
                name="email"
                type="email"
                className="form-control"
                required
              />
            </Field>
            <Field label="Role">
              <select name="role" className="form-select">
                <option value="counselor">Counselor</option>
                <option value="analyst">Analyst</option>
                <option value="finance">Finance</option>
                <option value="viewer">Viewer</option>
                {tenant.role === "owner" && (
                  <option value="admin">Administrator</option>
                )}
              </select>
            </Field>
            <button className="btn btn-primary" disabled={action.busy}>
              Create invitation
            </button>
          </form>
          <h3 className="mt-4">Pending invitations</h3>
          {invites.data?.items.map((i: any) => (
            <div className="journey-count-row" key={i._id}>
              <span>
                {i.email}
                <small className="d-block">{i.role}</small>
              </span>
              <button
                className="btn btn-sm btn-outline-secondary"
                disabled={action.busy}
                onClick={() =>
                  action.run(`/account/invites/${i._id}`, {}, "DELETE")
                }
              >
                Revoke
              </button>
            </div>
          ))}
        </section>
        <section className="panel padded">
          <h2>Workspace members</h2>
          {members.error && <ErrorBox message={members.error} />}
          {members.data?.items.map((member: any) => (
            <Member key={member.id} member={member} />
          ))}
        </section>
      </div>
      <LocalMail mail={mail} setMail={setMail} /> <PrivacyTools />
    </>
  );
}
function Member({ member }: { member: any }) {
  const { tenant } = useWorkspace(),
    action = useAction();
  return (
    <form
      className="member-edit"
      onSubmit={(e) => {
        e.preventDefault();
        const v = values(e);
        void action.run(
          `/account/members/${member.id}`,
          { role: v.role, status: v.status },
          "PATCH",
          "Member access updated",
        );
      }}
    >
      <strong>{member.name}</strong>
      <small>{member.email}</small>
      <div className="d-flex flex-wrap gap-2 mt-2">
        <select
          name="role"
          className="form-select"
          defaultValue={member.role}
          aria-label={`Role for ${member.name}`}
        >
          {["owner", "admin", "counselor", "analyst", "finance", "viewer"]
            .filter(
              (r) =>
                tenant.role === "owner" ||
                !["owner", "admin"].includes(r) ||
                r === member.role,
            )
            .map((r) => (
              <option key={r}>{r}</option>
            ))}
        </select>
        <select
          name="status"
          className="form-select"
          aria-label={`Access for ${member.name}`}
        >
          <option value="active">Active</option>
          <option value="revoked">Revoke access</option>
        </select>
        <button
          className="btn btn-sm btn-outline-secondary"
          disabled={action.busy}
        >
          Save
        </button>
      </div>
      {action.error && <ErrorBox message={action.error} />}
    </form>
  );
}
function BillingControls() {
  const { data, error } = useLoad<any>("/billing"),
    action = useAction();
  const redirect = async (path: string, body: object) => {
    const result = await action.run(path, body, "POST", "");
    if (result?.url) {
      const url = new URL(result.url);
      if (
        ["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname) &&
        url.protocol === "https:"
      )
        window.location.assign(url.href);
    }
  };
  return (
    <div className="mt-4">
      <h3>Subscription</h3>
      {error && <ErrorBox message={error} />}
      {action.error && <ErrorBox message={action.error} />}
      {data?.configured ? (
        <div className="d-flex gap-2 flex-wrap">
          {data.availablePlans.map((plan: string) => (
            <button
              className="btn btn-outline-secondary"
              key={plan}
              disabled={action.busy}
              onClick={() => redirect("/billing/checkout", { plan })}
            >
              Review {plan} pricing
            </button>
          ))}
          <button
            className="btn btn-outline-secondary"
            disabled={action.busy}
            onClick={() => redirect("/billing/portal", {})}
          >
            Manage subscription
          </button>
        </div>
      ) : (
        <p className="small-note">
          Billing is not enabled. The operator must configure platform Stripe
          credentials and recurring price IDs before subscriptions can be
          purchased.
        </p>
      )}
    </div>
  );
}
function LocalMail({
  mail,
  setMail,
}: {
  mail: any;
  setMail: (value: any) => void;
}) {
  const { prefix } = useWorkspace();
  const [available, setAvailable] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api<any>("/public/config")
      .then((c) => setAvailable(c.localPreview === true))
      .catch(() => {});
  }, []);
  if (!available) return null;
  return (
    <section className="panel padded mt-4">
      <h2>Local email preview</h2>
      <p className="muted">
        Development only. Inspect your own queued verification and invitation
        links without sending email.
      </p>
      <button
        className="btn btn-outline-secondary"
        onClick={async () => {
          try {
            setMail(await api(`${prefix}/account/local-mail`));
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        Load queued emails
      </button>
      {error && <ErrorBox message={error} />}
      {mail?.items.map((m: any) => {
        const url = String(m.body).match(/https?:\/\/[^\s]+/)?.[0];
        return (
          <div className="note-card mt-3" key={m.id}>
            <strong>{m.subject}</strong>
            <p>
              {m.recipient} · {m.status}
            </p>
            {url && (
              <a href={url} target="_blank" rel="noreferrer">
                Open account link
              </a>
            )}
          </div>
        );
      })}
    </section>
  );
}
function PrivacyTools() {
  const { prefix } = useWorkspace(),
    action = useAction(),
    leads = useLoad<{ items: any[] }>("/leads?limit=100");
  const [leadId, setLeadId] = useState(""),
    [exported, setExported] = useState("");
  return (
    <details className="panel padded mt-4">
      <summary>Privacy requests</summary>
      <p className="small-note mt-3">
        Export a contact’s data, or erase their contact information and
        conversation content. Financial and audit evidence remains
        pseudonymized. External provider copies require a separate deletion
        request.
      </p>
      <Field label="Contact">
        <select
          className="form-select"
          value={leadId}
          onChange={(e) => setLeadId(e.target.value)}
        >
          <option value="">Choose a contact</option>
          {leads.data?.items.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name} · {l.course}
            </option>
          ))}
        </select>
      </Field>
      <button
        className="btn btn-outline-secondary"
        disabled={!leadId}
        onClick={async () => {
          try {
            const data = await api(`${prefix}/privacy/leads/${leadId}/export`);
            setExported(JSON.stringify(data, null, 2));
          } catch (e: any) {
            action.setError(e.message);
          }
        }}
      >
        Prepare data export
      </button>
      {exported && (
        <div className="mt-3">
          <textarea
            className="form-control"
            value={exported}
            readOnly
            rows={8}
            aria-label="Contact data export"
          />
          <button
            className="btn btn-sm btn-outline-secondary mt-2"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([exported], { type: "application/json" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "contact-data-export.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download JSON
          </button>
        </div>
      )}
      <form
        className="mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = values(e);
          if (v.confirmation !== "ERASE") {
            action.setError("Type ERASE to confirm this contact’s erasure.");
            return;
          }
          await action.run(
            `/privacy/leads/${leadId}/erase`,
            { password: v.password },
            "POST",
            "Contact information erased",
          );
          setExported("");
        }}
      >
        <Field label="Confirm current password">
          <input
            name="password"
            type="password"
            className="form-control"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="Type ERASE to confirm">
          <input
            name="confirmation"
            className="form-control"
            required
            pattern="ERASE"
          />
        </Field>
        <button
          className="btn btn-outline-danger"
          disabled={!leadId || action.busy}
        >
          Erase contact information
        </button>
      </form>
      {action.error && <ErrorBox message={action.error} />}
    </details>
  );
}
