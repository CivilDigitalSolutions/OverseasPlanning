/**
 * DEMO sign-in screens. Same look and flow as ../Auth.tsx, but no Firebase: accounts live in the
 * demo store and email links / biometrics are simulated on screen (an artifact frame can reach
 * neither an email inbox nor WebAuthn). The terms agreement is still required and recorded.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Checkbox, Icon, Link, Modal, Notice, TextField, navigate } from "../components";
import { ICON } from "../brand";
import { EMAIL_RE } from "../model";
import { be } from "./backend";
import { accountPath, recordAgreement, setSignedIn, syncPendingAccess, toAccount, type Session } from "./store";

const MIN_PASSWORD = 10;
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-logo"><img src={ICON} alt="" /><h1>{title}</h1></div>
        {children}
      </div>
    </div>
  );
}

const AgreeLabel = () => (
  <>I agree to the <a href="#terms" onClick={(e) => { e.preventDefault(); navigate("/terms"); }}>Terms</a> and{" "}
    <a href="#privacy" onClick={(e) => { e.preventDefault(); navigate("/privacy"); }}>Privacy Policy</a></>
);

async function finishSignIn(method: "signup" | "password" | "passkey") {
  await recordAgreement(method);
  setSignedIn(true);
  await syncPendingAccess().catch(() => undefined);
  navigate("/", true);
}

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [agreeErr, setAgreeErr] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState(false);

  const need = () => { if (!agree) { setAgreeErr(true); return false; } return true; };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (!need()) return;
    setBusy(true);
    const acc = (await be().get(accountPath()))?.data;
    if (!acc || acc.email !== email.trim().toLowerCase() || acc.pwHash !== await hash(password)) {
      setErr(acc ? "Email or password is incorrect." : "No account yet. Create one first.");
      setBusy(false); return;
    }
    await finishSignIn("password");
  }

  async function passkey() {
    setErr("");
    if (!need()) return;
    const acc = toAccount(await be().get(accountPath()));
    if (!acc || acc.passkeys.length === 0) { setErr("No passkey on this device. Sign in with your password, then add one in Account."); return; }
    setBio(true);
  }

  return (
    <AuthFrame title="Sign in">
      <form className="stack" onSubmit={submit} noValidate>
        <TextField label="Email" type="email" autoComplete="username" placeholder="name@example.com" value={email} onChange={setEmail} />
        <TextField label="Password" type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={setPassword} />
        <div className="row" style={{ justifyContent: "flex-end" }}><Link to="/forgot-password" className="small">Forgot password?</Link></div>
        <Checkbox checked={agree} onChange={(v) => { setAgree(v); setAgreeErr(false); }}><AgreeLabel /></Checkbox>
        {agreeErr && <span className="small" role="alert" style={{ color: "var(--bad)" }}>Tick to agree before signing in.</span>}
        {err && <Notice tone="bad">{err}</Notice>}
        <button className="btn block" disabled={busy || !email || !password}>Sign in</button>
        <div className="divider">or</div>
        <button type="button" className="btn secondary block" disabled={busy} onClick={passkey}><Icon name="key" /> Fingerprint, face or passkey</button>
        <p className="muted small" style={{ textAlign: "center", margin: 0 }}>New here? <Link to="/signup">Create an account</Link></p>
      </form>
      {bio && <BiometricPrompt onCancel={() => setBio(false)} onOk={async () => {
        const acc = toAccount(await be().get(accountPath()));
        if (acc) await be().patch(accountPath(), { passkeys: acc.passkeys.map((p, i) => (i === 0 ? { ...p, lastUsedAtMs: Date.now() } : p)) });
        setBio(false); await finishSignIn("passkey");
      }} />}
    </AuthFrame>
  );
}

/** Stand-in for the device's own fingerprint / face prompt. */
export function BiometricPrompt({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  return (
    <Modal title="Confirm it's you" onClose={onCancel} actions={<><button className="btn secondary" onClick={onCancel}>Cancel</button><button className="btn" onClick={onOk}>Use fingerprint or face</button></>}>
      <div className="stack" style={{ justifyItems: "center", textAlign: "center" }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ color: "var(--primary)" }}>
          <path d="M12 11v3m-4-6a6 6 0 0112 0v4m-14 0V8a8 8 0 0114-5.3M8 18a10 10 0 01-1-4.5V12m8 0v1.5a10 10 0 01-1.5 5.3M12 15.5a14 14 0 01-1.5 5" />
        </svg>
        <span className="muted small">Demo: stands in for your device's prompt</span>
      </div>
    </Modal>
  );
}

