import { useState } from "react";
import { Badge, Checkbox, Confirm, Empty, Icon, Loading, Modal, Notice, TextField, errorText } from "./components";
import { cleanItem, type FieldSpec, type ItemSchema } from "./model";
import { addItem, deleteItem, updateItem, useItems, type Item } from "./store";
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
                {Array.isArray(it.values.passengers) && <Badge>{(it.values.passengers as string[]).length} on board</Badge>}
              </button>
              {open === it.id && (
                <div style={{ padding: "0 14px 14px" }} className="stack">
                  <dl className="kv">
                    {schema.fields.map((f) => <FieldValue key={f.key} f={f} v={it.values[f.key]} />)}
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

function FieldValue({ f, v }: { f: FieldSpec; v: unknown }) {
  let shown: string;
  if (f.type === "checkbox") shown = v === true ? "Yes" : "No";
  else if (Array.isArray(v)) shown = v.length ? v.join("\n") : "";
  else shown = v === undefined || v === null ? "" : String(v).replace("T", " ");
  if (!shown) return null;
  return <><dt>{f.label}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{shown}</dd></>;
}

const PLACEHOLDER: Record<string, string> = {
  airline: "e.g. British Airways", flightNumber: "e.g. BA117", from: "e.g. LHR", to: "e.g. JFK", bookingRef: "e.g. ABC123",
  passengers: "One name per line", guests: "One name per line", drivers: "One name per line", notes: "Optional",
  name: "Name", address: "Street, city, postcode", city: "City", phone: "+44…", company: "e.g. Hertz", vehicle: "e.g. Ford Focus",
  registration: "e.g. AB12 CDE", pickUpLocation: "Address or airport", dropOffLocation: "Address or airport",
  category: "e.g. Laptop", serialNumber: "e.g. SN-00123", quantity: "1", carriedBy: "Name",
};

function ItemForm({ ctx, schema, item, onClose }: { ctx: TripCtx; schema: ItemSchema; item: Item | null; onClose: () => void }) {
  const [raw, setRaw] = useState<Record<string, unknown>>(() => {
    const v = { ...(item?.values ?? {}) };
    for (const f of schema.fields) if (f.type === "list" && Array.isArray(v[f.key])) v[f.key] = (v[f.key] as string[]).join("\n");
    return v;
  });
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
      if (item) await updateItem(ctx.trip.id, schema.collection, item.id, value, schema.fields.map((f) => f.key));
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
        {schema.fields.map((f) => f.type === "checkbox"
          ? <Checkbox key={f.key} checked={raw[f.key] === true} onChange={(v) => setRaw({ ...raw, [f.key]: v })}>{f.label}</Checkbox>
          : (
            <TextField key={f.key} label={f.label + (f.required ? " *" : "")} value={str(f.key)} onChange={(v) => setRaw({ ...raw, [f.key]: v })}
              type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : f.type === "number" ? "number" : "text"}
              multiline={f.type === "textarea" || f.type === "list"} rows={f.type === "list" ? 4 : 3}
              placeholder={PLACEHOLDER[f.key]} maxLength={f.type === "list" ? undefined : f.max} error={errors[f.key]} />
          ))}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}
