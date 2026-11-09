import { useEffect, useState } from "react";
import { Badge, Checkbox, Empty, Icon, Loading, Notice, TextField, errorText, relTime } from "./components";
import { DECLARATION_TEXT, cleanVaccines, formatDate, type VaccineRecord } from "./model";
import { saveVaccination, useMembers, useVaccinations } from "./store";
import type { TripCtx } from "./TripDetail";

/**
 * Vaccination declarations for everyone travelling. Each traveller completes their own; the Team
 * Leader and HOST see everyone's and who is still missing. Health data — see spec §8 TODOs.
 */
export function VaccinationsTab({ ctx }: { ctx: TripCtx }) {
  const { trip, session, canLead } = ctx;
  const all = useVaccinations(trip.id, session.uid, canLead);
  const members = useMembers(trip.id);
  const mine = all?.find((v) => v.uid === session.uid) ?? null;

  return (
    <div className="stack">
      <MyDeclaration ctx={ctx} existing={mine} loaded={all !== null} />
      {canLead && (
        <section className="card stack">
          <h2>Travellers</h2>
          {all === null || members === null ? <Loading /> : members.length === 0 ? <Empty>No one has access yet</Empty> : (
            <table className="simple">
              <thead><tr><th>Name</th><th>Status</th><th>Vaccinations</th></tr></thead>
              <tbody>
                {members.map((m) => {
                  const d = all.find((v) => v.uid === m.uid);
                  return (
                    <tr key={m.uid}>
                      <td>{m.name || m.email}</td>
                      <td>{d?.declared ? <Badge tone="ok">Declared {relTime(d.declaredAtMs)}</Badge> : d ? <Badge tone="warn">Draft</Badge> : <Badge tone="bad">Missing</Badge>}</td>
                      <td className="small">{d?.vaccines.map((x) => `${x.name}${x.date ? ` (${formatDate(x.date)})` : ""}`).join(", ") || "—"}{d?.notes ? <div className="muted">{d.notes}</div> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

function MyDeclaration({ ctx, existing, loaded }: { ctx: TripCtx; existing: { vaccines: VaccineRecord[]; notes: string; declared: boolean; declaredAtMs: number } | null; loaded: boolean }) {
  const [rows, setRows] = useState<VaccineRecord[]>([{ name: "", date: "" }]);
  const [notes, setNotes] = useState("");
  const [declared, setDeclared] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!existing) return;
    setRows(existing.vaccines.length ? existing.vaccines : [{ name: "", date: "" }]);
    setNotes(existing.notes);
    setDeclared(existing.declared);
  }, [existing?.declaredAtMs, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return <Loading />;
  const setRow = (i: number, k: keyof VaccineRecord) => (v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <section className="card stack">
      <div className="row">
        <h2 style={{ flex: 1 }}>My declaration</h2>
        {existing?.declared ? <Badge tone="ok">Declared {relTime(existing.declaredAtMs)}</Badge> : <Badge tone="warn">Not declared</Badge>}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 160 }}><TextField label="Vaccination" placeholder="e.g. Yellow fever" value={r.name} onChange={setRow(i, "name")} maxLength={80} /></div>
          <div style={{ flex: 1, minWidth: 140 }}><TextField label="Date given" type="date" value={r.date} onChange={setRow(i, "date")} /></div>
          <button className="icon-btn" aria-label="Remove row" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ name: "", date: "" }])}><Icon name="trash" /></button>
        </div>
      ))}
      <button className="btn ghost small" style={{ justifySelf: "start" }} onClick={() => setRows([...rows, { name: "", date: "" }])}><Icon name="plus" size={16} /> Add vaccination</button>
      <TextField label="Notes" multiline placeholder="Optional, e.g. exemptions" value={notes} onChange={setNotes} maxLength={2000} />
      <Checkbox checked={declared} onChange={setDeclared}>{DECLARATION_TEXT}</Checkbox>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="row">
        <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          try { await saveVaccination(ctx.session, ctx.trip.id, cleanVaccines(rows), notes, declared); setMsg({ tone: "ok", text: declared ? "Declaration saved." : "Draft saved." }); }
          catch (e) { setMsg({ tone: "bad", text: errorText(e) }); }
          setBusy(false);
        }}>{declared ? "Submit declaration" : "Save draft"}</button>
      </div>
    </section>
  );
}
