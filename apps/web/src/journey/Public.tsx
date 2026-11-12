import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { api, mutate } from "../api";
import { ErrorBox, Field, Loading, Logo, formatMoney } from "../components";
type FormInfo = {
  name: string;
  course: string;
  workspaceName: string;
  amountMinor: string;
  currency: string;
  consentVersion: string;
  sandboxAvailable: boolean;
};
export function PublicEnquiry() {
  const { publicKey } = useParams(),
    navigate = useNavigate();
  const [form, setForm] = useState<FormInfo>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tracking, setTracking] = useState(false);
  const attemptId = useRef(crypto.randomUUID()),
    anonymousId = useRef(crypto.randomUUID()),
    started = useRef(false);
  const touch = () => {
    const params = new URLSearchParams(window.location.search);
    const get = (name: string, max: number) =>
      (params.get(name) ?? "").slice(0, max);
    return {
      source: get("utm_source", 80) || "Direct",
      medium: get("utm_medium", 80),
      campaign: get("utm_campaign", 120),
      accountId: get("ad_account_id", 100),
      campaignId: get("utm_id", 100),
      adId: get("ad_id", 100),
      clickIds: Object.fromEntries(
        ["gclid", "fbclid", "gbraid", "wbraid"]
          .filter((k) => params.has(k))
          .map((k) => [k, get(k, 256)]),
      ),
    };
  };
  useEffect(() => {
    api<FormInfo>(`/public/forms/${publicKey}`)
      .then(setForm)
      .catch((e) => setError(e.message));
  }, [publicKey]);
  const record = (type: string) =>
    mutate(`/public/forms/${publicKey}/events`, {
      attemptId: attemptId.current,
      anonymousId: anonymousId.current,
      type,
      path: window.location.pathname,
      trackingConsent: true,
      touch: touch(),
    }).catch(() => {});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      if (tracking) await record("submitted");
      const result = await mutate<{ acceptanceToken: string }>(
        `/public/forms/${publicKey}/submit`,
        {
          attemptId: attemptId.current,
          anonymousId: anonymousId.current,
          name: data.name,
          email: data.email,
          phone: data.phone || "",
          website: data.website || "",
          privacyConsent: data.privacyConsent === "on",
          marketingConsent: data.marketingConsent === "on",
          trackingConsent: tracking,
          adConsent: data.adConsent === "on",
          consentVersion: form!.consentVersion,
          ...(tracking ? { touch: touch() } : {}),
        },
      );
      navigate(`/checkout#${result.acceptanceToken}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-journey">
      <div className="public-brand">
        <Logo />
        <span>{form?.workspaceName}</span>
      </div>
      <div className="public-grid">
        <section className="public-story">
          <span className="eyebrow">YOUR NEXT STEP</span>
          <h1>
            Build a career
            <br />
            with confidence.
          </h1>
          <p>
            Tell {form?.workspaceName ?? "our team"} what you’re looking for. A
            counselor will help you choose the right next step.
          </p>
          <div className="public-step">
            <span>01</span>
            <div>
              <strong>Make an enquiry</strong>
              <p>Share your course interest and contact details.</p>
            </div>
          </div>
          <div className="public-step">
            <span>02</span>
            <div>
              <strong>Talk to your counselor</strong>
              <p>Discuss your goals and arrange a demo.</p>
            </div>
          </div>
          <div className="public-step">
            <span>03</span>
            <div>
              <strong>Confirm your place</strong>
              <p>Complete payment when you are ready.</p>
            </div>
          </div>
        </section>
        <section className="panel padded public-card">
          <span className="eyebrow">{form?.name ?? "COURSE ENQUIRY"}</span>
          <h2>{form?.course ?? "Start your journey"}</h2>
          {error && <ErrorBox message={error} />}
          {!form ? (
            !error && <Loading />
          ) : (
            <form
              onSubmit={submit}
              onFocus={() => {
                if (tracking && !started.current) {
                  started.current = true;
                  void record("started");
                }
              }}
            >
              <Field label="Full name">
                <input
                  name="name"
                  className="form-control"
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  required
                />
              </Field>
              <Field label="Email address">
                <input
                  name="email"
                  className="form-control"
                  type="email"
                  autoComplete="email"
                  required
                />
              </Field>
              <Field
                label="Mobile number"
                hint="Include your country code, for example +91."
              >
                <input
                  name="phone"
                  className="form-control"
                  type="tel"
                  pattern="\+[1-9][0-9]{7,14}"
                  autoComplete="tel"
                />
              </Field>
              <div className="honeypot" aria-hidden="true">
                <label>
                  Website
                  <input name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <label className="consent-row">
                <input type="checkbox" name="privacyConsent" required />
                <span>
                  I agree to share these details with {form.workspaceName} to
                  respond to my enquiry.
                </span>
              </label>
              <label className="consent-row">
                <input type="checkbox" name="marketingConsent" />
                <span>
                  I agree to receive course follow-ups by call, WhatsApp or
                  email. I can withdraw this consent.
                </span>
              </label>
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={tracking}
                  onChange={(e) => {
                    setTracking(e.target.checked);
                    if (e.target.checked) {
                      void record("viewed");
                      started.current = false;
                    }
                  }}
                />
                <span>
                  Allow measurement of this form visit and its source. This is
                  optional.
                </span>
              </label>
              {tracking && (
                <label className="consent-row">
                  <input type="checkbox" name="adConsent" />
                  <span>
                    Allow sharing conversion events and matching identifiers
                    with Meta or Google to measure advertising performance. This
                    is optional.
                  </span>
                </label>
              )}
              <button className="btn btn-primary w-100 mt-3" disabled={busy}>
                {busy ? "Sending…" : "Send enquiry"}
                <ArrowRight size={17} />
              </button>
              <p className="small-note mt-3">
                <ShieldCheck size={15} /> Your enquiry is free. Payment is a
                separate step.
              </p>
            </form>
          )}
        </section>
      </div>
      <footer>
        Powered by RevenuePilot AI ·{" "}
        {form?.sandboxAvailable
          ? "Local preview — sandbox payments only unless a provider is explicitly connected"
          : "Secure enquiry and payment tracking"}
      </footer>
    </main>
  );
}
export function PublicCheckout() {
  const token = useRef(window.location.hash.slice(1));
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [paid, setPaid] = useState(false),
    [withdrawn, setWithdrawn] = useState(false);
  useEffect(() => {
    mutate("/public/checkout/status", { acceptanceToken: token.current })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  async function pay() {
    setBusy(true);
    setError("");
    try {
      const result: any = await mutate(
        data.sandbox ? "/public/checkout/simulate" : "/public/checkout/start",
        { acceptanceToken: token.current },
      );
      if (result.status === "paid") setPaid(true);
      else if (result.status === "refunded") {
        setPaid(false);
        setData({ ...data, order: { ...data.order, status: "refunded" } });
      } else if (result.url) {
        const url = new URL(result.url);
        if (
          url.protocol !== "https:" ||
          !["checkout.stripe.com", "rzp.io"].includes(url.hostname)
        )
          throw new Error(
            "The payment provider returned an unexpected checkout address. Contact the workspace.",
          );
        window.location.assign(url.href);
      } else
        setError(
          "Checkout is awaiting reconciliation. Contact the workspace before starting another payment.",
        );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-journey">
      <div className="public-brand">
        <Logo />
      </div>
      <section className="panel padded checkout-card">
        <span className="success-symbol">
          <CheckCircle2 size={30} />
        </span>
        <h1>
          {paid || data?.order?.status === "paid"
            ? "Payment recorded"
            : "Your enquiry is received"}
        </h1>
        <p>
          Your counselor can now follow up. You can arrange a demo before
          deciding to enroll.
        </p>
        {error && <ErrorBox message={error} />}
        {data && (
          <>
            <div className="checkout-summary">
              <span>{data.course}</span>
              <strong>{formatMoney(data.amountMinor, data.currency)}</strong>
            </div>
            {data.mode === "test" && (
              <div className="info-strip">
                Provider test mode. This does not collect real money.
              </div>
            )}
            {data.order?.status === "refunded" && (
              <div className="info-strip">
                This payment has been refunded. Contact your counselor to review
                enrollment.
              </div>
            )}
            {data.sandbox && (
              <div className="info-strip">
                Sandbox checkout. No money is charged. This creates clearly
                labeled sample payment and enrollment evidence.
              </div>
            )}
            {paid || data.order?.status === "paid" ? (
              <p className="success-box">
                {data.sandbox
                  ? "Sandbox enrollment confirmed."
                  : "Payment-backed enrollment confirmed."}
              </p>
            ) : (
              <button
                className="btn btn-primary w-100"
                onClick={pay}
                disabled={busy || data.order?.status === "refunded"}
              >
                {busy
                  ? "Processing…"
                  : data.sandbox
                    ? "Simulate successful payment"
                    : "Continue to secure checkout"}
                <ArrowRight size={17} />
              </button>
            )}
          </>
        )}
        <div className="mt-4">
          {withdrawn ? (
            <p className="success-box">
              Optional follow-up and advertising consent withdrawn.
            </p>
          ) : (
            data && (
              <button
                className="btn btn-link"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await mutate("/public/checkout/withdraw-consent", {
                      acceptanceToken: token.current,
                    });
                    setWithdrawn(true);
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Withdraw optional follow-up and advertising consent
              </button>
            )
          )}
        </div>
        <Link to="/" className="back-link mt-4">
          Return to RevenuePilot
        </Link>
      </section>
    </main>
  );
}
export function PaymentReturn() {
  return (
    <main className="public-journey">
      <Logo />
      <section className="panel padded checkout-card">
        <h1>Checking your payment</h1>
        <p>
          Your payment provider will send confirmation directly to the
          workspace. Returning to this page alone does not confirm a successful
          payment.
        </p>
        <p>
          Your counselor can check the order status. Please avoid paying again
          while confirmation is pending.
        </p>
        <Link to="/" className="btn btn-outline-secondary">
          Return to RevenuePilot
        </Link>
      </section>
    </main>
  );
}
export function ForgotPassword() {
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="public-journey">
      <Logo />
      <section className="panel padded checkout-card">
        <h1>Recover your account</h1>
        <p>Enter the email address you use for RevenuePilot.</p>
        {error && <ErrorBox message={error} />}
        {message ? (
          <p className="success-box">{message}</p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const email = new FormData(e.currentTarget).get("email");
              setBusy(true);
              try {
                const result = await mutate<{ message: string }>(
                  "/auth/forgot-password",
                  { email },
                );
                setMessage(result.message);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Work email">
              <input
                type="email"
                name="email"
                className="form-control"
                autoComplete="email"
                required
              />
            </Field>
            <button className="btn btn-primary" disabled={busy}>
              Send recovery link
            </button>
          </form>
        )}
        <Link to="/" className="back-link mt-4">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
export function AccountLink({ signedIn }: { signedIn: boolean }) {
  const { action } = useParams(),
    token = useRef(window.location.hash.slice(1));
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const endpoint =
        action === "reset"
          ? "/auth/reset-password"
          : action === "verify"
            ? "/auth/verify-email"
            : "/auth/invites/accept";
      await mutate(endpoint, {
        token: token.current,
        ...(action === "reset" ? { password: values.password } : {}),
      });
      setMessage(
        action === "reset"
          ? "Password updated. Sign in again."
          : action === "verify"
            ? "Email verified."
            : "Workspace invitation accepted.",
      );
      history.replaceState(null, "", window.location.pathname);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!["reset", "verify", "invite"].includes(action ?? ""))
    return <PaymentReturn />;
  return (
    <main className="public-journey">
      <Logo />
      <section className="panel padded checkout-card">
        <h1>
          {action === "reset"
            ? "Reset your password"
            : action === "verify"
              ? "Verify your email"
              : "Join your workspace"}
        </h1>
        {error && <ErrorBox message={error} />}
        {message ? (
          <>
            <p className="success-box">{message}</p>
            <a className="btn btn-primary" href="/">
              Continue
            </a>
          </>
        ) : action === "invite" && !signedIn ? (
          <p>
            Sign in or create an account using the invited email address, then
            reopen this invitation. <Link to="/">Go to sign in</Link>
          </p>
        ) : (
          <form onSubmit={submit}>
            {action === "reset" && (
              <Field label="New password">
                <input
                  className="form-control"
                  type="password"
                  name="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </Field>
            )}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Updating…" : "Confirm and continue"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
