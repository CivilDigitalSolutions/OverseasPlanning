import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Checkbox, Icon, Link, Notice, TextField, navigate } from "../components";
import { EMBLEM_BLACK, WORDMARK_BLACK } from "../brand";
import { EMAIL_RE } from "../model";
import { api, resetCsrf } from "./client";
import { passkeysSupported, signInWithPasskey } from "./passkeys";
import { refreshSession, reloadSession, signOutApi, syncPendingAccess, type Session } from "./store";

/**
 * Sign-in, sign-up, email verification, password reset (spec §2) against the Laravel API — the
 * same screens as ../Auth.tsx. Every sign-in carries the terms + privacy agreement and the SERVER
 * records it in the same request: no record, no session.
 */

const MIN_PASSWORD = 10;

/** The server's own message (it never reveals whether an account exists). */
const authError = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

/** After a session starts: fresh CSRF token, then load who is signed in. */
async function afterSignIn() {
  resetCsrf();
  await reloadSession();
}

function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-logo">
          <img src={EMBLEM_BLACK} alt="" className="auth-emblem" />
          <img src={WORDMARK_BLACK} alt="Voyager Trip Manager" className="auth-wordmark" />
        </div>
        <h1 className="auth-title">{title}</h1>
        {children}
      </div>
    </div>
  );
}

const AgreeLabel = () => (
  <>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></>
);

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [agreeErr, setAgreeErr] = useState(false);

  const need = () => { if (!agree) { setAgreeErr(true); return false; } return true; };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (!need()) return;
    setBusy(true);
    try {
      await api("POST", "auth/login", { email: email.trim(), password, agree: true });
      await afterSignIn();
    } catch (e2) { setErr(authError(e2)); setBusy(false); }
  }

  async function passkey() {
    setErr("");
    if (!need()) return;
    setBusy(true);
    try {
      if (await signInWithPasskey()) await afterSignIn();
      else setBusy(false);
    } catch (e2) { setErr(authError(e2)); setBusy(false); }
  }

  return (
    <AuthFrame title="Sign in">
      <form className="stack" onSubmit={submit} noValidate>
        <TextField label="Email" type="email" autoComplete="username webauthn" placeholder="name@example.com" value={email} onChange={setEmail} />
        <TextField label="Password" type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={setPassword} />
        <div className="row" style={{ justifyContent: "flex-end" }}><Link to="/forgot-password" className="small">Forgot password?</Link></div>
        <Checkbox checked={agree} onChange={(v) => { setAgree(v); setAgreeErr(false); }}><AgreeLabel /></Checkbox>
        {agreeErr && <span className="error small" role="alert" style={{ color: "var(--bad)" }}>Tick to agree before signing in.</span>}
        {err && <Notice tone="bad">{err}</Notice>}
        <button className="btn block" disabled={busy || !email || !password}>Sign in</button>
        {passkeysSupported() && <>
          <div className="divider">or</div>
          <button type="button" className="btn secondary block" disabled={busy} onClick={passkey}>
            <Icon name="key" /> Fingerprint, face or passkey
          </button>
        </>}
        <p className="muted small" style={{ textAlign: "center", margin: 0 }}>New here? <Link to="/signup">Create an account</Link></p>
      </form>
    </AuthFrame>
  );
}

export function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!name.trim()) v.name = "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) v.email = "Enter a valid email.";
    if (password.length < MIN_PASSWORD) v.password = `At least ${MIN_PASSWORD} characters.`;
    if (confirm !== password) v.confirm = "Passwords don't match.";
    if (!agree) v.agree = "Tick to agree.";
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true); setErr("");
    try {
      // The server sends the confirmation email and records the agreement.
      await api("POST", "auth/register", { name: name.trim().slice(0, 80), email: email.trim(), password, agree: true });
      await afterSignIn();
      navigate("/", true);
    } catch (e2) { setErr(authError(e2)); setBusy(false); }
  }

  return (
    <AuthFrame title="Create account">
      <form className="stack" onSubmit={submit} noValidate>
        <TextField label="Full name" autoComplete="name" placeholder="Jane Smith" value={name} onChange={setName} error={errors.name} />
        <TextField label="Email" type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={setEmail} error={errors.email} />
        <TextField label="Password" type="password" autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} value={password} onChange={setPassword} error={errors.password} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" placeholder="Repeat password" value={confirm} onChange={setConfirm} error={errors.confirm} />
        <Checkbox checked={agree} onChange={setAgree}><AgreeLabel /></Checkbox>
        {errors.agree && <span className="small" role="alert" style={{ color: "var(--bad)" }}>{errors.agree}</span>}
        {err && <Notice tone="bad">{err}</Notice>}
        <button className="btn block" disabled={busy}>Create account</button>
        <p className="muted small" style={{ textAlign: "center", margin: 0 }}>Have an account? <Link to="/">Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}

