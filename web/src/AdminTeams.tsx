import { useState } from "react";
import { Confirm, Empty, Icon, Loading, Modal, Notice, TextField, errorText, navigate } from "./components";
import { validateTeamName, type Team } from "./model";
import { addTeam, deleteTeam, renameTeam, useTeams, type Session } from "./store";

/**
 * Teams (owner decision 2026-11-12): the team on a trip request is picked from this list, which
 * only Administrators manage. Renaming or removing a team does not change trips already raised.
 */
export function AdminTabs({ current }: { current: "accounts" | "teams" }) {
  return (
    <div className="tabs" role="tablist" aria-label="Settings" style={{ marginBottom: 12 }}>
      <button role="tab" aria-selected={current === "accounts"} onClick={() => navigate("/admin")}>Accounts</button>
      <button role="tab" aria-selected={current === "teams"} onClick={() => navigate("/admin/teams")}>Teams</button>
    </div>
  );
}

export function AdminTeams({ session }: { session: Session }) {
  const teams = useTeams();
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const [removing, setRemoving] = useState<Team | null>(null);
  if (!session.isAdmin) return <Notice tone="bad">Administrators only.</Notice>;
  return (
    <>
      <AdminTabs current="teams" />
      <div className="page-head">
        <h1>Teams</h1><span className="spacer" />
        <button className="btn" onClick={() => setEditing("new")}><Icon name="plus" size={16} /> New team</button>
      </div>
      {teams === null ? <Loading /> : teams.length === 0 ? <Empty>No teams</Empty> : (
        <ul className="list">
          {teams.map((t) => (
            <li key={t.id} className="card row" style={{ alignItems: "center" }}>
              <span style={{ flex: 1, fontWeight: 650, overflowWrap: "anywhere" }}>{t.name}</span>
              <button className="btn ghost small" onClick={() => setEditing(t)}><Icon name="edit" size={16} /> Rename</button>
              <button className="btn ghost small" onClick={() => setRemoving(t)}><Icon name="trash" size={16} /> Remove</button>
            </li>
          ))}
        </ul>
      )}
      {editing && <TeamEditor session={session} team={editing === "new" ? null : editing} teams={teams ?? []} onClose={() => setEditing(null)} />}
      {removing && (
        <Confirm title="Remove team" confirmLabel="Remove" danger onClose={() => setRemoving(null)} onConfirm={() => deleteTeam(removing.id)}>
          <p style={{ margin: 0 }}><strong>{removing.name}</strong> will no longer be offered. Existing trips keep it.</p>
        </Confirm>
      )}
    </>
  );
}

function TeamEditor({ session, team, teams, onClose }: { session: Session; team: Team | null; teams: Team[]; onClose: () => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const e = validateTeamName(name, teams, team?.id ?? null);
    if (e) { setErr(e); return; }
    setBusy(true);
    try { await (team ? renameTeam(session, team, name) : addTeam(session, name)); onClose(); }
    catch (e2) { setErr(errorText(e2)); setBusy(false); }
  }
  return (
    <Modal title={team ? "Rename team" : "New team"} onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="stack">
        <TextField label="Team name" placeholder="e.g. T101" value={name} onChange={(v) => { setName(v); setErr(""); }} maxLength={40} error={err} />
      </div>
    </Modal>
  );
}
