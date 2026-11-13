import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Unplug,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  can,
  channels,
  stageLabels,
  stages,
  type LeadView,
  type Overview,
  type ReceiptView,
  type SessionView,
} from "../../../packages/core/src/contracts.ts";
import type { ProviderManifest } from "../../../packages/connectors/src/index.ts";
import { api, ApiError, mutate, setCsrf } from "./api";
import {
  Channel,
  dateLabel,
  Empty,
  ErrorBox,
  Field,
  formatMoney,
  Loading,
  Logo,
  Metric,
  Modal,
  MoneyType,
  StageBadge,
  timeLabel,
} from "./components";

import {
  Context,
  useWorkspace,
  useLoad,
  type WorkspaceContext,
} from "./workspace";
const formValues = (e: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<
    string,
    string
  >;
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Unable to complete the request.";

import {
  PublicEnquiry,
  PublicCheckout,
  PaymentReturn,
  AccountLink,
  ForgotPassword,
} from "./journey/Public";
import {
  IntakeForms,
  FormPayment,
  WorkQueue,
  FlowReport,
} from "./journey/Workspace";
import { Operations } from "./journey/Operations";
import { AccountSettings } from "./journey/Account";
import { Dashboard, Setup } from "./journey/Dashboard";
import { LeadWorkspace } from "./journey/Lead";
import { primaryNavigation, setupNavigation } from "./navigation";
const MarketingSources = lazy(() =>
  import("./journey/Marketing").then((module) => ({
    default: module.MarketingSources,
  })),
);

export function App() {
  const location = useLocation();
  const [session, setSession] = useState<SessionView | null>(null),
    [loading, setLoading] = useState(true),
    [bootError, setBootError] = useState("");
  const update = (value: SessionView) => {
    setCsrf(value.csrfToken);
    setSession(value);
  };
  useEffect(() => {
    api<SessionView>("/auth/session")
      .then(update)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401))
          setBootError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  if (
    /^\/(enquire|checkout|payment-return|forgot-password|account\/)/.test(
      location.pathname,
    )
  )
    return (
      <Routes>
        <Route path="/enquire/:publicKey" element={<PublicEnquiry />} />
        <Route path="/checkout" element={<PublicCheckout />} />
        <Route path="/payment-return" element={<PaymentReturn />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route
          path="/account/:action"
          element={<AccountLink signedIn={!!session} />}
        />
      </Routes>
    );
  if (loading)
    return (
      <div className="boot">
        <Logo />
        <Loading />
      </div>
    );
  return session ? (
    <Shell
      session={session}
      updateSession={update}
      signedOut={() => {
        setSession(null);
        setCsrf("");
      }}
    />
  ) : (
    <Auth onSession={update} bootError={bootError} />
  );
}
function Auth({
  onSession,
  bootError,
}: {
  onSession: (s: SessionView) => void;
  bootError: string;
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(bootError),
    [mfa, setMfa] = useState(false),
    [recovery, setRecovery] = useState(false),
    [config, setConfig] = useState({ demo: false, registration: false });
  useEffect(() => {
    api<typeof config>("/public/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = formValues(e);
    setBusy(true);
    setError("");
    try {
      onSession(
        await mutate<SessionView>(
          `/auth/${register ? "register" : "login"}`,
          values,
        ),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_REQUIRED") setMfa(true);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      onSession(await mutate<SessionView>("/auth/demo", {}));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Logo />
        <div className="auth-pitch">
          <div className="eyebrow">A CLEARER PATH TO REVENUE</div>
          <h1>
            Know where every
            <br />
            opportunity goes<span>.</span>
          </h1>
          <p>
            Bring your leads, conversations and collected revenue into one
            connected view.
          </p>
          <div className="auth-journey">
            <span>
              <Target size={20} /> Acquire
            </span>
            <i />
            <span>
              <Users size={20} /> Connect
            </span>
            <i />
            <span>
              <Wallet size={20} /> Convert
            </span>
          </div>
          <div className="auth-proof">
            <ShieldCheck size={19} />
            <span>Your workspace. Your data. Every step accounted for.</span>
          </div>
        </div>
        <small>RevenuePilot AI · Independent by design</small>
      </section>
      <section className="auth-form-side">
        <div className="auth-form">
          <span className="mini-pill">REVENUE INTELLIGENCE</span>
          <h2>
            {register ? "Create your workspace" : "Welcome to RevenuePilot"}
          </h2>
          <p>
            {register
              ? "Start with an independent workspace for your business."
              : "Sign in to see the story behind your revenue."}
          </p>
          {error && <ErrorBox message={error} />}
          <form onSubmit={submit}>
            {register && (
              <>
                <Field label="Your name">
                  <input
                    className="form-control"
                    name="name"
                    autoComplete="name"
                    minLength={2}
                    required
                  />
                </Field>
                <Field label="Workspace name">
                  <input
                    className="form-control"
                    name="workspaceName"
                    placeholder="Your company"
                    minLength={2}
                    required
                  />
                </Field>
              </>
            )}
            <Field label="Work email">
              <input
                className="form-control"
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </Field>
            <Field
              label="Password"
              hint={register ? "Use at least 12 characters." : undefined}
            >
              <input
                className="form-control"
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={register ? 12 : 1}
                required
              />
            </Field>
            {mfa && (
              <Field
                label={
                  recovery ? "Single-use recovery code" : "Authenticator code"
                }
              >
                <input
                  name={recovery ? "recoveryCode" : "code"}
                  className="form-control"
                  pattern={recovery ? "[A-Fa-f0-9-]{20,24}" : "[0-9]{6}"}
                  autoComplete="one-time-code"
                  inputMode={recovery ? "text" : "numeric"}
                  required
                  autoFocus
                />
              </Field>
            )}
            <button className="btn btn-primary w-100 mt-2" disabled={busy}>
              {busy
                ? "Please wait…"
                : register
                  ? "Create workspace"
                  : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          {!register && (
            <div className="d-flex justify-content-between mt-3">
              <Link className="small-note" to="/forgot-password">
                Forgot password?
              </Link>
              {mfa && (
                <button
                  className="btn btn-link btn-sm"
                  onClick={() => setRecovery(!recovery)}
                >
                  {recovery ? "Use authenticator code" : "Use recovery code"}
                </button>
              )}
            </div>
          )}
          {config.registration && (
            <div className="auth-switch">
              {register ? "Already have an account?" : "New to RevenuePilot?"}{" "}
              <button
                onClick={() => {
                  setRegister(!register);
                  setMfa(false);
                  setError("");
                }}
              >
                {register ? "Sign in" : "Create workspace"}
              </button>
            </div>
          )}
          {config.demo && (
            <>
              <div className="divider-label">
                <span>OR TAKE A LOOK AROUND</span>
              </div>
              <button
                className="btn btn-outline-primary w-100"
                disabled={busy}
                onClick={demo}
              >
                <Sparkles size={17} /> Explore sample workspace
              </button>
              <small className="auth-demo-note">
                Synthetic CodeBegun data. No live accounts connected.
              </small>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function Shell({
  session,
  updateSession,
  signedOut,
}: {
  session: SessionView;
  updateSession: (s: SessionView) => void;
  signedOut: () => void;
}) {
  const [tenantId, setTenantId] = useState(
      () => localStorage.getItem("rp_workspace") ?? session.tenants[0]?.id,
    ),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [help, setHelp] = useState(false),
    [workspaceModal, setWorkspaceModal] = useState(false),
    [search, setSearch] = useState("");
  const navigate = useNavigate(),
    location = useLocation();
  const tenant =
    session.tenants.find((t) => t.id === tenantId) ?? session.tenants[0];
  const notify = useCallback((text: string) => setToast(text), []),
    refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    setMobile(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);
  const nav = primaryNavigation;
  const title =
    [
      ...primaryNavigation,
      ...setupNavigation,
      { path: "/setup", label: "Settings" },
      { path: "/revenue", label: "Payments" },
    ].find((n) => n.path !== "/" && location.pathname.startsWith(n.path))
      ?.label ?? "Dashboard";
  const ctx: WorkspaceContext = {
    session,
    tenant,
    prefix: `/tenants/${tenant.id}`,
    revision,
    refresh,
    updateSession,
    notify,
  };
  return (
    <Context.Provider value={ctx}>
      <div className="app-shell">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {mobile && (
          <button
            className="sidebar-shade"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          />
        )}
        <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
          <Link to="/" className="brand-link">
            <Logo />
          </Link>
          <div className="workspace-switch">
            <span className="workspace-avatar">{tenant.name.slice(0, 1)}</span>
            <div>
              <label htmlFor="workspace-select">WORKSPACE</label>
              <select
                id="workspace-select"
                value={tenant.id}
                onChange={(e) => {
                  setTenantId(e.target.value);
                  localStorage.setItem("rp_workspace", e.target.value);
                  navigate("/");
                }}
                aria-label="Switch workspace"
              >
                {session.tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <ChevronDown size={14} />
          </div>
          <div className="nav-caption">YOUR WORKSPACE</div>
          <nav aria-label="Main navigation">
            {nav
              .filter(
                (n) =>
                  !("permission" in n) ||
                  !n.permission ||
                  can(tenant.role, n.permission),
              )
              .map((n) => (
                <NavLink key={n.path} to={n.path} end={n.path === "/"}>
                  <n.icon size={18} />
                  <span>{n.label}</span>
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="workspace-health">
              <span className="health-symbol">
                <Activity size={17} />
              </span>
              <div>
                <strong>
                  {tenant.demo ? "Demo workspace" : "Independent workspace"}
                </strong>
                <small>
                  {tenant.demo
                    ? "Sample data only"
                    : "Tenant-isolated workspace"}
                </small>
              </div>
            </div>
            <NavLink className="settings-link" to="/setup">
              <Settings2 size={18} /> Settings
            </NavLink>
            <button className="settings-link" onClick={() => setHelp(true)}>
              <CircleHelp size={18} /> Help
              <ArrowUpRight size={14} className="ms-auto" />
            </button>
            <div className="user-card">
              <span className="user-avatar">
                {session.user.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{session.user.name}</strong>
                <small>
                  {tenant.role[0].toUpperCase() + tenant.role.slice(1)}
                </small>
              </div>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  try {
                    await mutate("/auth/logout", {});
                    signedOut();
                    navigate("/");
                  } catch (e) {
                    notify(errorText(e));
                  }
                }}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </aside>
        <div className="app-body">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <div className="breadcrumbs">
              <span>{tenant.name}</span>
              <ChevronRight size={13} />
              <strong>{title}</strong>
            </div>
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/leads?q=${encodeURIComponent(search)}`);
                setSearch("");
              }}
            >
              <Search size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search leads…"
                aria-label="Search all leads"
              />
              <kbd>↵</kbd>
            </form>
            <button
              className="icon-button"
              title="Refresh data"
              aria-label="Refresh data"
              onClick={refresh}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button"
              title="View uncontacted leads"
              aria-label="View uncontacted leads"
              onClick={() => navigate("/leads?stage=new")}
            >
              <Bell size={18} />
            </button>
            <span className="top-avatar">{session.user.name[0]}</span>
          </header>
          <main id="main" className="workspace-main" key={tenant.id}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/setup" element={<Setup />} />
              <Route
                path="/marketing"
                element={
                  <Suspense fallback={<Loading />}>
                    <MarketingSources />
                  </Suspense>
                }
              />
              <Route
                path="/journeys"
                element={<Navigate to="/flow" replace />}
              />
              <Route path="/leads" element={<Leads />} />
              <Route path="/leads/:leadId" element={<LeadWorkspace />} />
              <Route
                path="/leads/:leadId/workflow"
                element={<LegacyLeadRoute />}
              />
              <Route path="/work" element={<WorkQueue />} />
              <Route path="/flow" element={<FlowReport />} />
              <Route path="/intake" element={<IntakeForms />} />
              <Route path="/intake/:formId" element={<FormPayment />} />
              <Route
                path="/revenue"
                element={
                  can(tenant.role, "revenue.read") ? (
                    <Revenue />
                  ) : (
                    <Empty
                      title="Revenue access required"
                      text="Your workspace owner can assign a role with finance access."
                    />
                  )
                }
              />
              <Route path="/connections" element={<Connections />} />
              <Route path="/operations" element={<Operations />} />
              <Route path="/account-settings" element={<AccountSettings />} />
              <Route
                path="/settings"
                element={
                  <WorkspaceSettings
                    newWorkspace={() => setWorkspaceModal(true)}
                  />
                }
              />
              <Route
                path="*"
                element={
                  <Empty
                    title="Page not found"
                    text="Return to your workspace dashboard."
                    action={
                      <Link to="/" className="btn btn-primary">
                        Dashboard
                      </Link>
                    }
                  />
                }
              />
            </Routes>
            <footer className="workspace-footer">
              <span>RevenuePilot AI</span>
              <span>
                {tenant.demo
                  ? "Synthetic data · Demo environment"
                  : "Independent workspace · Provider activity is explicit"}
                <span className="footer-dot">·</span>
                {tenant.timezone}
              </span>
            </footer>
          </main>
        </div>
        {toast && (
          <div className="toast-message" role="status">
            <CheckCircle2 size={18} />
            {toast}
            <button
              onClick={() => setToast("")}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {help && (
          <Modal
            title="Built around your revenue journey"
            close={() => setHelp(false)}
          >
            <p>
              RevenuePilot is an independent workspace for leads, stage history,
              recorded receipts and acquisition evidence.
            </p>
            <div className="info-strip">
              <ShieldCheck size={19} />
              <span>
                Open Settings → Integrations to configure providers. Live
                actions require configured credentials, consent and approval.
              </span>
            </div>
            <ul className="plain-list">
              <li>
                Lead and finance actions are saved to your selected workspace.
              </li>
              <li>
                Timeline events are processed by the durable outbox worker.
              </li>
              <li>
                Reports combines recorded touch evidence with imported
                advertising spend. Attribution does not establish causation.
              </li>
            </ul>
            <a
              href="https://github.com/mynameiscod/RevenuePilot-AI"
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline-primary"
            >
              View project
              <ExternalLink size={15} />
            </a>
          </Modal>
        )}
        {workspaceModal && (
          <NewWorkspace
            close={() => setWorkspaceModal(false)}
            onCreated={(s) => {
              updateSession(s);
              const created = s.tenants.find(
                (t) => !session.tenants.some((old) => old.id === t.id),
              );
              if (created) {
                setTenantId(created.id);
                localStorage.setItem("rp_workspace", created.id);
              }
              navigate("/");
            }}
          />
        )}
      </div>
    </Context.Provider>
  );
}

function PageHeading({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow?: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
function Leads() {
  const { tenant, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams(),
    [create, setCreate] = useState(false),
    [search, setSearch] = useState(params.get("q") ?? "");
  const stage = params.get("stage") ?? "all",
    page = Number(params.get("page") ?? 1),
    q = params.get("q") ?? "";
  const { data, loading, error } = useLoad<{
    items: LeadView[];
    total: number;
    page: number;
    limit: number;
  }>(`/leads?stage=${stage}&q=${encodeURIComponent(q)}&page=${page}&limit=12`);
  useEffect(() => setSearch(q), [q]);
  function setQuery(key: string, value: string) {
    const p = new URLSearchParams(params);
    p.set(key, value);
    if (key !== "page") p.delete("page");
    setParams(p);
  }
  return (
    <>
      <PageHeading
        eyebrow="OPPORTUNITY WORKSPACE"
        title="Leads"
        text="Open a lead to see its full journey and take the next step."
      >
        {can(tenant.role, "leads.write") && (
          <button className="btn btn-primary" onClick={() => setCreate(true)}>
            <Plus size={17} /> Add lead
          </button>
        )}
      </PageHeading>
      <section className="panel">
        <div className="list-toolbar">
          <form
            className="list-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery("q", search);
            }}
          >
            <Search size={17} />
            <input
              aria-label="Search leads by name or course"
              placeholder="Search name, course or campaign…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" className="btn btn-sm btn-light">
              Search
            </button>
          </form>
          <label className="filter-select">
            <SlidersHorizontal size={16} />
            <select
              aria-label="Filter by stage"
              value={stage}
              onChange={(e) => setQuery("stage", e.target.value)}
            >
              <option value="all">All stages</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {stageLabels[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? (
          <ErrorBox message={error} retry={refresh} />
        ) : loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty
            title="No leads in this view"
            text="Try another filter, or add your first independent enquiry."
          />
        ) : (
          <>
            <div className="table-responsive">
              <table className="table rp-table lead-table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Course interest</th>
                    <th>Source</th>
                    <th>Current stage</th>
                    <th>Received</th>
                    <th>
                      <span className="visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link className="lead-person" to={`/leads/${l.id}`}>
                          <span className="person-avatar">
                            {l.name
                              .split(" ")
                              .slice(0, 2)
                              .map((s) => s[0])
                              .join("")}
                          </span>
                          <span>
                            <strong>{l.name}</strong>
                            <small>
                              {l.email ||
                                l.phone ||
                                "Contact details restricted"}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td>
                        {l.course}
                        <small className="cell-note">
                          {l.campaign || "Direct enquiry"}
                        </small>
                      </td>
                      <td>
                        <Channel name={l.channel} />
                      </td>
                      <td>
                        <StageBadge stage={l.stage} />
                      </td>
                      <td className="muted">
                        {dateLabel(l.createdAt, tenant.timezone)}
                      </td>
                      <td>
                        <Link
                          className="icon-button"
                          to={`/leads/${l.id}`}
                          aria-label={`Open ${l.name}`}
                        >
                          <ArrowUpRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              total={data.total}
              limit={data.limit}
              setPage={(p) => setQuery("page", String(p))}
            />
          </>
        )}
      </section>
      {create && <LeadForm close={() => setCreate(false)} />}
    </>
  );
}
function Pagination({
  page,
  total,
  limit,
  setPage,
}: {
  page: number;
  total: number;
  limit: number;
  setPage: (n: number) => void;
}) {
  return (
    <div className="pagination-bar">
      <span>
        Showing {Math.min((page - 1) * limit + 1, total)}–
        {Math.min(page * limit, total)} of {total}
      </span>
      <div>
        <button
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          Page {page} of {Math.max(1, Math.ceil(total / limit))}
        </span>
        <button
          aria-label="Next page"
          disabled={page * limit >= total}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
function LeadForm({ close }: { close: () => void }) {
  const { prefix, refresh, notify } = useWorkspace(),
    navigate = useNavigate();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = formValues(e);
    setBusy(true);
    setError("");
    try {
      const lead = await mutate<LeadView>(
        `${prefix}/leads`,
        fields,
        "POST",
        key.current,
      );
      refresh();
      close();
      notify("Lead added to your workspace");
      navigate(`/leads/${lead.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a new lead" close={close}>
      <p className="muted">
        Create an enquiry in this workspace. No external CRM is contacted.
      </p>
      <form onSubmit={submit}>
        {error && <ErrorBox message={error} />}
        <Field label="Full name">
          <input
            name="name"
            className="form-control"
            required
            minLength={2}
            maxLength={100}
            autoFocus
          />
        </Field>
        <div className="form-two">
          <Field label="Email address">
            <input name="email" className="form-control" type="email" />
          </Field>
          <Field label="Phone number">
            <input name="phone" className="form-control" placeholder="+91…" />
          </Field>
        </div>
        <Field label="Course or product interest">
          <input
            name="course"
            className="form-control"
            placeholder="e.g. Java Full Stack"
            required
            minLength={2}
          />
        </Field>
        <div className="form-two">
          <Field label="Acquisition source">
            <select name="channel" className="form-select">
              {channels.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Campaign (optional)">
            <input name="campaign" className="form-control" />
          </Field>
        </div>
        <Field label="Notes (optional)">
          <textarea
            name="note"
            className="form-control"
            rows={3}
            maxLength={1000}
          />
        </Field>
        <div className="form-footer">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={close}
          >
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Create lead"}
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LegacyLeadRoute() {
  const { leadId } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/leads/${leadId}${search}`} replace />;
}

function Revenue() {
  const { tenant, refresh } = useWorkspace(),
    [page, setPage] = useState(1),
    [create, setCreate] = useState(false);
  const { data, error, loading } = useLoad<{
    items: ReceiptView[];
    total: number;
    limit: number;
    page: number;
  }>(`/revenue?page=${page}&limit=12`);
  const summary = useLoad<Overview>("/overview?days=30");
  const cash = summary.data?.cashByCurrency[tenant.currency];
  return (
    <>
      <PageHeading
        eyebrow="FINANCIAL EVIDENCE"
        title="Payment records"
        text="Recorded receipts and refunds, with each currency kept separate."
      >
        {can(tenant.role, "revenue.write") && (
          <button className="btn btn-primary" onClick={() => setCreate(true)}>
            <Plus size={16} /> Record receipt
          </button>
        )}
      </PageHeading>
      {summary.error && <ErrorBox message={summary.error} retry={refresh} />}
      <div className="metrics-grid three">
        <Metric
          label="Gross receipts · last 30 days"
          value={
            cash
              ? formatMoney(cash.gross, tenant.currency)
              : summary.loading
                ? "…"
                : summary.error
                  ? "—"
                  : formatMoney("0", tenant.currency)
          }
          detail={
            tenant.demo
              ? "Synthetic sample receipts"
              : "Manual + provider-verified; excludes test payments"
          }
          icon={<ArrowDownLeft size={18} />}
        />
        <Metric
          label="Refunds · last 30 days"
          value={
            cash
              ? formatMoney(cash.refunds, tenant.currency)
              : summary.loading
                ? "…"
                : summary.error
                  ? "—"
                  : formatMoney("0", tenant.currency)
          }
          detail="Linked to an original capture"
          icon={<ArrowUpRight size={18} />}
        />
        <Metric
          label="Net collected cash · last 30 days"
          value={
            cash
              ? formatMoney(cash.net, tenant.currency)
              : summary.loading
                ? "…"
                : summary.error
                  ? "—"
                  : formatMoney("0", tenant.currency)
          }
          detail={`${tenant.currency} only · no automatic FX conversion`}
          icon={<Wallet size={18} />}
          accent
        />
      </div>
      <div className="info-strip">
        <ShieldCheck size={19} />
        <span>
          Evidence labels distinguish manual entries, sandbox simulations,
          provider tests and verified payments. Net cash is not accounting
          revenue. Reports separates every evidence type.
        </span>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Receipt ledger</h2>
            <p>All recorded receipts and refunds</p>
          </div>
          <span className="mini-pill">APPEND-ONLY RECORDS</span>
        </div>
        {error ? (
          <ErrorBox message={error} retry={refresh} />
        ) : loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty
            title="Your first receipt starts the ledger"
            text="Record a capture with a unique reference and its related lead."
          />
        ) : (
          <>
            <div className="table-responsive">
              <table className="table rp-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Lead / course</th>
                    <th>Type</th>
                    <th>Recorded source</th>
                    <th>Date</th>
                    <th className="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td className="reference-cell">
                        {r.reference}
                        <small className="cell-note">
                          {r.evidence.replaceAll("_", " ")}
                        </small>
                      </td>
                      <td>
                        <Link className="table-link" to={`/leads/${r.leadId}`}>
                          {r.leadName}
                        </Link>
                        <small className="cell-note">{r.course}</small>
                      </td>
                      <td>
                        <MoneyType kind={r.kind} />
                      </td>
                      <td>
                        <Channel name={r.channel} />
                      </td>
                      <td>{dateLabel(r.createdAt, tenant.timezone)}</td>
                      <td
                        className={`text-end money-cell ${r.kind === "refund" ? "text-amber" : ""}`}
                      >
                        {r.kind === "refund" ? "−" : ""}
                        {formatMoney(r.amountMinor, r.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              total={data.total}
              limit={data.limit}
              setPage={setPage}
            />
          </>
        )}
      </section>
      {create && <ReceiptForm close={() => setCreate(false)} />}
    </>
  );
}
function ReceiptForm({ close }: { close: () => void }) {
  const { prefix, tenant, refresh, notify } = useWorkspace();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [kind, setKind] = useState("capture"),
    [selectedLead, setSelectedLead] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const captures = useLoad<{ items: ReceiptView[] }>(
    `/revenue?kind=capture&limit=100&leadId=${encodeURIComponent(selectedLead || "none")}`,
  );
  const leads = useLoad<{ items: LeadView[] }>(
    `/leads?q=${encodeURIComponent(query)}&limit=100`,
  );
  const key = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = formValues(e);
    const { amount, originalReceiptId, ...fields } = values;
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setError("Enter a positive amount with at most two decimal places.");
      return;
    }
    const [whole, fraction = ""] = amount.split("."),
      amountMinor = (
        BigInt(whole) * 100n +
        BigInt(fraction.padEnd(2, "0"))
      ).toString();
    setBusy(true);
    setError("");
    try {
      await mutate(
        `${prefix}/revenue`,
        {
          ...fields,
          amountMinor,
          ...(originalReceiptId ? { originalReceiptId } : {}),
        },
        "POST",
        key.current,
      );
      refresh();
      close();
      notify("Receipt recorded in the ledger");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Record financial evidence" close={close}>
      <p className="muted">
        This records an existing payment or refund. It does not charge or refund
        anyone.
      </p>
      {error && <ErrorBox message={error} />}
      <div className="form-two mb-3">
        <input
          className="form-control"
          placeholder="Find lead by name or course"
          aria-label="Find lead for receipt"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn btn-outline-secondary"
          onClick={() => setQuery(search)}
        >
          <Search size={14} /> Find leads
        </button>
      </div>
      <form onSubmit={submit}>
        <Field label="Related lead">
          <select
            name="leadId"
            className="form-select"
            required
            value={selectedLead}
            onChange={(e) => setSelectedLead(e.target.value)}
          >
            <option value="" disabled>
              Select a lead
            </option>
            {leads.data?.items.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name} · {l.course}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-two">
          <Field label="Record type">
            <select
              name="kind"
              className="form-select"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="capture">Captured receipt</option>
              <option value="refund">Refund</option>
            </select>
          </Field>
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
        <Field label="Amount">
          <input
            name="amount"
            className="form-control"
            inputMode="decimal"
            placeholder="35000.00"
            required
            pattern="[0-9]+(\.[0-9]{1,2})?"
          />
        </Field>
        <Field label="Unique receipt reference">
          <input
            name="reference"
            className="form-control"
            minLength={3}
            maxLength={120}
            required
          />
        </Field>
        {kind === "refund" && (
          <Field
            label="Original captured receipt"
            hint="The refund must use the same currency as this capture."
          >
            <select
              name="originalReceiptId"
              className="form-select"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Select the captured receipt
              </option>
              {captures.data?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.reference} · {formatMoney(r.amountMinor, r.currency)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Evidence / reason">
          <textarea
            name="note"
            className="form-control"
            rows={3}
            minLength={3}
            maxLength={500}
            required
          />
        </Field>
        <div className="form-footer">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !leads.data?.items.length}
          >
            {busy ? "Recording…" : "Record evidence"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type ConnectionData = {
  providers: ProviderManifest[];
  items: {
    id: string;
    provider: string;
    label: string;
    accountId: string;
    status: string;
    configuredFields: string[];
    updatedAt: string;
  }[];
};
function Connections() {
  const { tenant, prefix, refresh, notify } = useWorkspace(),
    { data, error, loading } = useLoad<ConnectionData>("/connections");
  const [category, setCategory] = useState("all"),
    [selected, setSelected] = useState<ProviderManifest | null>(null),
    [remove, setRemove] = useState<string | null>(null),
    [removeError, setRemoveError] = useState("");
  const categories = [
    { id: "all", name: "All providers" },
    { id: "advertising", name: "Advertising" },
    { id: "crm", name: "CRMs" },
    { id: "calling", name: "AI calling" },
    { id: "payments", name: "Payments" },
    { id: "ai", name: "AI models" },
    { id: "messaging", name: "Messaging" },
  ];
  return (
    <>
      <PageHeading
        eyebrow="YOUR CONNECTED WORKSPACE"
        title="Provider catalog"
        text="Configure the providers that will power your revenue journey."
      />
      <div className="info-strip">
        <Unplug size={19} />
        <span>
          Connections start as encrypted drafts. Open Settings → Integrations to
          configure, check and activate them. Outbound actions require approval.
        </span>
      </div>
      <div
        className="filter-tabs"
        role="group"
        aria-label="Provider categories"
      >
        {categories.map((c) => (
          <button
            key={c.id}
            className={category === c.id ? "active" : ""}
            onClick={() => setCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : loading || !data ? (
        <Loading />
      ) : (
        <>
          {data.items.length > 0 && (
            <section className="panel connection-drafts">
              <div className="panel-heading">
                <h2>Saved configurations</h2>
                <Link
                  to="/operations"
                  className="btn btn-sm btn-outline-secondary"
                >
                  Integration controls
                </Link>
                <span className="subtle-badge">
                  {data.items.length} connections
                </span>
              </div>
              {data.items.map((c) => (
                <div className="draft-row" key={c.id}>
                  <span
                    className="provider-mark small"
                    style={{
                      background: data.providers.find(
                        (p) => p.id === c.provider,
                      )?.color,
                    }}
                  >
                    {data.providers.find((p) => p.id === c.provider)?.monogram}
                  </span>
                  <div>
                    <strong>{c.label}</strong>
                    <small>
                      {data.providers.find((p) => p.id === c.provider)?.name} ·{" "}
                      {c.accountId || "Account not selected"}
                    </small>
                  </div>
                  <span className="draft-status">{c.status}</span>
                  {can(tenant.role, "connections.write") && (
                    <button
                      className="icon-button"
                      aria-label={`Remove ${c.label}`}
                      onClick={() => {
                        setRemove(c.id);
                        setRemoveError("");
                      }}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          <div className="provider-grid">
            {data.providers
              .filter((p) => category === "all" || category === p.category)
              .map((p) => (
                <article className="provider-card" key={p.id}>
                  <div className="provider-top">
                    <span
                      className="provider-mark"
                      style={{ background: p.color }}
                    >
                      {p.monogram}
                    </span>
                    <span className="subtle-badge">
                      {categories.find((c) => c.id === p.category)?.name}
                    </span>
                  </div>
                  <h2>{p.name}</h2>
                  <p>{p.description}</p>
                  <div className="capability-list">
                    {p.capabilities.slice(0, 2).map((c) => (
                      <span key={c}>{c.replace(".", " · ")}</span>
                    ))}
                  </div>
                  <div className="provider-footer">
                    <span>
                      <span className="muted-dot" />
                      Adapter available
                    </span>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={!can(tenant.role, "connections.write")}
                      onClick={() => setSelected(p)}
                    >
                      Configure
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </>
      )}
      {selected && (
        <ConnectionForm provider={selected} close={() => setSelected(null)} />
      )}
      {remove && (
        <Modal
          title="Remove draft configuration?"
          close={() => setRemove(null)}
        >
          <p>
            This deletes the draft and its stored credentials from this
            workspace.
          </p>
          {removeError && <ErrorBox message={removeError} />}
          <div className="form-footer">
            <button
              className="btn btn-outline-secondary"
              onClick={() => setRemove(null)}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await api(`${prefix}/connections/${remove}`, {
                    method: "DELETE",
                  });
                  setRemove(null);
                  refresh();
                  notify("Draft removed");
                } catch (e) {
                  setRemoveError(errorText(e));
                }
              }}
            >
              Remove draft
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ConnectionForm({
  provider,
  close,
}: {
  provider: ProviderManifest;
  close: () => void;
}) {
  const { prefix, refresh, notify } = useWorkspace(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = formValues(e);
    const credentials = Object.fromEntries(
      provider.credentialFields
        .filter((f) => fields[f.key])
        .map((f) => [f.key, fields[f.key]]),
    );
    setBusy(true);
    setError("");
    try {
      await mutate(`${prefix}/connections`, {
        provider: provider.id,
        label: fields.label,
        accountId: fields.accountId,
        credentials,
      });
      close();
      refresh();
      notify(`${provider.name} draft saved`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Configure ${provider.name}`} close={close}>
      <p className="muted">
        Save a draft configuration. Credentials are encrypted and never returned
        by this screen.
      </p>
      {error && <ErrorBox message={error} />}
      <form onSubmit={submit}>
        <Field label="Connection name">
          <input
            name="label"
            className="form-control"
            defaultValue={provider.name}
            required
            minLength={2}
            maxLength={100}
          />
        </Field>
        <Field label="Provider account ID (optional)">
          <input name="accountId" className="form-control" maxLength={150} />
        </Field>
        {provider.credentialFields.map((f) => (
          <Field key={f.key} label={`${f.label} (optional)`}>
            <input
              name={f.key}
              type="password"
              className="form-control"
              autoComplete="off"
              maxLength={8000}
            />
          </Field>
        ))}
        {provider.credentialFields.length === 0 && (
          <div className="info-strip">
            Complete provider configuration in Integration controls after saving
            this draft.
          </div>
        )}
        <div className="form-footer">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={close}
          >
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save draft"}
            <ShieldCheck size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function WorkspaceSettings({ newWorkspace }: { newWorkspace: () => void }) {
  const { tenant, prefix, session, refresh, updateSession, notify } =
    useWorkspace();
  const [tab, setTab] = useState("general"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = formValues(e);
    setBusy(true);
    setError("");
    try {
      updateSession(
        await mutate<SessionView>(
          `${prefix}/settings`,
          {
            ...fields,
            firstResponseMinutes: Number(fields.firstResponseMinutes),
            retentionDays: Number(fields.retentionDays),
            attributionModel: tenant.attributionModel,
          },
          "PUT",
        ),
      );
      refresh();
      notify("Workspace settings saved");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const tabs = [
    "general",
    "security",
    ...(can(tenant.role, "settings.write")
      ? ["tracking", "members", "audit"]
      : []),
  ];
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE CONTROL"
        title="Workspace preferences"
        text="Manage your workspace, access and evidence collection."
      >
        <button className="btn btn-outline-secondary" onClick={newWorkspace}>
          <Plus size={15} /> New workspace
        </button>
      </PageHeading>
      <div className="filter-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "general" && (
        <section className="panel padded settings-panel">
          <h2>Workspace preferences</h2>
          <p className="muted">Changes apply only to {tenant.name}.</p>
          {error && <ErrorBox message={error} />}
          <form onSubmit={save}>
            <fieldset disabled={!can(tenant.role, "settings.write")}>
              <Field label="Workspace name">
                <input
                  className="form-control"
                  name="name"
                  defaultValue={tenant.name}
                  minLength={2}
                  maxLength={100}
                  required
                />
              </Field>
              <div className="form-two">
                <Field label="Reporting currency">
                  <select
                    className="form-select"
                    name="currency"
                    defaultValue={tenant.currency}
                  >
                    <option>INR</option>
                    <option>USD</option>
                    <option>AED</option>
                  </select>
                </Field>
                <Field label="Workspace timezone">
                  <select
                    className="form-select"
                    name="timezone"
                    defaultValue={tenant.timezone}
                  >
                    {[
                      "Asia/Kolkata",
                      "Asia/Dubai",
                      "America/New_York",
                      "UTC",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field
                label="First response target (elapsed minutes)"
                hint="Business-hour calendars will be added in a later milestone."
              >
                <input
                  className="form-control"
                  type="number"
                  name="firstResponseMinutes"
                  min={1}
                  max={1440}
                  defaultValue={tenant.firstResponseMinutes}
                  required
                />
              </Field>
              <Field
                label="Sensitive activity retention (days)"
                hint="Call text, form telemetry and processed action content are removed after this period. Financial evidence is retained."
              >
                <input
                  className="form-control"
                  name="retentionDays"
                  type="number"
                  min={30}
                  max={365}
                  defaultValue={tenant.retentionDays}
                  required
                />
              </Field>
              <div className="info-strip">
                Reports compares first-touch, last-touch and linear attribution
                with observed provider spend.
              </div>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save preferences"}
                <Check size={16} />
              </button>
            </fieldset>
          </form>
        </section>
      )}
      {tab === "security" && <Security />}
      {tab === "tracking" && <Tracking />}
      {tab === "members" && <Members />}
      {tab === "audit" && <AuditLog />}
    </>
  );
}
function Security() {
  const { session, updateSession, notify } = useWorkspace();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(
      null,
    ),
    [recoveryCodes, setRecoveryCodes] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setSetup(await mutate("/auth/mfa/setup", formValues(e)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const confirmation = await mutate<{ recoveryCodes: string[] }>(
        "/auth/mfa/confirm",
        formValues(e),
      );
      setRecoveryCodes(confirmation.recoveryCodes);
      setSetup(null);
      updateSession(await api<SessionView>("/auth/session"));
      notify("Two-factor authentication enabled");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel padded settings-panel">
      <span className="security-symbol">
        <ShieldCheck size={26} />
      </span>
      <h2>Two-factor authentication</h2>
      <p className="muted">
        Protect your account with a time-based authenticator.
      </p>
      {error && <ErrorBox message={error} />}
      {recoveryCodes.length > 0 && (
        <div className="note-card">
          <strong>Save your recovery codes now</strong>
          <p>
            Each code can be used once. Store them in your password manager;
            they will not be shown again after leaving this page.
          </p>
          <pre className="preserve-lines">{recoveryCodes.join("\n")}</pre>
        </div>
      )}
      {session.user.mfaEnabled ? (
        <div className="success-box">
          <CheckCircle2 size={19} /> Authenticator protection is enabled.
        </div>
      ) : setup ? (
        <form onSubmit={confirm}>
          <p>
            Add this secret manually to your authenticator as a time-based code.
            Keep it private.
          </p>
          <code className="secret-code">{setup.secret}</code>
          <p className="small-note">
            After confirmation, save the single-use recovery codes in your
            password manager.
          </p>
          <Field label="Six-digit verification code">
            <input
              className="form-control"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
              autoComplete="one-time-code"
            />
          </Field>
          <button className="btn btn-primary" disabled={busy}>
            Verify and enable
            <Check size={15} />
          </button>
        </form>
      ) : (
        <form onSubmit={start}>
          <Field label="Confirm your current password">
            <input
              className="form-control"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>
          <p className="small-note">
            The sample workspace has no shared password. Create your own account
            to configure account security.
          </p>
          <button className="btn btn-primary" disabled={busy}>
            Set up authenticator
            <ArrowRight size={15} />
          </button>
        </form>
      )}
    </section>
  );
}
function Tracking() {
  const { prefix, refresh, notify } = useWorkspace();
  const { data, error, loading } = useLoad<{
    items: {
      _id: string;
      name: string;
      publicKey: string;
      origins: string[];
    }[];
  }>("/sites");
  const [formError, setFormError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = formValues(e),
      form = e.currentTarget;
    setBusy(true);
    setFormError("");
    try {
      await mutate(`${prefix}/sites`, {
        name: values.name,
        origins: values.origins
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      refresh();
      form.reset();
      notify("Website registered");
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="two-column">
      <section className="panel padded">
        <h2>Register a website</h2>
        <p className="muted">
          Restrict collection to exact origins you control.
        </p>
        {formError && <ErrorBox message={formError} />}
        <form onSubmit={save}>
          <Field label="Website name">
            <input
              name="name"
              className="form-control"
              required
              minLength={2}
            />
          </Field>
          <Field
            label="Allowed origins"
            hint="One exact HTTPS origin per line. Localhost HTTP is allowed for development."
          >
            <textarea
              className="form-control"
              name="origins"
              rows={3}
              placeholder="https://www.example.com"
              required
            />
          </Field>
          <button className="btn btn-primary" disabled={busy}>
            Register website
            <Plus size={15} />
          </button>
        </form>
      </section>
      <section className="panel padded">
        <h2>Registered sites</h2>
        {error ? (
          <ErrorBox message={error} retry={refresh} />
        ) : loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty
            title="No sites registered"
            text="Add your website to get a publishable collection key."
          />
        ) : (
          data.items.map((s) => (
            <div className="site-card" key={s._id}>
              <strong>{s.name}</strong>
              <p>{s.origins.join(", ")}</p>
              <label>Publishable site key</label>
              <code>{s.publicKey}</code>
            </div>
          ))
        )}
        <p className="small-note">
          Install the SDK from this project and explicitly grant analytics
          consent. No existing website is modified when you register a site.
        </p>
        <a
          className="text-link"
          href="https://github.com/mynameiscod/RevenuePilot-AI/blob/main/docs/tracking.md"
          target="_blank"
          rel="noreferrer"
        >
          SDK integration guide
          <ExternalLink size={14} />
        </a>
      </section>
    </div>
  );
}
function Members() {
  const { data, loading, error } = useLoad<{
    items: { id: string; name: string; email: string; role: string }[];
  }>("/members");
  const { refresh } = useWorkspace();
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Workspace members</h2>
          <p>Membership is checked on every workspace request.</p>
        </div>
      </div>
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : loading ? (
        <Loading />
      ) : (
        <div className="table-responsive">
          <table className="table rp-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.email}</td>
                  <td>
                    <span className="subtle-badge">{m.role}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel-foot">
        Member invitations and role management will be added in the next
        access-management milestone.
      </div>
    </section>
  );
}
function AuditLog() {
  const { tenant, refresh } = useWorkspace();
  const { data, error, loading } = useLoad<{
    items: {
      _id: string;
      action: string;
      targetId: string;
      createdAt: string;
      requestId: string;
    }[];
    pendingEvents: number;
  }>("/audit");
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Workspace audit log</h2>
          <p>
            Latest 100 actions · {data?.pendingEvents ?? "…"} timeline events
            pending
          </p>
        </div>
        <button
          className="icon-button"
          onClick={refresh}
          aria-label="Refresh audit log"
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : loading ? (
        <Loading />
      ) : (
        <div className="table-responsive">
          <table className="table rp-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Target</th>
                <th>Time</th>
                <th>Request reference</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <tr key={a._id}>
                  <td>{a.action.replaceAll(".", " / ")}</td>
                  <td className="mono small">{a.targetId.slice(0, 8)}…</td>
                  <td>{timeLabel(a.createdAt, tenant.timezone)}</td>
                  <td className="mono small">{a.requestId.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function NewWorkspace({
  close,
  onCreated,
}: {
  close: () => void;
  onCreated: (s: SessionView) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await mutate<SessionView>("/tenants", formValues(e));
      onCreated(session);
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create an independent workspace" close={close}>
      <p className="muted">
        The new workspace starts empty. Existing leads, connections and
        financial records stay in their current workspace.
      </p>
      {error && <ErrorBox message={error} />}
      <form onSubmit={submit}>
        <Field label="Workspace name">
          <input
            name="name"
            className="form-control"
            minLength={2}
            maxLength={100}
            required
          />
        </Field>
        <div className="form-footer">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={close}
          >
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            Create workspace
            <Plus size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