export function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    await be().set(accountPath(), {
      name: name.trim().slice(0, 80), email: email.trim().toLowerCase(), emailVerified: false, host: false,
      pwHash: await hash(password), passkeys: [], createdAt: Date.now(),
    });
    await finishSignIn("signup");
  }

  return (
    <AuthFrame title="Create account">
      <form className="stack" onSubmit={submit} noValidate>
        <TextField label="Full name" autoComplete="name" placeholder="Jane Smith" value={name} onChange={setName} error={errors.name} />
        <TextField label="Email" type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={setEmail} error={errors.email} />
        <TextField label="Password" type="password" autoComplete="new-password" placeholder="Demo only — not a real password" value={password} onChange={setPassword} error={errors.password} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" placeholder="Repeat password" value={confirm} onChange={setConfirm} error={errors.confirm} />
        <Checkbox checked={agree} onChange={setAgree}><AgreeLabel /></Checkbox>
        {errors.agree && <span className="small" role="alert" style={{ color: "var(--bad)" }}>{errors.agree}</span>}
        <button className="btn block" disabled={busy}>Create account</button>
        <p className="muted small" style={{ textAlign: "center", margin: 0 }}>Have an account? <Link to="/">Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}

/** Simulated inbox: shows the email the real app would send, with its link. */
function InboxPreview({ subject, action, onAction }: { subject: string; action: string; onAction: () => void }) {
  return (
    <div className="card stack" style={{ background: "var(--bg)", gap: 8 }}>
      <span className="badge info" style={{ justifySelf: "start" }}>Demo inbox</span>
      <strong>{subject}</strong>
      <button className="btn small" style={{ justifySelf: "start" }} onClick={onAction}>{action}</button>
    </div>
  );
}

export function VerifyEmail({ session }: { session: Session }) {
  const [sent, setSent] = useState(true);
  const [msg, setMsg] = useState("");
  return (
    <AuthFrame title="Confirm your email">
      <div className="stack">
        <p style={{ margin: 0, textAlign: "center" }}><strong>{session.email}</strong></p>
        {sent && <InboxPreview subject="Confirm your email address" action="Confirm email" onAction={async () => {
          await be().patch(accountPath(), { emailVerified: true });
          await syncPendingAccess().catch(() => undefined);
        }} />}
        {msg && <Notice tone="bad">{msg}</Notice>}
        <button className="btn block" onClick={async () => {
          const acc = toAccount(await be().get(accountPath()));
          if (!acc?.emailVerified) setMsg("Not confirmed yet.");
        }}>I've confirmed</button>
        <button className="btn secondary block" onClick={() => { setSent(true); setMsg(""); }}>Resend email</button>
        <button className="btn ghost block" onClick={() => setSignedIn(false)}>Sign out</button>
      </div>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<"ask" | "sent" | "reset" | "done">("ask");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  return (
    <AuthFrame title="Reset password">
      {stage === "reset" ? (
        <form className="stack" noValidate onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < MIN_PASSWORD) { setErr(`At least ${MIN_PASSWORD} characters.`); return; }
          await be().patch(accountPath(), { pwHash: await hash(pw) });
          setStage("done");
        }}>
          <TextField label="New password" type="password" autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} value={pw} onChange={setPw} />
          {err && <Notice tone="bad">{err}</Notice>}
          <button className="btn block">Save password</button>
        </form>
      ) : stage === "done" ? (
        <div className="stack"><Notice tone="ok">Password changed.</Notice><Link to="/" className="btn block">Sign in</Link></div>
      ) : (
        <form className="stack" noValidate onSubmit={async (e) => { e.preventDefault(); setStage("sent"); }}>
          <TextField label="Email" type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={setEmail} />
          {stage === "sent" && <>
            <Notice tone="ok">If an account exists, a reset link is on its way.</Notice>
            <ResetLink email={email} onOpen={() => setStage("reset")} />
          </>}
          <button className="btn block" disabled={!EMAIL_RE.test(email.trim())}>Send reset link</button>
          <Link to="/" className="small">Back to sign in</Link>
        </form>
      )}
    </AuthFrame>
  );
}
function ResetLink({ email, onOpen }: { email: string; onOpen: () => void }) {
  const [mine, setMine] = useState(false);
  useEffect(() => {
    let live = true;
    be().get(accountPath()).then((d) => { if (live) setMine(String(d?.data.email ?? "") === email.trim().toLowerCase()); });
    return () => { live = false; };
  }, [email]);
  return mine ? <InboxPreview subject="Reset your password" action="Choose a new password" onAction={onOpen} /> : null;
}

/** Not reachable in the demo (email links are simulated in place). */
export const AuthAction = () => <AuthFrame title="Link"><Link to="/">Back to sign in</Link></AuthFrame>;