/** Shown after sign-in until the email address is confirmed. */
export function VerifyEmail({ session }: { session: Session }) {
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame title="Confirm your email">
      <div className="stack">
        <p style={{ margin: 0, textAlign: "center" }}><strong>{session.email}</strong></p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button className="btn block" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            if (await refreshSession()) { await syncPendingAccess().catch(() => undefined); location.reload(); }
            else setMsg({ tone: "bad", text: "Not confirmed yet." });
          } finally { setBusy(false); }
        }}>I've confirmed</button>
        <button className="btn secondary block" disabled={busy} onClick={async () => {
          try { await api("POST", "auth/verify-email/resend"); setMsg({ tone: "ok", text: "Email sent." }); }
          catch (e) { setMsg({ tone: "bad", text: authError(e) }); }
        }}>Resend email</button>
        <button className="btn ghost block" onClick={() => signOutApi()}>Sign out</button>
      </div>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame title="Reset password">
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        // Same answer whether or not the account exists, so this can't be used to find accounts.
        await api("POST", "auth/forgot-password", { email: email.trim() }).catch(() => undefined);
        setSent(true); setBusy(false);
      }}>
        <TextField label="Email" type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={setEmail} />
        {sent && <Notice tone="ok">If an account exists, a reset link is on its way.</Notice>}
        <button className="btn block" disabled={busy || !EMAIL_RE.test(email.trim())}>Send reset link</button>
        <Link to="/" className="small">Back to sign in</Link>
      </form>
    </AuthFrame>
  );
}

/** Handles the links in the confirmation and reset emails sent by the API. */
export function AuthAction() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  const p = (k: string) => params.get(k) ?? "";
  const [state, setState] = useState<"working" | "done" | "form" | "error">("working");
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  useEffect(() => {
    if (mode === "verifyEmail") {
      api("POST", "auth/verify-email", { id: p("id"), hash: p("hash"), expires: p("expires"), signature: p("signature") })
        .then(() => { void refreshSession(); setState("done"); }, (e) => { setErr(authError(e)); setState("error"); });
    } else if (mode === "resetPassword") {
      api<{ email: string }>("POST", "auth/reset-password/check", { email: p("email"), token: p("token") })
        .then((r) => { setEmail(r.email); setState("form"); }, (e) => { setErr(authError(e)); setState("error"); });
    } else { setErr("This link is invalid."); setState("error"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  if (state === "working") return <AuthFrame title="One moment…"><span /></AuthFrame>;
  if (state === "error") return <AuthFrame title="Link problem"><div className="stack"><Notice tone="bad">{err}</Notice><Link to="/">Back to sign in</Link></div></AuthFrame>;
  if (state === "done") {
    return (
      <AuthFrame title={mode === "verifyEmail" ? "Email confirmed" : "Password changed"}>
        <button className="btn block" onClick={() => { location.href = "/"; }}>Continue</button>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="New password">
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < MIN_PASSWORD) { setErr(`At least ${MIN_PASSWORD} characters.`); return; }
        if (pw !== pw2) { setErr("Passwords don't match."); return; }
        try { await api("POST", "auth/reset-password", { email, token: p("token"), password: pw }); setState("done"); } catch (e2) { setErr(authError(e2)); }
      }}>
        <p className="muted" style={{ margin: 0 }}>{email}</p>
        <TextField label="New password" type="password" autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} value={pw} onChange={setPw} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" placeholder="Repeat password" value={pw2} onChange={setPw2} />
        {err && <Notice tone="bad">{err}</Notice>}
        <button className="btn block">Save password</button>
      </form>
    </AuthFrame>
  );
}
