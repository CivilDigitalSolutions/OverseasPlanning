import { useState } from "react";
import { useId } from "react";
import { Badge, Checkbox, Confirm, Empty, Icon, Loading, Modal, Notice, SelectField, TextField, errorText } from "./components";
import { CURRENCIES, TRIP_ROLES, addPerson, cleanItem, displayValue, type FieldSpec, type ItemSchema } from "./model";
import { addItem, deleteItem, updateItem, useItems, useMembers, type Item } from "./store";
import type { TripCtx } from "./TripDetail";

/** Flights, hotels, hire cars and assets share one list + form, driven by ITEM_SCHEMAS. */
export function ItemsTab({ ctx, schema }: { ctx: TripCtx; schema: ItemSchema }) {
  const items = useItems(ctx.trip.id, schema.collection);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <div className="page-head">
        <h2>{schema.plural}</h2><span className="spacer" />
        <button className="btn small" onClick={() => setEditing("new")}><Icon name="plus" size={16} /> Add {schema.singular}</button>
      </div>
      {items === null ? <Loading /> : items.length === 0 ? <Empty>No {schema.plural.toLowerCase()}</Empty> : (
        <ul className="list">
          {items.map((it) => (
            <li key={it.id} className="card" style={{ padding: 0 }}>
              <button className="list-item" style={{ border: 0, boxShadow: "none" }} aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>
                <span className="grow">
                  <span className="title">{schema.title(it.values)}</span>
                  <span className="muted small" style={{ display: "block" }}>{schema.subtitle(it.values)}</span>
                </span>
                {schema.collection === "assets" && it.values.returned === true && <Badge tone="ok">Returned</Badge>}
              </button>
              {open === it.id && (
                <div style={{ padding: "0 14px 14px" }} className="stack">
                  <dl className="kv">
                    {schema.fields.map((f) => <FieldValue key={f.key} f={f} values={it.values} />)}
                  </dl>
                  <div className="row">
                    <button className="btn secondary small" onClick={() => setEditing(it)}><Icon name="edit" size={16} /> Edit</button>
                    <button className="btn danger small" onClick={() => setRemoving(it)}><Icon name="trash" size={16} /> Delete</button>
                    {it.createdByName && <span className="muted small">{it.createdByName}</span>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <ItemForm ctx={ctx} schema={schema} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (
        <Confirm title={`Delete ${schema.singular}`} confirmLabel="Delete" danger onClose={() => setRemoving(null)}
          onConfirm={() => deleteItem(ctx.trip.id, schema.collection, removing.id)}>{schema.title(removing.values)}</Confirm>
      )}
    </>
  );
}

function FieldValue({ f, values }: { f: FieldSpec; values: Record<string, unknown> }) {
  const shown = displayValue(f, values);
  if (!shown || (f.type === "checkbox" && values[f.key] === undefined)) return null;
  return <><dt>{f.label}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{shown}</dd></>;
}

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

function ItemForm({ ctx, schema, item, onClose }: { ctx: TripCtx; schema: ItemSchema; item: Item | null; onClose: () => void }) {
  const [raw, setRaw] = useState<Record<string, unknown>>(() => {
    const v = { ...(item?.values ?? {}) };
    for (const f of schema.fields) {
      if (f.type === "list" && Array.isArray(v[f.key])) v[f.key] = (v[f.key] as string[]).join("\n");
      if (f.type === "people" && !Array.isArray(v[f.key])) v[f.key] = [];
      if (f.type === "money" && typeof v[f.key] === "number") v[f.key] = (v[f.key] as number).toFixed(2);
    }
    return v;
  });
  const members = useMembers(ctx.trip.id);
  const suggestions = [...new Set([
    ...TRIP_ROLES.map((r) => ctx.trip.roles[r.key]?.name ?? ""),
    ...(members ?? []).map((m) => m.name),
  ].map((n) => n.trim()).filter(Boolean))];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const str = (k: string) => (raw[k] === undefined || raw[k] === null ? "" : String(raw[k]));

  async function save() {
    const { value, errors: e } = cleanItem(schema, raw);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr("");
    try {
      if (item) await updateItem(ctx.trip.id, schema.collection, item.id, value, schema.fields.flatMap((f) => (f.type === "money" ? [f.key, `${f.key}Currency`] : [f.key])));
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
        {schema.fields.map((f) => {
          const label = f.label + (f.required ? " *" : "");
          if (f.type === "checkbox") return <Checkbox key={f.key} checked={raw[f.key] === true} onChange={(v) => setRaw({ ...raw, [f.key]: v })}>{f.label}</Checkbox>;
          if (f.type === "people") return <PeopleField key={f.key} f={f} value={(raw[f.key] as string[]) ?? []} suggestions={suggestions} error={errors[f.key]} onChange={(v) => setRaw({ ...raw, [f.key]: v })} />;
          if (f.type === "money") return (
            <div key={f.key} className="grid2">
              <TextField label={label} inputMode="decimal" placeholder="0.00" value={str(f.key)} onChange={(v) => setRaw({ ...raw, [f.key]: v })} error={errors[f.key]} />
              <SelectField label="Currency" value={str(`${f.key}Currency`) || "GBP"} onChange={(v) => setRaw({ ...raw, [`${f.key}Currency`]: v })} options={CURRENCIES} />
            </div>
          );
          return (
            <TextField key={f.key} label={label} value={str(f.key)} onChange={(v) => setRaw({ ...raw, [f.key]: v })}
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
