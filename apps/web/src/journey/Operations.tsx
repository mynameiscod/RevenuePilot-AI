import { useState, useRef, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLoad, useWorkspace } from "../workspace";
import { ErrorBox, Field, Loading, Modal, timeLabel } from "../components";
import { api } from "../api";
import { providers } from "../../../../packages/connectors/src/index.ts";
import { Heading, useAction, values } from "./Workspace";
const settingsFields: Record<string, [string, string, string, string?][]> = {
  meta: [
    [
      "apiVersion",
      "Graph API version",
      "text",
      "Confirm the supported version in your Meta app",
    ],
    ["adAccountId", "Ad account ID", "text", "act_123…"],
    ["pixelId", "Dataset / pixel ID", "optional"],
    ["testEventCode", "Test Events code", "optional"],
    ["leadFormId", "Native lead form ID", "optional"],
    ["importFormId", "Intake form for imported leads", "form"],
  ],
  google_ads: [
    ["apiVersion", "Google Ads API version", "text"],
    ["customerId", "Customer ID", "text", "10 digits, without hyphens"],
    ["loginCustomerId", "Manager customer ID", "optional"],
    ["conversionActionId", "Data Manager conversion action ID", "optional"],
  ],
  hubspot: [
    ["importFormId", "Intake form for imported contacts", "form-required"],
  ],
  generic_crm: [
    ["importFormId", "Intake form for imported contacts", "form-required"],
  ],
  outpero: [
    [
      "leadIntakeUrl",
      "Lead intake URL",
      "url",
      "Copy the HTTPS URL from your Outpero dashboard",
    ],
  ],
  stripe: [],
  razorpay: [],
  openai: [
    ["model", "Model ID", "text"],
    ["maxOutputTokens", "Maximum output tokens", "number"],
  ],
  anthropic: [
    ["model", "Model ID", "text"],
    ["maxOutputTokens", "Maximum output tokens", "number"],
  ],
  whatsapp: [
    ["apiVersion", "Graph API version", "text"],
    ["phoneNumberId", "Phone number ID", "text"],
    ["wabaId", "WhatsApp Business Account ID", "text"],
    ["templateName", "Approved template name", "text"],
    ["languageCode", "Template language", "text", "en or en_US"],
    [
      "templateBody",
      "Exact approved template body",
      "textarea",
      "Static templates only; no variables",
    ],
  ],
  ses: [
    ["region", "AWS region", "text", "ap-south-1"],
    ["fromEmail", "Verified sender email", "email"],
    ["snsTopicArn", "SNS feedback topic ARN", "optional"],
    ["subject", "Message subject", "text"],
    ["body", "Message text", "textarea"],
  ],
};
export function Operations() {
  const { prefix, tenant, refresh } = useWorkspace(),
    action = useAction(),
    { data, error, loading } = useLoad<any>("/integrations");
  const [edit, setEdit] = useState<any>(null),
    [activate, setActivate] = useState<any>(null),
    [sync, setSync] = useState<any>(null),
    [commandOpen, setCommandOpen] = useState(false),
    [preview, setPreview] = useState<any>(null);
  return (
    <>
      <Heading
        eyebrow="INTEGRATION OPERATIONS"
        title="Integrations"
        text="Check access, activate a connection, then review outbound actions."
      >
        <Link to="/connections" className="btn btn-outline-secondary">
          Add a connection
        </Link>
        <button
          className="btn btn-primary"
          onClick={() => setCommandOpen(true)}
        >
          Prepare action
        </button>
      </Heading>
      {!data?.liveExecution && (
        <div className="info-strip">
          Live execution is disabled for this installation. Test calls, messages
          and AI actions are local simulations. Payment tests and ad validation
          use provider test paths.
        </div>
      )}
      {error && <ErrorBox message={error} retry={refresh} />}
      {action.error && <ErrorBox message={action.error} />}
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <section className="panel padded">
              <h2>Connection health</h2>
              {data.connections.map((c: any) => (
                <div className="integration-row" key={c.id}>
                  <span
                    className="provider-mark small"
                    style={{
                      background: providers.find((p) => p.id === c.provider)
                        ?.color,
                    }}
                  >
                    {providers.find((p) => p.id === c.provider)?.monogram}
                  </span>
                  <div className="integration-label">
                    <strong>{c.label}</strong>
                    <small>
                      {c.provider} · {c.mode} · {c.status}
                    </small>
                    <small>
                      {c.health?.status?.replaceAll("_", " ") ?? "Not checked"}
                    </small>
                  </div>
                  <div className="d-flex gap-2 flex-wrap">
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setEdit(c)}
                    >
                      Configure
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={action.busy}
                      onClick={() =>
                        action.run(
                          `/integrations/${c.id}/check`,
                          {},
                          "POST",
                          "Connection check completed",
                        )
                      }
                    >
                      Check access
                    </button>
                    {["test", "active"].includes(c.status) ? (
                      <>
                        <button
                          className="btn btn-sm btn-outline-secondary"
                          disabled={action.busy}
                          onClick={() =>
                            action.run(`/integrations/${c.id}/pause`, {})
                          }
                        >
                          Pause
                        </button>
                        {["meta", "google_ads", "hubspot"].includes(
                          c.provider,
                        ) && (
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => setSync(c)}
                          >
                            Sync data
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setActivate(c)}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!data.connections.length && (
                <p className="muted">
                  Create a provider draft in Connections, then configure its
                  account here.
                </p>
              )}
            </section>
            <section className="panel padded mt-4">
              <h2>Actions and approvals</h2>
              <p className="muted">
                Consent, suppression, quiet hours and action limits are checked
                before execution.
              </p>
              <div className="table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Connection</th>
                      <th>Status</th>
                      <th>Result</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.commands.map((c: any) => (
                      <tr key={c._id}>
                        <td>
                          <strong>{c.kind}</strong>
                          <small className="d-block">
                            {timeLabel(c.createdAt, tenant.timezone)}
                          </small>
                          <Link to={`/leads/${c.leadId}/workflow`}>
                            Open lead
                          </Link>
                        </td>
                        <td>
                          {data.connections.find(
                            (x: any) => x.id === c.connectionId,
                          )?.label ?? "Removed connection"}
                        </td>
                        <td>
                          <span className="subtle-badge">
                            {c.status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>
                          {c.result?.delivery ??
                            c.result?.disposition?.replaceAll("_", " ") ??
                            c.errorCode ??
                            "Awaiting action"}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={async () => {
                              try {
                                setPreview(
                                  await api(
                                    `${prefix}/commands/${c._id}/preview`,
                                  ),
                                );
                              } catch (e: any) {
                                action.setError(e.message);
                              }
                            }}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.commands.length && (
                <p className="muted">
                  No actions yet. Consented conversion milestones are prepared
                  automatically for approval.
                </p>
              )}
            </section>
            <div className="two-column mt-4">
              <section className="panel padded">
                <h2>Sync history</h2>
                {data.syncs.map((s: any) => (
                  <div className="journey-count-row" key={s._id}>
                    <span>
                      {s.kind} · {s.status}
                      <small className="d-block">
                        {s.imported ?? 0} imported · {s.rejected ?? 0} rejected
                      </small>
                    </span>
                    <span>{s.errorCode ?? ""}</span>
                  </div>
                ))}
                {!data.syncs.length && (
                  <p className="muted">No sync runs recorded.</p>
                )}
              </section>
              <section className="panel padded">
                <h2>Inbound delivery</h2>
                {data.webhooks.map((w: any) => (
                  <div className="journey-count-row" key={w._id}>
                    <span>
                      {w.status}
                      <small className="d-block">
                        {w.errorCode ??
                          `${w.attempts ?? 0} processing attempts`}
                      </small>
                    </span>
                    {w.status === "failed" && (
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        disabled={action.busy}
                        onClick={() =>
                          action.run(
                            `/integrations/webhooks/${w._id}/retry`,
                            {},
                          )
                        }
                      >
                        Retry projection
                      </button>
                    )}
                  </div>
                ))}
                {!data.webhooks.length && (
                  <p className="muted">No signed webhooks received.</p>
                )}
              </section>
            </div>
          </>
        )
      )}
      {edit && <Configure connection={edit} onClose={() => setEdit(null)} />}
      {activate && (
        <Modal
          title={`Activate ${activate.label}`}
          close={() => setActivate(null)}
        >
          <p>
            {activate.mode === "live"
              ? "This enables live requests. Calls, messages, AI and ad feedback still require action approval. Payment links can create live checkouts."
              : "This enables test workflows. Calls, messages and AI are simulated locally; test payments and ad validation use the provider’s test mode."}
          </p>
          {action.error && <ErrorBox message={action.error} />}
          <button
            className="btn btn-primary"
            disabled={action.busy}
            onClick={async () => {
              if (
                await action.run(`/integrations/${activate.id}/activate`, {
                  confirmed: true,
                })
              )
                setActivate(null);
            }}
          >
            Confirm activation
          </button>
        </Modal>
      )}
      {sync && <Sync connection={sync} onClose={() => setSync(null)} />}
      {commandOpen && (
        <PrepareCommand
          connections={data?.connections ?? []}
          onClose={() => setCommandOpen(false)}
        />
      )}
      {preview && (
        <Modal
          title={`Review ${preview.command.kind}`}
          close={() => setPreview(null)}
        >
          <p>{preview.caution}</p>
          <p>
            Status:{" "}
            <strong>{preview.command.status.replaceAll("_", " ")}</strong>
          </p>
          {preview.payload.preview && (
            <div className="note-card">
              <strong>Message content</strong>
              <p className="preserve-lines">{preview.payload.preview}</p>
            </div>
          )}
          {preview.payload.text && (
            <div className="note-card">
              <strong>Conversation evidence</strong>
              <p className="preserve-lines">{preview.payload.text}</p>
            </div>
          )}
          {preview.command.result?.analysis && (
            <div className="note-card">
              <strong>AI analysis — review required</strong>
              <p>{preview.command.result.analysis.summary}</p>
              <p>{preview.command.result.analysis.suggestedNextStep}</p>
            </div>
          )}
          {action.error && <ErrorBox message={action.error} />}
          <div className="d-flex gap-2">
            {preview.command.status === "pending_approval" && (
              <button
                className="btn btn-primary"
                disabled={action.busy}
                onClick={async () => {
                  if (
                    await action.run(
                      `/commands/${preview.command._id}/approve`,
                      { confirmed: true },
                      "POST",
                      "Action approved",
                    )
                  )
                    setPreview(null);
                }}
              >
                Approve action
              </button>
            )}
            {["pending_approval", "queued"].includes(
              preview.command.status,
            ) && (
              <button
                className="btn btn-outline-secondary"
                disabled={action.busy}
                onClick={async () => {
                  if (
                    await action.run(
                      `/commands/${preview.command._id}/cancel`,
                      {},
                    )
                  )
                    setPreview(null);
                }}
              >
                Cancel action
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function Configure({
  connection,
  onClose,
}: {
  connection: any;
  onClose: () => void;
}) {
  const action = useAction(),
    forms = useLoad<{ items: any[] }>("/forms"),
    provider = providers.find((p) => p.id === connection.provider)!;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = values(e),
      settings: Record<string, unknown> = {
        dailyActionLimit: Number(v.dailyActionLimit),
      },
      credentials: Record<string, string> = {};
    for (const [key, , type] of settingsFields[connection.provider])
      if (v[key]) settings[key] = type === "number" ? Number(v[key]) : v[key];
    for (const field of provider.credentialFields)
      if (v[`credential_${field.key}`])
        credentials[field.key] = v[`credential_${field.key}`];
    if (
      await action.run(
        `/integrations/${connection.id}/configure`,
        { version: connection.version, mode: v.mode, settings, credentials },
        "PUT",
        "Configuration saved as draft",
      )
    )
      onClose();
  }
  return (
    <Modal title={`Configure ${connection.label}`} close={onClose}>
      <form onSubmit={save}>
        {action.error && <ErrorBox message={action.error} />}
        <Field label="Environment">
          <select
            name="mode"
            className="form-select"
            defaultValue={connection.mode}
          >
            <option value="test">Test / local simulation</option>
            <option value="live">Live — explicit activation required</option>
          </select>
        </Field>
        {settingsFields[connection.provider].map(([key, label, type, hint]) => (
          <Field label={label} hint={hint} key={key}>
            {type.startsWith("form") ? (
              <select
                name={key}
                className="form-select"
                defaultValue={connection.config[key] ?? ""}
                required={type === "form-required"}
              >
                <option value="">Select intake form</option>
                {forms.data?.items.map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name} · {f.course}
                  </option>
                ))}
              </select>
            ) : type === "textarea" ? (
              <textarea
                name={key}
                className="form-control"
                rows={3}
                defaultValue={connection.config[key] ?? ""}
                required
              />
            ) : (
              <input
                name={key}
                className="form-control"
                type={type === "optional" ? "text" : type}
                required={type !== "optional"}
                defaultValue={
                  connection.config[key] ??
                  (key === "maxOutputTokens"
                    ? 800
                    : key === "apiVersion" &&
                        connection.provider === "google_ads"
                      ? "v26"
                      : "")
                }
              />
            )}
          </Field>
        ))}
        <Field label="Maximum actions per UTC day">
          <input
            name="dailyActionLimit"
            className="form-control"
            type="number"
            min={1}
            max={1000}
            defaultValue={connection.config.dailyActionLimit ?? 20}
            required
          />
        </Field>
        <p className="small-note">
          Leave credentials blank to keep saved values. Credentials are never
          returned by the API.
        </p>
        {provider.credentialFields.map((f) => (
          <Field label={f.label} key={f.key}>
            <input
              name={`credential_${f.key}`}
              className="form-control"
              type="password"
              autoComplete="new-password"
              placeholder={
                connection.credentialKeys.includes(f.key)
                  ? "Saved — leave blank to keep"
                  : "Required credential"
              }
            />
          </Field>
        ))}
        {[
          "stripe",
          "razorpay",
          "generic_crm",
          "outpero",
          "whatsapp",
          "ses",
        ].includes(connection.provider) && (
          <Field label="Webhook endpoint">
            <input
              className="form-control"
              readOnly
              value={`${window.location.origin}/api/v1/webhooks/${["stripe", "razorpay"].includes(connection.provider) ? "payments" : "integrations"}/${connection.id}`}
              onFocus={(e) => e.target.select()}
            />
          </Field>
        )}
        <button className="btn btn-primary" disabled={action.busy}>
          Save configuration
        </button>
      </form>
    </Modal>
  );
}
function Sync({
  connection,
  onClose,
}: {
  connection: any;
  onClose: () => void;
}) {
  const action = useAction(),
    [result, setResult] = useState<any>(null),
    [kind, setKind] = useState(
      connection.provider === "hubspot" ? "contacts" : "spend",
    );
  return (
    <Modal title={`Sync ${connection.label}`} close={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = values(e);
          const response = await action.run(
            `/integrations/${connection.id}/sync`,
            {
              kind,
              ...(kind === "spend" ? { since: v.since, until: v.until } : {}),
              ...(result?.nextCursor ? { cursor: result.nextCursor } : {}),
            },
            "POST",
            "Sync page processed",
          );
          if (response) setResult(response);
        }}
      >
        <Field label="Data">
          <select
            className="form-select"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setResult(null);
            }}
          >
            {connection.provider !== "hubspot" && (
              <option value="spend">Daily ad spend</option>
            )}
            {connection.provider !== "google_ads" && (
              <option value="contacts">Contacts / native leads</option>
            )}
          </select>
        </Field>
        {kind === "spend" && (
          <>
            <Field label="From">
              <input
                name="since"
                type="date"
                className="form-control"
                defaultValue={new Date(Date.now() - 7 * 86400000)
                  .toISOString()
                  .slice(0, 10)}
                required
              />
            </Field>
            <Field label="Through">
              <input
                name="until"
                type="date"
                className="form-control"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
            </Field>
          </>
        )}
        {action.error && <ErrorBox message={action.error} />}
        {result && (
          <p>
            {result.imported} imported; {result.rejected} rejected.{" "}
            {result.nextCursor
              ? "More records are available."
              : "Page sequence complete."}
          </p>
        )}
        <button className="btn btn-primary" disabled={action.busy}>
          {result?.nextCursor ? "Process next page" : "Start sync"}
        </button>
      </form>
    </Modal>
  );
}
function PrepareCommand({
  connections,
  onClose,
}: {
  connections: any[];
  onClose: () => void;
}) {
  const leads = useLoad<{
      items: { id: string; name: string; course: string }[];
    }>("/leads?limit=100"),
    action = useAction(),
    key = useRef(crypto.randomUUID()),
    [kind, setKind] = useState("call");
  const supported: Record<string, string[]> = {
    call: ["outpero"],
    message: ["whatsapp", "ses"],
    analysis: ["openai", "anthropic"],
  };
  return (
    <Modal title="Prepare an action for review" close={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = values(e);
          if (
            await action.run(
              "/commands",
              {
                kind,
                connectionId: v.connectionId,
                leadId: v.leadId,
                ...(kind === "analysis" ? { text: v.text } : {}),
              },
              "POST",
              "Action prepared for approval",
              key.current,
            )
          )
            onClose();
        }}
      >
        {action.error && <ErrorBox message={action.error} />}
        <Field label="Action">
          <select
            className="form-select"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="call">AI call</option>
            <option value="message">Approved message</option>
            <option value="analysis">Analyze conversation</option>
          </select>
        </Field>
        <Field label="Connection">
          <select name="connectionId" className="form-select" required>
            {connections
              .filter(
                (c) =>
                  supported[kind].includes(c.provider) &&
                  ["test", "active"].includes(c.status),
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {c.mode}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Lead">
          <select name="leadId" className="form-select" required>
            {leads.data?.items.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.course}
              </option>
            ))}
          </select>
        </Field>
        {kind === "analysis" && (
          <Field
            label="Conversation evidence"
            hint="Only submit text the contact has consented to have analyzed."
          >
            <textarea
              name="text"
              className="form-control"
              rows={5}
              maxLength={8000}
              required
            />
          </Field>
        )}
        <p className="small-note">
          Nothing is sent at this step. Review the prepared action before
          approving it. Advertising conversion actions are prepared
          automatically from consented milestones.
        </p>
        <button className="btn btn-primary" disabled={action.busy}>
          Prepare for approval
        </button>
      </form>
    </Modal>
  );
}
