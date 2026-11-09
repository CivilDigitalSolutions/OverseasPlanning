import {
  applyActionCode, confirmPasswordReset, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updateProfile, verifyPasswordResetCode,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Checkbox, Icon, Link, Notice, TextField, navigate } from "./components";
import { auth, db } from "./firebase";
import { EMAIL_RE } from "./model";
import { passkeysSupported, signInWithPasskey } from "./passkeys";
import { recordAgreement, refreshSession, syncPendingAccess, type Session } from "./store";

/**
 * Sign-in, sign-up, email verification, password reset (spec §2).
 * Every sign-in requires ticking the terms + privacy agreement, and the agreement is RECORDED
 * server-side (recordAgreement: time, IP, user agent, versions). If the record cannot be written
 * the person is signed out again — no record, no sign-in.
 */

const MIN_PASSWORD = 10;

function authError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(code)) return "Email or password is incorrect.";
  if (code === "auth/too-many-requests") return "Too many attempts. Try again later.";
  if (code === "auth/email-already-in-use") return "An account already exists for that email.";
  if (code === "auth/weak-password") return `Use at least ${MIN_PASSWORD} characters.`;
  if (code === "auth/network-request-failed") return "No connection. Try again.";
  if (code === "auth/expired-action-code") return "This link has expired.";
  if (code === "auth/invalid-action-code") return "This link is invalid or already used.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Record the agreement for this sign-in, or undo the sign-in. */
async function afterSignIn(method: "signup" | "password" | "passkey") {
  try {
    await recordAgreement(method);
  } catch {
    await signOut(auth);
    throw new Error("Your agreement could not be recorded, so you have not been signed in. Try again.");
  }
}

function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-logo"><img src="/icons/icon-192.png" alt="" /><h1>{title}</h1></div>
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
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await afterSignIn("password");
    } catch (e2) { setErr(authError(e2)); setBusy(false); }
  }

  async function passkey() {
    setErr("");
    if (!need()) return;
    setBusy(true);
    try {
      if (await signInWithPasskey()) await afterSignIn("passkey");
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
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim().slice(0, 80) });
      await setDoc(doc(db, "users", cred.user.uid), { name: name.trim().slice(0, 80), email: cred.user.email, createdAt: serverTimestamp() });
      await afterSignIn("signup");
      await sendEmailVerification(cred.user, { url: `${location.origin}/` }).catch(() => undefined);
      await cred.user.getIdToken(true);
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
          try { await sendEmailVerification(session.user, { url: `${location.origin}/` }); setMsg({ tone: "ok", text: "Email sent." }); }
          catch (e) { setMsg({ tone: "bad", text: authError(e) }); }
        }}>Resend email</button>
        <button className="btn ghost block" onClick={() => signOut(auth)}>Sign out</button>
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
        await sendPasswordResetEmail(auth, email.trim(), { url: `${location.origin}/` }).catch(() => undefined);
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

/**
 * Handles the links in the verification and reset emails. Set the Firebase console's email
 * template Action URL to https://<host>/auth/action (docs/SETUP.md).
 */
export function AuthAction() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  const code = params.get("oobCode") ?? "";
  const [state, setState] = useState<"working" | "done" | "form" | "error">("working");
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  useEffect(() => {
    if (mode === "verifyEmail") {
      applyActionCode(auth, code).then(() => setState("done"), async (e) => {
        // A second click / mail-scanner prefetch already applied it: check the account instead.
        if (auth.currentUser && await refreshSession().catch(() => false)) setState("done");
        else { setErr(authError(e)); setState("error"); }
      });
    } else if (mode === "resetPassword") {
      verifyPasswordResetCode(auth, code).then((em) => { setEmail(em); setState("form"); }, (e) => { setErr(authError(e)); setState("error"); });
    } else { setErr("This link is invalid."); setState("error"); }
  }, [mode, code]);

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
        try { await confirmPasswordReset(auth, code, pw); setState("done"); } catch (e2) { setErr(authError(e2)); }
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
