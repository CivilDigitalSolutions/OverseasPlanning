import { useEffect, useState } from "react";
import { Checkbox, Confirm, Empty, Icon, Loading, Modal, Notice, SelectField, TextField, errorText, relTime } from "./components";
import {
  CURRENCIES, FINANCE_CATEGORIES, PAYMENT_METHODS, cleanInjuryRefs, financeTotals, formatDate, formatMoney, parseAmount,
  type FinanceEntry,
} from "./model";
import {
  deleteFinanceEntry, saveDebrief, saveFinanceEntry, saveFinanceNote, useDebrief, useFinanceEntries, useFinanceNotes,
} from "./store";
import type { TripCtx } from "./TripDetail";

export function DebriefTab({ ctx }: { ctx: TripCtx }) {
  const [section, setSection] = useState<"debrief" | "finance">("debrief");
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Debrief sections">
        <button role="tab" aria-selected={section === "debrief"} onClick={() => setSection("debrief")}>Trip debrief</button>
        <button role="tab" aria-selected={section === "finance"} onClick={() => setSection("finance")}>Financial debrief</button>
      </div>
      {section === "debrief" ? <TripDebrief ctx={ctx} /> : <FinancialDebrief ctx={ctx} />}
    </>
  );
}

function TripDebrief({ ctx }: { ctx: TripCtx }) {
  const d = useDebrief(ctx.trip.id);
  const [wentWell, setWentWell] = useState("");
  const [couldBeBetter, setCouldBeBetter] = useState("");
  const [welfare, setWelfare] = useState("");
  const [refs, setRefs] = useState("");
  const [recip, setRecip] = useState(false);
  const [recipDesc, setRecipDesc] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!d) return;
    setWentWell(d.wentWell); setCouldBeBetter(d.couldBeBetter); setWelfare(d.welfareConcerns);
    setRefs(d.injuryRefs.join("\n")); setRecip(d.reciprocityIssues); setRecipDesc(d.reciprocityDescription);
  }, [d?.updatedAtMs, d === null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Loading />;

  return (
    <section className="card stack">
      <TextField label="What went well" multiline value={wentWell} onChange={setWentWell} maxLength={5000} placeholder="Successes, good practice" />
      <TextField label="What could be done better" multiline value={couldBeBetter} onChange={setCouldBeBetter} maxLength={5000} placeholder="Lessons learned" />
      <TextField label="Welfare concerns" multiline value={welfare} onChange={setWelfare} maxLength={5000} placeholder="Any welfare concerns" />
      <TextField label="Injury report reference numbers" multiline rows={2} value={refs} onChange={setRefs} placeholder="One reference per line" />
      <Checkbox checked={recip} onChange={setRecip}>Reciprocity issues</Checkbox>
      {recip && <TextField label="Reciprocity issue description" multiline value={recipDesc} onChange={setRecipDesc} maxLength={5000} placeholder="Describe the issue" />}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="row">
        <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          try {
            await saveDebrief(ctx.session, ctx.trip.id, {
              wentWell: wentWell.trim(), couldBeBetter: couldBeBetter.trim(), welfareConcerns: welfare.trim(), injuryRefs: cleanInjuryRefs(refs),
              reciprocityIssues: recip, reciprocityDescription: recip ? recipDesc.trim() : "",
            });
            setMsg({ tone: "ok", text: "Saved." });
          } catch (e) { setMsg({ tone: "bad", text: errorText(e) }); }
          setBusy(false);
        }}>Save debrief</button>
        {d.updatedAtMs > 0 && <span className="muted small">{d.updatedBy} · {relTime(d.updatedAtMs)}</span>}
      </div>
    </section>
  );
}

/**
 * Financial debrief: every traveller records their own trip notes and finance items (spend, card,
 * claims). Everyone on the trip can see the summary; only the owner (or HOST) edits an entry.
 * TODO(owner): approval/sign-off of claims, budget vs actual, export to the finance system (spec §7).
 */
