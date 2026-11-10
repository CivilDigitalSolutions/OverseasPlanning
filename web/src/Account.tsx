import { sendPasswordResetEmail } from "firebase/auth";
import { useEffect, useState } from "react";
import { Confirm, Icon, Notice, errorText, relTime } from "./components";
import { auth } from "./firebase";
import { addPasskey, biometricAvailable, deletePasskey, deviceLabel, listPasskeys, passkeysSupported, type PasskeyInfo } from "./passkeys";
import { type Session } from "./store";

export function Account({ session }: { session: Session }) {
  return (
    <>
      <div className="page-head"><h1>Account</h1></div>
      <section className="card stack">
        <dl className="kv"><dt>Name</dt><dd>{session.name}</dd><dt>Email</dt><dd>{session.email}</dd><dt>Role</dt><dd>{[session.isHost && "HOST", session.isController && "Controller"].filter(Boolean).join(", ") || "Member"}</dd></dl>
        <PasswordReset email={session.email} />
      </section>
      <Passkeys />
    </>
  );
}

function PasswordReset({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  return sent ? <Notice tone="ok">Reset link sent.</Notice> : (
    <button className="btn secondary" style={{ justifySelf: "start" }} onClick={async () => {
      await sendPasswordResetEmail(auth, email, { url: `${location.origin}/` }).catch(() => undefined); setSent(true);
    }}>Change password</button>
  );
}

function Passkeys() {
  const [list, setList] = useState<PasskeyInfo[] | null>(null);
  const [bio, setBio] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null);
  const load = () => listPasskeys().then(setList, () => setList([]));
  useEffect(() => { load(); biometricAvailable().then(setBio); }, []);
  if (!passkeysSupported()) return null;
  return (
    <section className="card stack">
      <div className="row"><h2 style={{ flex: 1 }}>Fingerprint, face &amp; passkeys</h2>
        <button className="btn small" disabled={busy} onClick={async () => {
          setBusy(true); setErr("");
          try { if (await addPasskey(deviceLabel())) await load(); } catch (e) { setErr(errorText(e)); }
          setBusy(false);
        }}><Icon name="plus" size={16} /> Add {bio ? "this device" : "passkey"}</button>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {list && list.length > 0 && (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id} className="list-item">
              <Icon name="key" />
              <span className="grow"><span className="title">{p.label}</span>
                <span className="muted small" style={{ display: "block" }}>Added {relTime(p.createdAtMs)}{p.lastUsedAtMs ? ` · Used ${relTime(p.lastUsedAtMs)}` : ""}</span></span>
              <button className="icon-btn" aria-label={`Remove ${p.label}`} onClick={() => setRemoving(p)}><Icon name="trash" /></button>
            </li>
          ))}
        </ul>
      )}
      {removing && <Confirm title="Remove passkey" confirmLabel="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={async () => { await deletePasskey(removing.id); await load(); }}>{removing.label}</Confirm>}
    </section>
  );
}
