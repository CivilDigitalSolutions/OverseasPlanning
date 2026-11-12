import { useState } from "react";
import { AccessTab } from "./AccessTab";
import { AttachmentsTab } from "./AttachmentsTab";
import { ContactsTab } from "./ContactsTab";
import { Badge, Checkbox, Empty, Icon, Loading, Modal, Notice, SelectField, TextField, errorText, navigate, relTime } from "./components";
import { DebriefTab } from "./DebriefTab";
import { ItemsTab } from "./ItemsTab";
import { MessagesTab } from "./MessagesTab";
import { RolePersonFields } from "./PeoplePicker";
import {
  DIP_CLASSIFICATIONS, EMAIL_RE, ITEM_SCHEMAS, RISK_LEVELS, TRIP_ROLES, TRIP_STATUSES, dateRange, openCount, riskTone, statusHint, teamOptions, todayIso,
  type RoleHolder, type Trip, type TripRoleKey, type TripStatus,
} from "./model";
import { exportTripPdf } from "./pdf";
import { RequestsTab } from "./RequestsTab";
import { setDipAgreed, setDipClassification, setTripStatus, updateTripOverview, updateTripRoles, useTeams, useTlRequests, useTrip, type Session } from "./store";
import { VaccinationsTab } from "./VaccinationsTab";

export interface TripCtx {
  session: Session;
  trip: Trip;
  /** HOST, or this trip's Team Leader: moves status, reads all declarations. */
  canLead: boolean;
  isTeamLeader: boolean;
  /** Only the trip's SPC authorises requests: approve, reject, complete (owner decision 2026-11-10). */
  isSpc: boolean;
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "requests", label: "Requests" },
  { key: "flights", label: "Flights" },
  { key: "hotels", label: "Hotels" },
  { key: "cars", label: "Hire cars" },
  { key: "assets", label: "Assets" },
  { key: "messages", label: "Messages" },
  { key: "attachments", label: "Attachments" },
  { key: "vaccinations", label: "Vaccinations" },
  { key: "contacts", label: "Contacts" },
  { key: "access", label: "People" },
  { key: "debrief", label: "Debrief" },
] as const;

export function TripDetail({ session, tripId, tab }: { session: Session; tripId: string; tab: string }) {
  const trip = useTrip(tripId);
  const tl = useTlRequests(tripId);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");
  if (trip === undefined) return <Loading />;
  if (trip === null) return <Empty>Trip not found, or you don't have access.</Empty>;

  const isTeamLeader = !!trip.roles.teamLeader?.uid && trip.roles.teamLeader.uid === session.uid;
  // Authorises requests and flights: the trip's named SPC, or anyone with the SPC role profile.
  const isSpc = (!!trip.roles.spc?.uid && trip.roles.spc.uid === session.uid) || session.isSpcProfile;
  const ctx: TripCtx = { session, trip, canLead: session.isHost || isTeamLeader, isTeamLeader, isSpc };
  const active = TABS.some((t) => t.key === tab) ? tab : "overview";
  const open = tl ? openCount(tl) : 0;
  const hint = session.isHost || isTeamLeader ? statusHint(trip, todayIso()) : null;

  let body;
  switch (active) {
    case "flights": case "hotels": case "cars": case "assets": body = <ItemsTab ctx={ctx} schema={ITEM_SCHEMAS[active]} />; break;
    case "requests": body = <RequestsTab ctx={ctx} requests={tl} />; break;
    case "messages": body = <MessagesTab ctx={ctx} />; break;
    case "attachments": body = <AttachmentsTab ctx={ctx} />; break;
    case "vaccinations": body = <VaccinationsTab ctx={ctx} />; break;
    case "access": body = <AccessTab ctx={ctx} />; break;
    case "contacts": body = <ContactsTab ctx={ctx} />; break;
    case "debrief": body = <DebriefTab ctx={ctx} />; break;
    default: body = <Overview ctx={ctx} />;
  }

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate(trip.status === "live" ? "/live" : trip.status === "archived" ? "/archived" : "/")}><Icon name="back" /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ overflowWrap: "anywhere" }}>{trip.name || trip.teamName}</h1>
          <div className="muted small">{trip.location} · {dateRange(trip.startDate, trip.endDate)}</div>
        </div>
        <Badge tone={trip.status === "live" ? "ok" : trip.status === "archived" ? "" : "info"}>{TRIP_STATUSES.find((s) => s.key === trip.status)?.label}</Badge>
        <button className="btn secondary small" disabled={exporting} onClick={async () => {
          setExporting(true); setExportErr("");
          try { await exportTripPdf(trip.id); } catch (e) { setExportErr(errorText(e)); }
          setExporting(false);
        }}><Icon name="pdf" size={16} /> {exporting ? "Exporting…" : "PDF"}</button>
      </div>
      {exportErr && <Notice tone="bad">{exportErr}</Notice>}
      {hint && <div style={{ marginBottom: 12 }}><Notice tone="warn">{hint}</Notice></div>}
      <div className="tabs" role="tablist" aria-label="Trip sections">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => navigate(`/trips/${trip.id}/${t.key}`, true)}>
            {t.label}{t.key === "requests" && open > 0 && <span className="count" aria-label={`${open} open`}>{open}</span>}
          </button>
        ))}
      </div>
      {body}
    </>
  );
}

