import { useState } from "react";
import { Badge, Confirm, Empty, Icon, Loading, Notice, TextField, errorText, relTime } from "./components";
import { EMAIL_RE, TRIP_ROLES } from "./model";
import { addTripAccess, removeTripAccess, useMembers, type MemberProfile } from "./store";
import type { TripCtx } from "./TripDetail";

/**
 * Additional access: anyone who can see the trip can add someone else by email. An email with no
 * account yet is held as pending and granted when that person signs up and confirms the address.
 * Only HOST removes access.
 */
export function AccessTab({ ctx }: { ctx: TripCtx }) {
  const { trip, session } = ctx;
  const members = useMembers(trip.id);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ uid?: string; email?: string; label: string } | null>(null);

  const roleOf = (m: MemberProfile) => TRIP_ROLES.filter((r) => trip.roles[r.key]?.uid === m.uid).map((r) => r.label);

  async function add() {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setMsg({ tone: "bad", text: "Enter a valid email." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await addTripAccess(trip.id, e, name.trim());
      setMsg({ tone: "ok", text: r.status === "already" ? "Already has access." : r.status === "pending" ? "Invited — access on sign-up." : "Access added." });
      setEmail(""); setName("");
    } catch (err) { setMsg({ tone: "bad", text: errorText(err) }); }
    setBusy(false);
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Add person</h2>
        <div className="grid2">
          <TextField label="Email" type="email" placeholder="name@example.com" value={email} onChange={setEmail} />
          <TextField label="Name" placeholder="Optional" value={name} onChange={setName} maxLength={80} />
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button className="btn" style={{ justifySelf: "start" }} disabled={busy} onClick={add}><Icon name="plus" size={16} /> Give access</button>
      </section>
      <section className="card stack">
        <h2>People with access</h2>
        {members === null ? <Loading /> : members.length === 0 && trip.pendingEmails.length === 0 ? <Empty>No one yet</Empty> : (
          <ul className="list">
            {members.map((m) => (
              <li key={m.uid} className="list-item">
                <Icon name="user" />
                <span className="grow">
                  <span className="title">{m.name || m.email}</span>
                  <span className="muted small" style={{ display: "block" }}>{m.email}{m.addedByName ? ` · added by ${m.addedByName}` : ""} {relTime(m.addedAtMs)}</span>
                </span>
                {roleOf(m).map((r) => <Badge key={r} tone="info">{r}</Badge>)}
                {session.isHost && m.uid !== session.uid && <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => setRemoving({ uid: m.uid, label: m.name || m.email })}><Icon name="trash" /></button>}
              </li>
            ))}
            {trip.pendingEmails.map((e) => (
              <li key={e} className="list-item">
                <Icon name="user" />
                <span className="grow"><span className="title">{e}</span></span>
                <Badge tone="warn">Pending sign-up</Badge>
                {session.isHost && <button className="icon-btn" aria-label={`Remove ${e}`} onClick={() => setRemoving({ email: e, label: e })}><Icon name="trash" /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {removing && <Confirm title="Remove access" confirmLabel="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={() => removeTripAccess(trip.id, removing)}>{removing.label}</Confirm>}
    </div>
  );
}