function FinancialDebrief({ ctx }: { ctx: TripCtx }) {
  const entries = useFinanceEntries(ctx.trip.id);
  const notes = useFinanceNotes(ctx.trip.id);
  const [editing, setEditing] = useState<FinanceEntry | "new" | null>(null);
  const [removing, setRemoving] = useState<FinanceEntry | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const uid = ctx.session.uid;

  useEffect(() => { if (notes && note === null) setNote(notes[uid]?.text ?? ""); }, [notes, note, uid]);
  if (entries === null || notes === null) return <Loading />;

  const mine = entries.filter((e) => e.ownerUid === uid).sort((a, b) => a.date.localeCompare(b.date));
  const totals = financeTotals(entries);
  const people = Array.from(new Set([...entries.map((e) => e.ownerUid), ...Object.keys(notes)]));
  const nameOf = (u: string) => entries.find((e) => e.ownerUid === u)?.ownerName || notes[u]?.name || "Unknown";

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row"><h2 style={{ flex: 1 }}>My finance</h2>
          <button className="btn small" onClick={() => setEditing("new")}><Icon name="plus" size={16} /> Add item</button></div>
        {mine.length === 0 ? <Empty>No items</Empty> : <EntryTable entries={mine} canEdit onEdit={setEditing} onDelete={setRemoving} />}
        <TextField label="My trip record" multiline value={note ?? ""} onChange={setNote} maxLength={5000} placeholder="Notes on your trip and finances" />
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button className="btn secondary" style={{ justifySelf: "start" }} onClick={async () => {
          try { await saveFinanceNote(ctx.session, ctx.trip.id, note ?? ""); setMsg({ tone: "ok", text: "Saved." }); }
          catch (e) { setMsg({ tone: "bad", text: errorText(e) }); }
        }}>Save record</button>
      </section>

      <section className="card stack">
        <h2>Everyone</h2>
        {people.length === 0 ? <Empty>Nothing recorded</Empty> : people.map((p) => (
          <details key={p}>
            <summary style={{ cursor: "pointer", padding: "6px 0" }}>
              <strong>{nameOf(p)}</strong>{" "}
              <span className="muted small">{Object.entries(totals[p] ?? {}).map(([c, a]) => formatMoney(a, c)).join(" · ") || "—"}</span>
            </summary>
            <div className="stack" style={{ paddingTop: 8 }}>
              {notes[p]?.text && <div style={{ whiteSpace: "pre-wrap" }}>{notes[p].text}</div>}
              <EntryTable entries={entries.filter((e) => e.ownerUid === p)} canEdit={ctx.session.isHost && p !== uid} onEdit={setEditing} onDelete={setRemoving} />
            </div>
          </details>
        ))}
      </section>

      {editing && <EntryForm ctx={ctx} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {removing && <Confirm title="Delete item" confirmLabel="Delete" danger onClose={() => setRemoving(null)}
        onConfirm={() => deleteFinanceEntry(ctx.trip.id, removing.id)}>{removing.description}</Confirm>}
    </div>
  );
}

function EntryTable({ entries, canEdit, onEdit, onDelete }: { entries: FinanceEntry[]; canEdit: boolean; onEdit: (e: FinanceEntry) => void; onDelete: (e: FinanceEntry) => void }) {
  if (entries.length === 0) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="simple">
        <thead><tr><th>Date</th><th>Item</th><th>Paid by</th><th className="num">Amount</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.date)}</td>
              <td>{e.description}<div className="muted small">{e.category}{e.receiptRef ? ` · ${e.receiptRef}` : ""}</div></td>
              <td className="small">{e.paymentMethod}</td>
              <td className="num">{formatMoney(e.amount, e.currency)}</td>
              {canEdit && <td style={{ whiteSpace: "nowrap" }}>
                <button className="icon-btn" aria-label="Edit" onClick={() => onEdit(e)}><Icon name="edit" size={16} /></button>
                <button className="icon-btn" aria-label="Delete" onClick={() => onDelete(e)}><Icon name="trash" size={16} /></button>
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryForm({ ctx, entry, onClose }: { ctx: TripCtx; entry: FinanceEntry | null; onClose: () => void }) {
  const [v, setV] = useState({
    date: entry?.date ?? "", category: entry?.category ?? "", description: entry?.description ?? "",
    amount: entry ? String(entry.amount) : "", currency: entry?.currency ?? "GBP", paymentMethod: entry?.paymentMethod ?? "", receiptRef: entry?.receiptRef ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  // HOST may correct someone else's entry; it keeps its owner.
  const owner = entry && entry.ownerUid !== ctx.session.uid ? { ...ctx.session, uid: entry.ownerUid, name: entry.ownerName } : ctx.session;

  async function save() {
    const e: Record<string, string> = {};
    if (!v.description.trim()) e.description = "Enter a description.";
    const amount = parseAmount(v.amount);
    if (amount === null || !v.amount.trim()) e.amount = "Enter an amount.";
    if (!v.category) e.category = "Choose a category.";
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await saveFinanceEntry(owner, ctx.trip.id, entry?.id ?? null, {
        date: v.date, category: v.category, description: v.description.trim().slice(0, 200), amount: amount!, currency: v.currency,
        paymentMethod: v.paymentMethod, receiptRef: v.receiptRef.trim().slice(0, 60),
      });
      onClose();
    } catch (e2) { setErr(errorText(e2)); }
  }

  return (
    <Modal title={entry ? "Edit item" : "Add item"} onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button>
    </>}>
      <div className="stack">
        <TextField label="Description *" placeholder="e.g. Taxi to hotel" value={v.description} onChange={set("description")} maxLength={200} error={errors.description} />
        <div className="grid2">
          <SelectField label="Category *" value={v.category} onChange={set("category")} options={FINANCE_CATEGORIES} error={errors.category} />
          <TextField label="Date" type="date" value={v.date} onChange={set("date")} />
          <TextField label="Amount *" inputMode="decimal" placeholder="0.00" value={v.amount} onChange={set("amount")} error={errors.amount} />
          <SelectField label="Currency" value={v.currency} onChange={set("currency")} options={CURRENCIES} />
          <SelectField label="Paid by" value={v.paymentMethod} onChange={set("paymentMethod")} options={PAYMENT_METHODS} />
          <TextField label="Receipt reference" placeholder="Optional" value={v.receiptRef} onChange={set("receiptRef")} maxLength={60} />
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}