function Overview({ ctx }: { ctx: TripCtx }) {
  const { trip, canLead } = ctx;
  const [editing, setEditing] = useState<"risk" | "roles" | "trip" | null>(null);
  const [statusErr, setStatusErr] = useState("");
  const EditBtn = ({ what }: { what: "risk" | "roles" | "trip" }) => (
    <button className="btn ghost small" onClick={() => setEditing(what)}><Icon name="edit" size={16} /> Edit</button>
  );
  return (
    <div className="stack">
      <section className="card stack">
        <div className="row"><h2 style={{ flex: 1 }}>Risk</h2><EditBtn what="risk" /></div>
        <div className="grid2">
          <RiskBlock title="Cyber risk" level={trip.cyberRisk} rationale={trip.cyberRationale} />
          <RiskBlock title="Country risk" level={trip.countryRisk} rationale={trip.countryRationale} />
        </div>
      </section>
      <section className="card stack">
        <div className="row"><h2 style={{ flex: 1 }}>Roles</h2><EditBtn what="roles" /></div>
        <dl className="kv">
          {/* The HOST member who did the initial assessment and created the trip record. */}
          <dt>HOST assessment</dt>
          <dd>{trip.createdByName || "—"}{trip.createdByEmail ? <span className="muted small"> · {trip.createdByEmail}</span> : null}</dd>
          {TRIP_ROLES.map((r) => {
            const h = trip.roles[r.key];
            return [<dt key={`${r.key}t`}>{r.label}</dt>, <dd key={`${r.key}d`}>{h?.name || "—"}{h?.email ? <span className="muted small"> · {h.email}{!h.uid && " (not signed up)"}</span> : null}</dd>];
          })}
        </dl>
      </section>
      <section className="card stack">
        <div className="row"><h2 style={{ flex: 1 }}>Trip</h2><EditBtn what="trip" /></div>
        <dl className="kv">
          <dt>Trip name</dt><dd>{trip.name || "—"}</dd>
          <dt>Team</dt><dd>{trip.teamName || "—"}</dd>
          <dt>Location</dt><dd>{trip.location || "—"}</dd>
          <dt>Dates</dt><dd>{dateRange(trip.startDate, trip.endDate)}</dd>
        </dl>
        <DipFields trip={trip} />
        {canLead && (
          <div className="row">
            {TRIP_STATUSES.filter((s) => s.key !== trip.status).map((s) => (
              <button key={s.key} className="btn secondary small" onClick={() => setTripStatus(trip.id, s.key as TripStatus).catch((e) => setStatusErr(errorText(e)))}>Move to {s.label}</button>
            ))}
          </div>
        )}
        {statusErr && <Notice tone="bad">{statusErr}</Notice>}
      </section>
      {trip.updatedByName && <p className="muted small" style={{ margin: 0, textAlign: "right" }}>Last edited by {trip.updatedByName} · {relTime(trip.updatedAtMs)}</p>}
      {editing === "risk" && <RiskEditor trip={trip} onClose={() => setEditing(null)} />}
      {editing === "roles" && <RolesEditor trip={trip} onClose={() => setEditing(null)} />}
      {editing === "trip" && <TripEditor trip={trip} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** DiP classification, "DiP Agreed" and its date. Saves on change; anyone on the trip. */
function DipFields({ trip }: { trip: Trip }) {
  const [err, setErr] = useState("");
  const save = (agreed: boolean, date: string) => { setErr(""); setDipAgreed(trip.id, agreed, date).catch((e) => setErr(errorText(e))); };
  const saveClass = (v: string) => { setErr(""); setDipClassification(trip.id, v).catch((e) => setErr(errorText(e))); };
  return (
    <div className="grid2" style={{ alignItems: "end" }}>
      <SelectField label="DiP classification" value={trip.dipClassification} onChange={saveClass} options={DIP_CLASSIFICATIONS} placeholder="Not set" />
      <span />
      <Checkbox checked={trip.dipAgreed} onChange={(v) => save(v, v ? trip.dipAgreedDate || todayIso() : "")}>DiP Agreed</Checkbox>
      {trip.dipAgreed && (
        <TextField label="Date DiP agreed" type="date" value={trip.dipAgreedDate}
          onChange={(v) => { if (v) save(true, v); }} />
      )}
      {err && <Notice tone="bad">{err}</Notice>}
    </div>
  );
}

const RiskBlock = ({ title, level, rationale }: { title: string; level: string; rationale: string }) => (
  <div className="stack" style={{ gap: 6 }}>
    <div className="row"><strong>{title}</strong>{level ? <Badge tone={riskTone(level)}>{level}</Badge> : <Badge>Not set</Badge>}</div>
    <div style={{ whiteSpace: "pre-wrap" }}>{rationale || <span className="muted">—</span>}</div>
  </div>
);

function SaveCancel({ onClose, onSave, busy }: { onClose: () => void; onSave: () => void; busy: boolean }) {
  return <><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={onSave}>Save</button></>;
}

function RiskEditor({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [v, setV] = useState({ cyberRisk: trip.cyberRisk, cyberRationale: trip.cyberRationale, countryRisk: trip.countryRisk, countryRationale: trip.countryRationale });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const save = async () => {
    if (!v.cyberRisk || !v.countryRisk) { setErr("Choose both risk levels."); return; }
    setBusy(true);
    try { await updateTripOverview(trip.id, { ...v, cyberRationale: v.cyberRationale.trim(), countryRationale: v.countryRationale.trim() }); onClose(); }
    catch (e) { setErr(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title="Edit risk" onClose={onClose} actions={<SaveCancel onClose={onClose} onSave={save} busy={busy} />}>
      <div className="stack">
        <SelectField label="Cyber risk" value={v.cyberRisk} onChange={set("cyberRisk")} options={RISK_LEVELS} />
        <TextField label="Cyber risk rationale" multiline value={v.cyberRationale} onChange={set("cyberRationale")} maxLength={2000} placeholder="Why this level" />
        <SelectField label="Country risk" value={v.countryRisk} onChange={set("countryRisk")} options={RISK_LEVELS} />
        <TextField label="Country risk rationale" multiline value={v.countryRationale} onChange={set("countryRationale")} maxLength={2000} placeholder="Why this level" />
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}

function TripEditor({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [v, setV] = useState({ name: trip.name, teamName: trip.teamName, location: trip.location, startDate: trip.startDate, endDate: trip.endDate });
  const teams = useTeams();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const save = async () => {
    if (!v.name.trim() || !v.teamName.trim() || !v.location.trim()) { setErr("Enter the trip name, team and location."); return; }
    if (!v.startDate || !v.endDate) { setErr("Choose both dates."); return; }
    if (v.endDate < v.startDate) { setErr("Return date is before departure."); return; }
    setBusy(true);
    try { await updateTripOverview(trip.id, { ...v, name: v.name.trim(), teamName: v.teamName.trim(), location: v.location.trim() }); onClose(); }
    catch (e) { setErr(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title="Edit trip" onClose={onClose} actions={<SaveCancel onClose={onClose} onSave={save} busy={busy} />}>
      <div className="stack">
        <TextField label="Trip name" value={v.name} onChange={set("name")} maxLength={120} placeholder="Trip name" />
        <SelectField label="Team" value={v.teamName} onChange={set("teamName")} options={teamOptions(teams ?? [], trip.teamName)} placeholder="Select team" />
        <TextField label="Location" value={v.location} onChange={set("location")} maxLength={120} placeholder="City, country" />
        <div className="grid2">
          <TextField label="Departure date" type="date" value={v.startDate} onChange={set("startDate")} />
          <TextField label="Return date" type="date" value={v.endDate} onChange={set("endDate")} />
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}

function RolesEditor({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [host, setHost] = useState({ name: trip.createdByName, email: trip.createdByEmail });
  const [roles, setRoles] = useState<Record<TripRoleKey, RoleHolder>>(() =>
    Object.fromEntries(TRIP_ROLES.map((r) => [r.key, { name: trip.roles[r.key]?.name ?? "", email: trip.roles[r.key]?.email ?? "" }])) as Record<TripRoleKey, RoleHolder>);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (host.email.trim() && !EMAIL_RE.test(host.email.trim())) { setErr("HOST assessment: enter a valid email."); return; }
    for (const r of TRIP_ROLES) if (roles[r.key].email.trim() && !EMAIL_RE.test(roles[r.key].email.trim())) { setErr(`${r.label}: enter a valid email.`); return; }
    setBusy(true);
    try {
      if (host.name.trim() !== trip.createdByName || host.email.trim().toLowerCase() !== trip.createdByEmail) {
        await updateTripOverview(trip.id, { createdByName: host.name.trim(), createdByEmail: host.email.trim().toLowerCase() });
      }
      await updateTripRoles(trip.id, Object.fromEntries(Object.entries(roles).filter(([, h]) => h.name.trim() || h.email.trim())
        .map(([k, h]) => [k, { name: h.name.trim(), email: h.email.trim().toLowerCase() }])));
      onClose();
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title="Edit roles" onClose={onClose} actions={<SaveCancel onClose={onClose} onSave={save} busy={busy} />}>
      <div className="stack">
        <div className="grid2">
          <TextField label="HOST assessment" placeholder="Full name" value={host.name} onChange={(v) => setHost({ ...host, name: v })} maxLength={80} />
          <TextField label="HOST assessment email" type="email" placeholder="name@example.com" value={host.email} onChange={(v) => setHost({ ...host, email: v })} />
        </div>
        {TRIP_ROLES.map((r) => (
          <RolePersonFields key={r.key} label={r.label} value={roles[r.key]} onlySpc={r.key === "spc"} onChange={(v) => setRoles({ ...roles, [r.key]: v })} />
        ))}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}
