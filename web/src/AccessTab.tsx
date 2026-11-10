import { useState } from "react";
import { Badge, Confirm, Empty, Icon, Loading, Notice, TextField, errorText, relTime } from "./components";
import { EMAIL_RE } from "./model";
import { PeoplePicker } from "./PeoplePicker";
import { addTripAccess, removeTripAccess, useMembers } from "./store";
import type { TripCtx } from "./TripDetail";

/**
 * Who can see this trip (owner decision 2026-11-10): ONLY the people on it — the requester, the
 * role holders, people booked on a flight, and anyone given additional access here. The list is
 * worked out by the server from those sources; each person shows why they are on the trip.
 * Anyone on the trip can add people; HOST removes additional access.
 */
export function AccessTab({ ctx }: { ctx: TripCtx }) {
  const { trip, session } = ctx;
  const members = useMembers(trip.id);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ uid?: string; email?: string; label: string } | null>(null);

  const result = (status: string) => setMsg({ tone: "ok", text: status === "already" ? "Already on this trip." : status === "pending" ? "Invited — access on sign-up." : "Access added." });
  async function add(target: { uid?: string; email?: string }) {
    setBusy(true); setMsg(null);
    try { result((await addTripAccess(trip.id, target)).status); setEmail(""); } catch (e) { setMsg({ tone: "bad", text: errorText(e) }); }
    setBusy(false);
  }
  const extraPending = trip.pendingEmails.filter((e) => !Object.values(trip.roles).some((r) => r?.email === e));
  const rolePending = trip.pendingEmails.filter((e) => !extraPending.includes(e));

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Add person</h2>
        <PeoplePicker label="Find someone" exclude={members?.map((m) => m.uid) ?? []} onPick={(p) => add({ uid: p.uid })} />
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <TextField label="Or invite by email" type="email" placeholder="name@example.com" value={email} onChange={setEmail} />
          </div>
          <button className="btn secondary" disabled={busy || !EMAIL_RE.test(email.trim())} onClick={() => add({ email: email.trim().toLowerCase() })}>
            <Icon name="plus" size={16} /> Invite
          </button>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </section>
      <section className="card stack">
        <h2>People on this trip</h2>
        {members === null ? <Loading /> : members.length === 0 && trip.pendingEmails.length === 0 ? <Empty>No one yet</Empty> : (
          <ul className="list">
            {members.map((m) => {
              const extra = m.reasons.includes("Additional access");
              return (
                <li key={m.uid} className="list-item" style={{ flexWrap: "wrap" }}>
                  <Icon name="user" />
                  <span className="grow">
                    <span className="title">{m.name || m.email}</span>
                    <span className="muted small" style={{ display: "block" }}>{m.email}{m.addedAtMs ? ` · ${relTime(m.addedAtMs)}` : ""}</span>
                  </span>
                  <span className="row" style={{ gap: 4 }}>{m.reasons.map((r) => <Badge key={r} tone={r === "Additional access" ? "" : "info"}>{r}</Badge>)}</span>
                  {session.isHost && extra && m.uid !== session.uid && (
                    <button className="icon-btn" aria-label={`Remove additional access for ${m.name}`} onClick={() => setRemoving({ uid: m.uid, label: m.name || m.email })}><Icon name="trash" /></button>
                  )}
                </li>
              );
            })}
            {extraPending.map((e) => (
              <li key={e} className="list-item">
                <Icon name="user" />
                <span className="grow"><span className="title">{e}</span></span>
                <Badge tone="warn">Invited — not signed up</Badge>
                {session.isHost && <button className="icon-btn" aria-label={`Cancel invitation for ${e}`} onClick={() => setRemoving({ email: e, label: e })}><Icon name="trash" /></button>}
              </li>
            ))}
            {rolePending.map((e) => (
              <li key={e} className="list-item">
                <Icon name="user" />
                <span className="grow"><span className="title">{e}</span></span>
                <Badge tone="warn">In a role — not signed up</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
      {removing && <Confirm title="Remove additional access" confirmLabel="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await removeTripAccess(trip.id, removing);
          if (r.stillOnTripAs.length) setMsg({ tone: "ok", text: `${removing.label} is still on the trip as ${r.stillOnTripAs.join(", ")}.` });
        }}>{removing.label}</Confirm>}
    </div>
  );
}
