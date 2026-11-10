import { useState } from "react";
import { Badge, Confirm, Empty, Icon, Loading, Modal, Notice, TextField, errorText } from "./components";
import {
  CONTACT_FIELDS, EMPTY_CONTACT, cleanContact, contactMatches, sortContacts,
  type Contact, type ContactInput, type TripContact,
} from "./model";
import { addContactToTrip, deleteContact, removeTripContact, saveContact, useContacts, useTripContacts } from "./store";
import type { TripCtx } from "./TripDetail";

/**
 * Trip contacts, drawn from the global contacts book: search the book, add someone with their role
 * on this trip, or create a new contact (which goes into the book for everyone).
 */
export function ContactsTab({ ctx }: { ctx: TripCtx }) {
  const tripContacts = useTripContacts(ctx.trip.id);
  const book = useContacts();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [removing, setRemoving] = useState<TripContact | null>(null);

  // Show the book's current details where we have them (the trip keeps its own copy too).
  const current = (tc: TripContact) => book?.find((c) => c.id === tc.id);
  const list = tripContacts ? sortContacts(tripContacts.map((tc) => ({ ...tc, ...pick(current(tc)) }))) : null;

  return (
    <>
      <div className="page-head">
        <h2>Contacts</h2><span className="spacer" />
        <button className="btn small" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add contact</button>
      </div>
      {list === null ? <Loading /> : list.length === 0 ? <Empty>No contacts on this trip</Empty> : (
        <ul className="list">
          {list.map((c) => {
            const inBook = current(c);
            const canEdit = !!inBook; // anyone signed in may edit a book contact
            return (
              <li key={c.id} className="card stack" style={{ gap: 6 }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650, overflowWrap: "anywhere" }}>{c.name}</div>
                    <div className="muted small">{[c.jobTitle, c.organisation, c.country].filter(Boolean).join(" · ")}</div>
                  </div>
                  {c.tripRole && <Badge tone="info">{c.tripRole}</Badge>}
                </div>
                {(c.email || c.phone) && (
                  <div className="row small" style={{ gap: 14 }}>
                    {c.email && <span style={{ userSelect: "all", overflowWrap: "anywhere" }}>{c.email}</span>}
                    {c.phone && <span style={{ userSelect: "all" }}>{c.phone}</span>}
                  </div>
                )}
                <div className="row">
                  {canEdit && <button className="btn ghost small" onClick={() => setEditing(inBook!)}><Icon name="edit" size={16} /> Edit</button>}
                  <button className="btn ghost small" onClick={() => setRemoving(c)}>Remove from trip</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding && <AddContact ctx={ctx} book={book} onTrip={new Set((tripContacts ?? []).map((t) => t.id))} onClose={() => setAdding(false)} />}
      {editing && <ContactForm ctx={ctx} contact={editing} onClose={() => setEditing(null)} />}
      {removing && <Confirm title="Remove from trip" confirmLabel="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={() => removeTripContact(ctx.trip.id, removing.id)}>{removing.name}</Confirm>}
    </>
  );
}

const pick = (c?: Contact) => c ? { name: c.name, organisation: c.organisation, jobTitle: c.jobTitle, email: c.email, phone: c.phone, country: c.country } : {};

/** Search the global book; add a result to the trip, or create a new contact. */
function AddContact({ ctx, book, onTrip, onClose }: { ctx: TripCtx; book: Contact[] | null; onTrip: Set<string>; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Contact | null>(null);
  const [role, setRole] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (creating) return <ContactForm ctx={ctx} contact={null} initialName={q} onClose={onClose} addToTrip />;

  const results = book ? sortContacts(book.filter((c) => contactMatches(c, q))).slice(0, 50) : null;

  if (chosen) {
    return (
      <Modal title="Add to trip" onClose={onClose} actions={<>
        <button className="btn secondary" onClick={() => setChosen(null)}>Back</button>
        <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await addContactToTrip(ctx.session, ctx.trip.id, chosen, role); onClose(); } catch (e) { setErr(errorText(e)); setBusy(false); }
        }}>Add to trip</button>
      </>}>
        <div className="stack">
          <div><strong>{chosen.name}</strong><div className="muted small">{[chosen.jobTitle, chosen.organisation].filter(Boolean).join(" · ")}</div></div>
          <TextField label="Role on this trip" value={role} onChange={setRole} maxLength={80} placeholder="e.g. Hotel manager, embassy liaison" />
          {err && <Notice tone="bad">{err}</Notice>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Contacts book" onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> New contact</button>
    </>}>
      <div className="stack">
        <div className="field">
          <label htmlFor="contact-search" className="sr-only">Search contacts</label>
          <input id="contact-search" type="search" placeholder="Search name, organisation, email, country…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {results === null ? <Loading /> : results.length === 0 ? <Empty>{q ? "No matches" : "The contacts book is empty"}</Empty> : (
          <ul className="list">
            {results.map((c) => (
              <li key={c.id}>
                <button className="list-item" disabled={onTrip.has(c.id)} onClick={() => setChosen(c)}>
                  <span className="grow">
                    <span className="title">{c.name}</span>
                    <span className="muted small" style={{ display: "block" }}>{[c.jobTitle, c.organisation, c.country].filter(Boolean).join(" · ")}</span>
                    {c.email && <span className="muted small" style={{ display: "block" }}>{c.email}</span>}
                  </span>
                  {onTrip.has(c.id) ? <Badge tone="ok">On trip</Badge> : <Icon name="plus" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Create a contact in the global book (optionally adding it to the trip), or edit one. */
function ContactForm({ ctx, contact, initialName = "", addToTrip = false, onClose }: {
  ctx: TripCtx; contact: Contact | null; initialName?: string; addToTrip?: boolean; onClose: () => void;
}) {
  const [v, setV] = useState<ContactInput>(contact ? { ...contact } : { ...EMPTY_CONTACT, name: initialName });
  const [role, setRole] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof ContactInput, string>>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    const { value, errors: e } = cleanContact(v);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr("");
    try {
      const id = await saveContact(ctx.session, contact?.id ?? null, value);
      if (addToTrip) await addContactToTrip(ctx.session, ctx.trip.id, { ...value, id, createdBy: ctx.session.uid, createdByName: ctx.session.name, updatedAtMs: Date.now() }, role);
      onClose();
    } catch (e2) { setErr(errorText(e2)); setBusy(false); }
  }

  return (
    <Modal title={contact ? "Edit contact" : "New contact"} onClose={onClose} actions={<>
      {contact && ctx.session.isHost && <button className="btn danger" onClick={() => setDeleting(true)}>Delete from book</button>}
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy} onClick={save}>{addToTrip ? "Save and add to trip" : "Save"}</button>
    </>}>
      <div className="stack">
        {CONTACT_FIELDS.map((f) => (
          <TextField key={f.key} label={f.label} value={v[f.key]} onChange={(x) => setV({ ...v, [f.key]: x })} maxLength={f.max}
            placeholder={f.placeholder} multiline={f.multiline} type={f.type} error={errors[f.key]} />
        ))}
        {addToTrip && <TextField label="Role on this trip" value={role} onChange={setRole} maxLength={80} placeholder="e.g. Hotel manager, embassy liaison" />}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
      {deleting && contact && <Confirm title="Delete from contacts book" confirmLabel="Delete" danger onClose={() => setDeleting(false)}
        onConfirm={async () => { await deleteContact(contact.id); onClose(); }}>{contact.name}</Confirm>}
    </Modal>
  );
}
