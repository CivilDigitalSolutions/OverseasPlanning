import { useState } from "react";
import { Badge, Confirm, Empty, Icon, Loading, Modal, Notice, SelectField, TextField, errorText, relTime } from "./components";
import {
  CURRENCIES, REQUEST_KINDS, REQUEST_STATUS_LABEL, formatDate, formatMoney, kindLabel, parseAmount, requestTone, sortTlRequests,
  validateTlRequest, type RequestKind, type TlRequest, type TlRequestStatus,
} from "./model";
import { addTlRequest, completeTlRequest, decideTlRequest, deleteTlRequest, resubmitTlRequest, saveSummary, useSummaries, type Summary, type SummaryRole } from "./store";
import type { TripCtx } from "./TripDetail";

/**
 * Requests to the Team Leader, each with an approval process (spec §6):
 * Authorised by the trip's SPC only: pending → approved / rejected → completed once fulfilled.
 * The person who raised a request may withdraw it while it awaits approval.
 */
const FILTERS: { key: TlRequestStatus | "all"; label: string }[] = [
  { key: "all", label: "All" }, { key: "pending", label: "Awaiting approval" }, { key: "approved", label: "Approved" },
  { key: "completed", label: "Completed" }, { key: "rejected", label: "Rejected" },
];

export function RequestsTab({ ctx, requests }: { ctx: TripCtx; requests: TlRequest[] | null }) {
  const [filter, setFilter] = useState<TlRequestStatus | "all">("all");
  const [kind, setKind] = useState<RequestKind | "">("");
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<{ r: TlRequest; approve: boolean } | null>(null);
  const [completing, setCompleting] = useState<TlRequest | null>(null);
  const [removing, setRemoving] = useState<TlRequest | null>(null);
  const [err, setErr] = useState("");
  const summaries = useSummaries(ctx.trip.id);

  const list = requests ? sortTlRequests(requests).filter((r) => (filter === "all" || r.status === filter) && (!kind || r.kind === kind)) : null;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, requests ? requests.filter((r) => f.key === "all" || r.status === f.key).length : 0]));

  return (
    <>
      <div className="page-head">
        <h2>Requests</h2><span className="spacer" />
        <button className="btn small" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> New request</button>
      </div>
      <div className="grid2" style={{ marginBottom: 14 }}>
        <SummaryBox ctx={ctx} role="teamLeader" title="Team Leader summary" canEdit={ctx.isTeamLeader} summary={summaries?.teamLeader ?? null} />
        <SummaryBox ctx={ctx} role="spc" title="SPC summary" canEdit={ctx.isSpc} summary={summaries?.spc ?? null} />
      </div>
      <div className="tabs" role="tablist" aria-label="Status">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label} <span className="muted small">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      <div style={{ maxWidth: 280, marginBottom: 12 }}>
        <SelectField label="Type" value={kind} onChange={(v) => setKind(v as RequestKind | "")} options={REQUEST_KINDS.map((k) => ({ value: k.key, label: k.label }))} placeholder="All types" />
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {list === null ? <Loading /> : list.length === 0 ? <Empty>No requests</Empty> : (
        <ul className="list">
          {list.map((r) => {
            const mine = r.createdBy === ctx.session.uid;
            return (
              <li key={r.id} className="card stack" style={{ gap: 8 }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">{r.status === "completed" ? "✅" : r.status === "rejected" ? "⛔" : r.status === "approved" ? "👍" : "⏳"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="title" style={{ fontWeight: 650, overflowWrap: "anywhere" }}>{r.title}</div>
                    <div className="muted small">{kindLabel(r.kind)} · {r.createdByName} · {relTime(r.createdAtMs)}</div>
                  </div>
                  <Badge tone={requestTone(r.status)}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
                </div>
                {(r.quantity !== null || r.amount !== null || r.neededBy) && (
                  <div className="row small">
                    {r.quantity !== null && <Badge>Qty {r.quantity}</Badge>}
                    {r.amount !== null && <Badge>{formatMoney(r.amount, r.currency)}</Badge>}
                    {r.neededBy && <Badge>By {formatDate(r.neededBy)}</Badge>}
                  </div>
                )}
                {r.details && <div style={{ whiteSpace: "pre-wrap" }}><span className="muted small">Rationale</span><br />{r.details}</div>}
                {r.decidedByName && (
                  <div className="small" style={{ color: r.status === "rejected" ? "var(--bad)" : "var(--ink-2)" }}>
                    {r.status === "rejected" ? "Rejected" : "Approved"} by {r.decidedByName} · {relTime(r.decidedAtMs)}{r.decisionNote ? ` — ${r.decisionNote}` : ""}
                  </div>
                )}
                {r.status === "completed" && (
                  <div className="small" style={{ color: "var(--ok)" }}>Completed by {r.completedByName} · {relTime(r.completedAtMs)}{r.response ? ` — ${r.response}` : ""}</div>
                )}
                <div className="row">
                  {ctx.isSpc && r.status === "pending" && <>
                    <button className="btn small" onClick={() => setDeciding({ r, approve: true })}>Approve</button>
                    <button className="btn danger small" onClick={() => setDeciding({ r, approve: false })}>Reject</button>
                  </>}
                  {ctx.isSpc && r.status === "approved" && <button className="btn small" onClick={() => setCompleting(r)}><Icon name="check" size={16} /> Mark completed</button>}
                  {mine && r.status === "rejected" && <button className="btn secondary small" onClick={() => resubmitTlRequest(ctx.trip.id, r.id).catch((e) => setErr(errorText(e)))}>Resubmit</button>}
                  {((mine && r.status === "pending") || ctx.isSpc) && <button className="btn ghost small" onClick={() => setRemoving(r)}>Delete</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding && <NewTlRequest ctx={ctx} onClose={() => setAdding(false)} />}
      {deciding && <DecisionModal ctx={ctx} r={deciding.r} approve={deciding.approve} onClose={() => setDeciding(null)} />}
      {completing && <CompleteModal ctx={ctx} r={completing} onClose={() => setCompleting(null)} />}
      {removing && <Confirm title="Delete request" confirmLabel="Delete" danger onClose={() => setRemoving(null)} onConfirm={() => deleteTlRequest(ctx.trip.id, removing.id)}>{removing.title}</Confirm>}
    </>
  );
}

/** Free-text summary kept by one role holder (Team Leader or SPC); read-only for everyone else. */
function SummaryBox({ ctx, role, title, canEdit, summary }: { ctx: TripCtx; role: SummaryRole; title: string; canEdit: boolean; summary: Summary | null }) {
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const value = text ?? summary?.text ?? "";
  return (
    <section className="card stack" style={{ gap: 8 }}>
      {canEdit ? (
        <>
          <TextField label={title} multiline value={value} onChange={(v) => { setText(v); setMsg(null); }} maxLength={5000} placeholder="Summary" />
          <div className="row">
            <button className="btn small" disabled={text === null} onClick={async () => {
              try { await saveSummary(ctx.session, ctx.trip.id, role, value); setText(null); setMsg({ tone: "ok", text: "Saved." }); }
              catch (e) { setMsg({ tone: "bad", text: errorText(e) }); }
            }}>Save</button>
            {summary?.updatedAtMs ? <span className="muted small">{summary.byName} · {relTime(summary.updatedAtMs)}</span> : null}
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </>
      ) : (
        <>
          <h3>{title}</h3>
          <div style={{ whiteSpace: "pre-wrap" }}>{summary?.text || <span className="muted">—</span>}</div>
          {summary?.updatedAtMs ? <span className="muted small">{summary.byName} · {relTime(summary.updatedAtMs)}</span> : null}
        </>
      )}
    </section>
  );
}

const TITLE_HINT: Record<RequestKind, string> = {
  resource: "e.g. Additional analyst", flight: "e.g. Return flight LHR–JFK", hotel: "e.g. 3 nights near embassy",
  car: "e.g. 7-seat hire car", taxi: "e.g. Airport transfer on arrival", asset: "e.g. Satellite phone", cash: "e.g. Local currency float",
};

function NewTlRequest({ ctx, onClose }: { ctx: TripCtx; onClose: () => void }) {
  const [kind, setKind] = useState<RequestKind | "">("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [neededBy, setNeededBy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const e = validateTlRequest({ kind, title, quantity, amount, currency });
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await addTlRequest(ctx.session, ctx.trip.id, {
        kind: kind as RequestKind, title, details, neededBy,
        quantity: (kind === "resource" || kind === "asset") && quantity.trim() ? Number(quantity) : null,
        amount: kind === "cash" ? parseAmount(amount) : null, currency,
      });
      onClose();
    } catch (e2) { setErr(errorText(e2)); setBusy(false); }
  }

  return (
    <Modal title="New request" onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy} onClick={save}>Submit for approval</button>
    </>}>
      <div className="stack">
        <SelectField label="Type *" value={kind} onChange={(v) => setKind(v as RequestKind)} options={REQUEST_KINDS.map((k) => ({ value: k.key, label: k.label }))} error={errors.kind} />
        <TextField label="Title *" placeholder={kind ? TITLE_HINT[kind] : "What do you need?"} value={title} onChange={setTitle} maxLength={120} error={errors.title} />
        {(kind === "resource" || kind === "asset") && (
          <TextField label={kind === "resource" ? "Number of people" : "Quantity"} type="number" inputMode="numeric" placeholder="1" value={quantity} onChange={setQuantity} error={errors.quantity} />
        )}
        {kind === "cash" && (
          <div className="grid2">
            <TextField label="Amount *" inputMode="decimal" placeholder="0.00" value={amount} onChange={setAmount} error={errors.amount} />
            <SelectField label="Currency *" value={currency} onChange={setCurrency} options={CURRENCIES} error={errors.currency} />
          </div>
        )}
        <TextField label="Needed by" type="date" value={neededBy} onChange={setNeededBy} />
        <TextField label="Rationale" multiline placeholder="Why is this needed?" value={details} onChange={setDetails} maxLength={2000} />
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}

function DecisionModal({ ctx, r, approve, onClose }: { ctx: TripCtx; r: TlRequest; approve: boolean; onClose: () => void }) {
  const [note, setNote] = useState("");
  return (
    <Confirm title={approve ? "Approve request" : "Reject request"} confirmLabel={approve ? "Approve" : "Reject"} danger={!approve} onClose={onClose}
      onConfirm={() => decideTlRequest(ctx.session, ctx.trip.id, r.id, approve, note)}>
      <div className="stack">
        <strong>{r.title}</strong>
        <TextField label="Note" multiline placeholder={approve ? "Optional" : "Reason"} value={note} onChange={setNote} maxLength={1000} />
      </div>
    </Confirm>
  );
}

function CompleteModal({ ctx, r, onClose }: { ctx: TripCtx; r: TlRequest; onClose: () => void }) {
  const [response, setResponse] = useState("");
  return (
    <Confirm title="Mark completed" confirmLabel="Completed" onClose={onClose}
      onConfirm={() => completeTlRequest(ctx.session, ctx.trip.id, r.id, response)}>
      <div className="stack">
        <strong>{r.title}</strong>
        <TextField label="Outcome" multiline placeholder="Optional, e.g. booking ref" value={response} onChange={setResponse} maxLength={1000} />
      </div>
    </Confirm>
  );
}
