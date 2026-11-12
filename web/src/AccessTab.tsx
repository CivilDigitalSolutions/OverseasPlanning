import { useState } from "react";
import { Badge, Confirm, Empty, Icon, Loading, Notice, TextField, errorText, relTime } from "./components";
import { EMAIL_RE } from "./model";
import { PeoplePicker } from "./PeoplePicker";
import { addTripAccess, removeTripAccess, useMembers } from "./store";
import type { TripCtx } from "./TripDetail";

/**
 * The People tab — who can see this trip (owner decisions 2026-11-10 and 2026-11-12): ONLY the
 * people on it — the requester, the role holders, people booked on a flight, and anyone given
 * additional access here. The list is worked out by the server from those sources; each person
 * shows their role(s). Anyone on the trip adds people and removes ADDITIONAL access; people in a
 * role, on a flight or the requester stay until that changes (change the role or the flight).
 */
export function AccessTab({ ctx }: { ctx: TripCtx }) {
  const { trip, session } = ctx;
  const members = useMembers(trip.id);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ uid?: string; email?: string; label: string; self?: boolean } | null>(null);

  const result = (status: string) => setMsg({ tone: "ok", text: status === "already" ? "Already on this trip." : status === "pending" ? "Invited — access on sign-up." : "Access added." });
  async function add(target: { uid?: string; email?: string }) {
    setBusy(true); setMsg(null);
    try { result((await addTripAccess(trip.id, target)).status); setEmail(""); } catch (e) { setMsg({ tone: "bad", text: errorText(e) }); }
    setBusy(false);
  }
  const sorted = members ? [...members].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)) : null;
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
        <h2>People on this trip{members ? ` (${members.length + trip.pendingEmails.length})` : ""}</h2>
        {sorted === null ? <Loading /> : sorted.length === 0 && trip.pendingEmails.length === 0 ? <Empty>No one yet</Empty> : (
          <ul className="list">
            {sorted.map((m) => {
              // Only access given here can be removed here; roles and flights are changed where they are set.
              const onlyExtra = m.reasons.length > 0 && m.reasons.every((r) => r === "Additional access");
              return (
                <li key={m.uid} className="list-item" style={{ flexWrap: "wrap" }}>
                  <Icon name="user" />
                  <span className="grow" style={{ minWidth: 160 }}>
                    <span className="title">{m.name || m.email}{m.uid === session.uid && <span className="muted small"> (you)</span>}</span>
                    <span className="muted small" style={{ display: "block", overflowWrap: "anywhere" }}>{m.email}{m.addedAtMs ? ` · ${relTime(m.addedAtMs)}` : ""}</span>
                  </span>
                  <span className="row" style={{ gap: 4 }}>{m.reasons.map((r) => <Badge key={r} tone={r === "Additional access" ? "" : "info"}>{r}</Badge>)}</span>
                  {onlyExtra && (
                    <button className="btn ghost small" aria-label={`Remove access for ${m.name || m.email}`}
                      onClick={() => setRemoving({ uid: m.uid, label: m.name || m.email, self: m.uid === session.uid })}><Icon name="trash" size={16} /> Remove</button>
                  )}
                </li>
              );
            })}
            {extraPending.map((e) => (
              <li key={e} className="list-item" style={{ flexWrap: "wrap" }}>
                <Icon name="user" />
                <span className="grow" style={{ minWidth: 160 }}><span className="title" style={{ overflowWrap: "anywhere" }}>{e}</span></span>
                <Badge tone="warn">Invited — not signed up</Badge>
                <button className="btn ghost small" aria-label={`Remove invitation for ${e}`} onClick={() => setRemoving({ email: e, label: e })}><Icon name="trash" size={16} /> Remove</button>
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
      {removing && <Confirm title="Remove access" confirmLabel="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await removeTripAccess(trip.id, { uid: removing.uid, email: removing.email });
          if (r.stillOnTripAs.length) setMsg({ tone: "ok", text: `${removing.label} is still on the trip as ${r.stillOnTripAs.join(", ")}.` });
          else setMsg({ tone: "ok", text: `${removing.label} removed.` });
        }}>
        <p style={{ margin: 0 }}><strong>{removing.label}</strong>{removing.self ? " — you will no longer see this trip." : ""}</p>
      </Confirm>}
    </div>
  );
}
