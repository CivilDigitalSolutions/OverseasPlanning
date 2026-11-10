import { useId, useState } from "react";
import { Badge, Checkbox, Confirm, Empty, Icon, Loading, Modal, Notice, SelectField, TextField, errorText, relTime } from "./components";
import { FLIGHT_POLICY, FLIGHT_POLICY_TITLE } from "./flightPolicy";
import {
  CURRENCIES, FLIGHT_DECISION_LABEL, SPC_FLIGHT_KEYS, TRAVEL_CLASSES, TRIP_ROLES, addPerson, byClass, cleanItem, dayNightFor, displayValue, formatDuration,
  type FieldSpec, type FlightDecision, type ItemSchema, type Passenger,
} from "./model";
import { PeoplePicker } from "./PeoplePicker";
import { addItem, decideFlight, deleteItem, updateItem, useItems, useMembers, type DirectoryPerson, type Item } from "./store";
import type { TripCtx } from "./TripDetail";

const tms = (v: unknown) => (typeof v === "number" ? v : (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0);
const STATUS_TONE: Record<string, string> = { Planning: "", Requested: "warn", Confirmed: "ok" };

/** Flights, hotels, hire cars and assets share one list + form, driven by ITEM_SCHEMAS. */
export function ItemsTab({ ctx, schema }: { ctx: TripCtx; schema: ItemSchema }) {
  const items = useItems(ctx.trip.id, schema.collection);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [deciding, setDeciding] = useState<{ item: Item; decision: FlightDecision } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [policy, setPolicy] = useState(false);
  const isFlights = schema.collection === "flights";

  return (
    <>
      <div className="page-head">
        <h2>{schema.plural}</h2><span className="spacer" />
        {isFlights && <PolicyButton onOpen={() => setPolicy(true)} />}
        <button className="btn small" onClick={() => setEditing("new")}><Icon name="plus" size={16} /> Add {schema.singular}</button>
      </div>
      {items === null ? <Loading /> : items.length === 0 ? <Empty>No {schema.plural.toLowerCase()}</Empty> : (
        <ul className="list">
          {items.map((it) => {
            const decision = it.values.spcDecision as FlightDecision | undefined;
            return (
              <li key={it.id} className="card" style={{ padding: 0 }}>
                <button className="list-item" style={{ border: 0, boxShadow: "none" }} aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>
                  <span className="grow">
                    <span className="title">{schema.title(it.values)}</span>
                    <span className="muted small" style={{ display: "block" }}>{schema.subtitle(it.values)}</span>
                  </span>
                  <span className="stack" style={{ gap: 4, justifyItems: "end" }}>
                    {isFlights && typeof it.values.flightStatus === "string" && <Badge tone={STATUS_TONE[it.values.flightStatus]}>{it.values.flightStatus}</Badge>}
                    {isFlights && decision && <Badge tone={decision === "approved" ? "ok" : "bad"}>{FLIGHT_DECISION_LABEL[decision]}</Badge>}
                    {schema.collection === "assets" && it.values.returned === true && <Badge tone="ok">Returned</Badge>}
                  </span>
                </button>
                {open === it.id && (
                  <div style={{ padding: "0 14px 14px" }} className="stack">
                    <dl className="kv">
                      {schema.fields.map((f) => <FieldValue key={f.key} f={f} values={it.values} />)}
                    </dl>
                    {isFlights && <FlightDecisionView ctx={ctx} item={it} onDecide={(d) => setDeciding({ item: it, decision: d })} />}
                    <div className="row">
                      <button className="btn secondary small" onClick={() => setEditing(it)}><Icon name="edit" size={16} /> Edit</button>
                      <button className="btn danger small" onClick={() => setRemoving(it)}><Icon name="trash" size={16} /> Delete</button>
                      {it.createdByName && <span className="muted small">{it.createdByName}</span>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <ItemForm ctx={ctx} schema={schema} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onPolicy={isFlights ? () => setPolicy(true) : undefined} />}
      {removing && (
        <Confirm title={`Delete ${schema.singular}`} confirmLabel="Delete" danger onClose={() => setRemoving(null)}
          onConfirm={() => deleteItem(ctx.trip.id, schema.collection, removing.id)}>{schema.title(removing.values)}</Confirm>
      )}
      {deciding && <DecideFlightModal ctx={ctx} item={deciding.item} decision={deciding.decision} title={schema.title(deciding.item.values)} onClose={() => setDeciding(null)} />}
      {policy && <PolicyModal onClose={() => setPolicy(false)} />}
    </>
  );
}

// ---- Flight policy ------------------------------------------------------------------------------

const PolicyButton = ({ onOpen }: { onOpen: () => void }) => (
  <button type="button" className="btn secondary small" onClick={onOpen}><Icon name="book" size={16} /> Flight policy</button>
);

function PolicyModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={FLIGHT_POLICY_TITLE} onClose={onClose} actions={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stack">
        {FLIGHT_POLICY.map((p) => <section key={p.heading} className="stack" style={{ gap: 4 }}><h3>{p.heading}</h3><p style={{ margin: 0 }}>{p.body}</p></section>)}
      </div>
    </Modal>
  );
}

// ---- SPC flight decision ----------------------------------------------------------------------------

function FlightDecisionView({ ctx, item, onDecide }: { ctx: TripCtx; item: Item; onDecide: (d: FlightDecision) => void }) {
  const v = item.values;
  const decision = v.spcDecision as FlightDecision | undefined;
  return (
    <div className="card stack" style={{ background: "var(--bg)", gap: 6 }}>
      <div className="row">
        <strong style={{ flex: 1 }}>SPC decision</strong>
        {decision ? <Badge tone={decision === "approved" ? "ok" : "bad"}>{FLIGHT_DECISION_LABEL[decision]}</Badge> : <Badge tone="warn">Awaiting SPC</Badge>}
      </div>
      {decision && <>
        <div style={{ whiteSpace: "pre-wrap" }}>{String(v.spcRationale ?? "")}</div>
        <span className="muted small">{String(v.spcDecidedByName ?? "")} · {relTime(tms(v.spcDecidedAt))}</span>
      </>}
      {ctx.isSpc && (
        <div className="row">
          <button className="btn small" onClick={() => onDecide("approved")}>Approve flight</button>
          <button className="btn danger small" onClick={() => onDecide("not_approved")}>Not approved</button>
        </div>
      )}
    </div>
  );
}

function DecideFlightModal({ ctx, item, decision, title, onClose }: { ctx: TripCtx; item: Item; decision: FlightDecision; title: string; onClose: () => void }) {
  const [rationale, setRationale] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={decision === "approved" ? "Approve flight" : "Flight not approved"} onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className={`btn ${decision === "approved" ? "" : "danger"}`} disabled={busy} onClick={async () => {
        if (!rationale.trim()) { setErr("Enter the rationale for your decision."); return; }
        setBusy(true);
        try { await decideFlight(ctx.session, ctx.trip.id, item.id, decision, rationale); onClose(); }
        catch (e) { setErr(errorText(e)); setBusy(false); }
      }}>Save decision</button>
    </>}>
      <div className="stack">
        <strong>{title}</strong>
        <TextField label="Rationale *" multiline rows={5} value={rationale} onChange={setRationale} maxLength={2000} placeholder="Justification for this decision" />
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}

// ---- Display ----------------------------------------------------------------------------------

function FieldValue({ f, values }: { f: FieldSpec; values: Record<string, unknown> }) {
  if (f.type === "passengers") {
    const groups = Array.isArray(values[f.key]) ? byClass(values[f.key] as Passenger[]) : [];
    if (groups.length === 0) return null;
    return <><dt>{f.label}</dt><dd>{groups.map((g) => <div key={g.travelClass}><strong>{g.travelClass}</strong>: {g.names.join(", ")}</div>)}</dd></>;
  }
  const shown = displayValue(f, values);
  if (!shown || (f.type === "checkbox" && values[f.key] === undefined)) return null;
  return <><dt>{f.label}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{shown}</dd></>;
}

// ---- Editors ----------------------------------------------------------------------------------

/** Named persons: add one at a time (Enter or +), with quick-picks from the trip's people. */
function PeopleField({ f, value, onChange, suggestions, error }: { f: FieldSpec; value: string[]; onChange: (v: string[]) => void; suggestions: string[]; error?: string }) {
  const [name, setName] = useState("");
  const id = useId();
  const add = (n: string) => { onChange(addPerson(value, n, f.max)); setName(""); };
  const picks = suggestions.filter((sg) => !value.some((v) => v.toLowerCase() === sg.toLowerCase()));
  return (
    <div className="field">
      <label htmlFor={id}>{f.label} {value.length > 0 && <span className="muted small">({value.length})</span>}</label>
      {value.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {value.map((p) => (
            <span key={p} className="chip">{p}
              <button type="button" aria-label={`Remove ${p}`} onClick={() => onChange(value.filter((x) => x !== p))}><Icon name="close" size={14} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input id={id} type="text" placeholder="Add a name" value={name} maxLength={120}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(name); } }} />
        <button type="button" className="btn secondary" aria-label="Add name" disabled={!name.trim()} onClick={() => add(name)}><Icon name="plus" /></button>
      </div>
      {picks.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {picks.slice(0, 12).map((p) => <button key={p} type="button" className="chip pick" onClick={() => add(p)}><Icon name="plus" size={14} />{p}</button>)}
        </div>
      )}
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}

/**
 * People booked on a flight, each under a travel class; shown grouped by class. People are picked
 * from the in-app directory (or the trip's own people), which gives them access to the trip.
 */
function PassengersField({ f, value, onChange, tripPeople, error }: { f: FieldSpec; value: Passenger[]; onChange: (v: Passenger[]) => void; tripPeople: DirectoryPerson[]; error?: string }) {
  const [cls, setCls] = useState("");
  const [msg, setMsg] = useState("");
  const id = useId();
  const same = (a: Passenger, b: { uid?: string; name: string }) => (a.uid && b.uid ? a.uid === b.uid : a.name.toLowerCase() === b.name.toLowerCase());
  const add = (p: DirectoryPerson) => {
    if (!cls) { setMsg("Choose a class first."); return; }
    if (value.some((v) => same(v, p)) || value.length >= (f.max ?? 100)) return;
    onChange([...value, { name: p.name, travelClass: cls, uid: p.uid, email: p.email }]);
    setMsg("");
  };
  const picks = tripPeople.filter((tp) => !value.some((v) => same(v, tp)));
  const groups = byClass(value);
  return (
    <div className="field">
      <span className="label">{f.label} {value.length > 0 && <span className="muted small">({value.length})</span>}</span>
      {groups.map((g) => (
        <div key={g.travelClass} className="stack" style={{ gap: 4 }}>
          <span className="small" style={{ fontWeight: 700, color: "var(--ink-2)" }}>{g.travelClass}</span>
          <div className="row" style={{ gap: 6 }}>
            {g.names.map((n) => (
              <span key={n} className="chip">{n}
                <select aria-label={`Class for ${n}`} className="chip-select" value={g.travelClass}
                  onChange={(e) => onChange(value.map((p) => (p.name === n ? { ...p, travelClass: e.target.value } : p)))}>
                  {TRAVEL_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" aria-label={`Remove ${n}`} onClick={() => onChange(value.filter((p) => p.name !== n))}><Icon name="close" size={14} /></button>
              </span>
            ))}
          </div>
        </div>
      ))}
      <label htmlFor={`${id}-c`} className="sr-only">Class</label>
      <select id={`${id}-c`} value={cls} onChange={(e) => { setCls(e.target.value); setMsg(""); }}>
        <option value="">Class…</option>
        {TRAVEL_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <PeoplePicker label="Add person" exclude={value.map((v) => v.uid ?? "")} onPick={add} />
      {picks.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {picks.slice(0, 12).map((p) => <button key={p.uid} type="button" className="chip pick" onClick={() => add(p)}><Icon name="plus" size={14} />{p.name}</button>)}
        </div>
      )}
      {(msg || error) && <span className="error" role="alert">{msg || error}</span>}
    </div>
  );
}

function ItemForm({ ctx, schema, item, onClose, onPolicy }: { ctx: TripCtx; schema: ItemSchema; item: Item | null; onClose: () => void; onPolicy?: () => void }) {
  const [raw, setRaw] = useState<Record<string, unknown>>(() => {
    const v = { ...(item?.values ?? {}) };
    for (const f of schema.fields) {
      if (f.type === "list" && Array.isArray(v[f.key])) v[f.key] = (v[f.key] as string[]).join("\n");
      if ((f.type === "people" || f.type === "passengers") && !Array.isArray(v[f.key])) v[f.key] = [];
      if (f.type === "money" && typeof v[f.key] === "number") v[f.key] = (v[f.key] as number).toFixed(2);
      if (f.type === "duration" && typeof v[f.key] === "number") v[f.key] = formatDuration(v[f.key] as number);
    }
    return v;
  });
  const members = useMembers(ctx.trip.id);
  const suggestions = [...new Set([
    ...TRIP_ROLES.map((r) => ctx.trip.roles[r.key]?.name ?? ""),
    ...(members ?? []).map((m) => m.name),
  ].map((n) => n.trim()).filter(Boolean))];
  // People already on the trip with an account: one-tap picks for flights.
  const tripPeople: DirectoryPerson[] = (members ?? []).filter((m) => m.name).map((m) => ({ uid: m.uid, name: m.name, email: m.email }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const str = (k: string) => (raw[k] === undefined || raw[k] === null ? "" : String(raw[k]));

  /** Departure/arrival changes re-derive Day/Night (still editable afterwards). */
  const set = (k: string, v: unknown) => {
    const next = { ...raw, [k]: v };
    if (schema.collection === "flights" && (k === "departAt" || k === "arriveAt")) {
      const dn = dayNightFor(String(next.departAt ?? ""), String(next.arriveAt ?? ""));
      if (dn) next.dayNight = dn;
    }
    setRaw(next);
  };

  async function save() {
    const { value, errors: e } = cleanItem(schema, raw);
    setErrors(e);
    if (Object.keys(e).length) { setErr("Check the highlighted fields."); return; }
    setBusy(true); setErr("");
    try {
      // Editing a flight clears any SPC decision (rules require it): a changed flight is approved again.
      const keys = [...schema.fields.flatMap((f) => (f.type === "money" ? [f.key, `${f.key}Currency`] : [f.key])), ...(schema.collection === "flights" ? SPC_FLIGHT_KEYS : [])];
      if (item) await updateItem(ctx.trip.id, schema.collection, item.id, value, keys);
      else await addItem(ctx.session, ctx.trip.id, schema.collection, value);
      onClose();
    } catch (e2) { setErr(errorText(e2)); setBusy(false); }
  }

  return (
    <Modal title={`${item ? "Edit" : "Add"} ${schema.singular}`} onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="stack">
        {onPolicy && <div className="row" style={{ justifyContent: "flex-end" }}><PolicyButton onOpen={onPolicy} /></div>}
        {schema.collection === "flights" && item?.values.spcDecision ? <Notice tone="warn">Saving changes clears the SPC decision.</Notice> : null}
        {schema.fields.map((f) => {
          const label = f.label + (f.required ? " *" : "");
          if (f.type === "checkbox") return <Checkbox key={f.key} checked={raw[f.key] === true} onChange={(v) => set(f.key, v)}>{f.label}</Checkbox>;
          if (f.type === "select") return <SelectField key={f.key} label={label} value={str(f.key)} onChange={(v) => set(f.key, v)} options={f.options ?? []} error={errors[f.key]} />;
          if (f.type === "people") return <PeopleField key={f.key} f={f} value={(raw[f.key] as string[]) ?? []} suggestions={suggestions} error={errors[f.key]} onChange={(v) => set(f.key, v)} />;
          if (f.type === "passengers") return <PassengersField key={f.key} f={f} value={(raw[f.key] as Passenger[]) ?? []} tripPeople={tripPeople} error={errors[f.key]} onChange={(v) => set(f.key, v)} />;
          if (f.type === "money") return (
            <div key={f.key} className="grid2">
              <TextField label={label} inputMode="decimal" placeholder="0.00" value={str(f.key)} onChange={(v) => set(f.key, v)} error={errors[f.key]} />
              <SelectField label="Currency" value={str(`${f.key}Currency`) || "GBP"} onChange={(v) => set(`${f.key}Currency`, v)} options={CURRENCIES} />
            </div>
          );
          return (
            <TextField key={f.key} label={label} value={str(f.key)} onChange={(v) => set(f.key, v)}
              type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : f.type === "number" ? "number" : "text"}
              multiline={f.type === "textarea" || f.type === "list"} rows={f.type === "list" ? 4 : 3}
              placeholder={f.placeholder} maxLength={f.type === "list" ? undefined : f.max} error={errors[f.key]} />
          );
        })}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}
