import { useEffect, useState } from "react";
import { Badge, Checkbox, Confirm, Empty, Icon, Loading, Modal, Notice, TextField, errorText } from "./components";
import { EMAIL_RE } from "./model";
import { personMatches } from "./PeoplePicker";
import { createAccount, deleteManagedAccount, listAccounts, setAccountRoles, type ManagedAccount, type RoleProfiles, type Session } from "./store";

/**
 * Account manager (owner decision 2026-11-10): people with the Administrator permission add people
 * to the app, delete accounts and change role profiles. Reached from the settings cog.
 */
const ROLE_LABELS: { key: keyof RoleProfiles; label: string }[] = [
  { key: "host", label: "HOST" }, { key: "controller", label: "Controller" }, { key: "admin", label: "Administrator" },
];
const NO_ROLES: RoleProfiles = { host: false, controller: false, admin: false };

export function AdminAccounts({ session }: { session: Session }) {
  const [accounts, setAccounts] = useState<ManagedAccount[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ManagedAccount | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const load = () => listAccounts().then(setAccounts, (e) => { setErr(errorText(e)); setAccounts([]); });
  useEffect(() => { if (session.isAdmin) load(); }, [session.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session.isAdmin) return <Notice tone="bad">Administrators only.</Notice>;

  async function toggle(a: ManagedAccount, key: keyof RoleProfiles, on: boolean) {
    const roles = { ...a.roles, [key]: on };
    setSaving(a.uid); setErr("");
    try { await setAccountRoles(a.uid, roles); setAccounts((list) => list?.map((x) => (x.uid === a.uid ? { ...x, roles } : x)) ?? null); }
    catch (e) { setErr(errorText(e)); }
    setSaving(null);
  }

  const list = accounts?.filter((a) => !q.trim() || personMatches(a, q)) ?? null;
  return (
    <>
      <div className="page-head">
        <h1>Accounts</h1><span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> New account</button>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="acct-search" className="sr-only">Search accounts</label>
        <input id="acct-search" type="search" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {list === null ? <Loading /> : list.length === 0 ? <Empty>No accounts</Empty> : (
        <ul className="list">
          {list.map((a) => (
            <li key={a.uid} className="card stack" style={{ gap: 8 }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, overflowWrap: "anywhere" }}>{a.name || "—"}{a.uid === session.uid && <span className="muted small"> (you)</span>}</div>
                  <div className="muted small" style={{ overflowWrap: "anywhere" }}>{a.email}</div>
                </div>
                {a.invited ? <Badge tone="warn">Not signed in yet</Badge> : !a.emailVerified ? <Badge tone="warn">Email not confirmed</Badge> : null}
                {a.disabled && <Badge tone="bad">Disabled</Badge>}
              </div>
              <div className="row" style={{ gap: 14 }}>
                {ROLE_LABELS.map((r) => (
                  <Checkbox key={r.key} checked={a.roles[r.key]} disabled={saving === a.uid || (r.key === "admin" && a.uid === session.uid)}
                    onChange={(v) => toggle(a, r.key, v)}>{r.label}</Checkbox>
                ))}
                <span className="spacer" style={{ flex: 1 }} />
                {a.uid !== session.uid && (
                  <button className="btn ghost small" onClick={() => setDeleting(a)}><Icon name="trash" size={16} /> Delete</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewAccount onClose={() => setCreating(false)} onCreated={load} />}
      {deleting && (
        <Confirm title="Delete account" confirmLabel="Delete account" danger onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteManagedAccount(deleting.uid); await load(); }}>
          <p style={{ margin: 0 }}><strong>{deleting.name || deleting.email}</strong> will lose access to the app and be taken off every trip.</p>
        </Confirm>
      )}
    </>
  );
}

function NewAccount({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<RoleProfiles>(NO_ROLES);
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ setupLink: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function save() {
    const e: typeof errors = {};
    if (!name.trim()) e.name = "Enter a name.";
    if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr("");
    try { const r = await createAccount({ name: name.trim(), email: email.trim().toLowerCase(), roles }); setCreated(r); onCreated(); }
    catch (e2) { setErr(errorText(e2)); }
    setBusy(false);
  }

  if (created) {
    return (
      <Modal title="Account created" onClose={onClose} actions={<button className="btn" onClick={onClose}>Done</button>}>
        <div className="stack">
          <p style={{ margin: 0 }}><strong>{name}</strong> · {email}</p>
          {created.setupLink ? (
            <>
              <TextField label="Set-password link — send this to them" value={created.setupLink} onChange={() => undefined} multiline rows={3} />
              <button className="btn secondary" style={{ justifySelf: "start" }} onClick={async () => {
                try { await navigator.clipboard.writeText(created.setupLink); setCopied(true); } catch { setCopied(false); }
              }}>{copied ? "Copied" : "Copy link"}</button>
            </>
          ) : <Notice>They sign up in the app with this email; their role profiles carry over.</Notice>}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="New account" onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy} onClick={save}>Create account</button>
    </>}>
      <div className="stack">
        <TextField label="Full name *" placeholder="Jane Smith" value={name} onChange={setName} maxLength={80} error={errors.name} />
        <TextField label="Email *" type="email" placeholder="name@example.com" value={email} onChange={setEmail} error={errors.email} />
        <div className="field">
          <span className="label">Role profiles</span>
          <div className="row" style={{ gap: 14 }}>
            {ROLE_LABELS.map((r) => <Checkbox key={r.key} checked={roles[r.key]} onChange={(v) => setRoles({ ...roles, [r.key]: v })}>{r.label}</Checkbox>)}
          </div>
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}
