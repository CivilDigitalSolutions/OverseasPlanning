import { useState } from "react";
import { AccessTab } from "./AccessTab";
import { AttachmentsTab } from "./AttachmentsTab";
import { Badge, Empty, Icon, Loading, Modal, Notice, SelectField, TextField, errorText, navigate } from "./components";
import { DebriefTab } from "./DebriefTab";
import { ItemsTab } from "./ItemsTab";
import { MessagesTab } from "./MessagesTab";
import {
  EMAIL_RE, ITEM_SCHEMAS, RISK_LEVELS, TRIP_ROLES, TRIP_STATUSES, dateRange, openCount, riskTone, statusHint, todayIso,
  type RoleHolder, type Trip, type TripRoleKey, type TripStatus,
} from "./model";
import { exportTripPdf } from "./pdf";
import { RequestsTab } from "./RequestsTab";
import { setTripStatus, updateTripOverview, updateTripRoles, useTlRequests, useTrip, type Session } from "./store";
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
  { key: "flights", label: "Flights" },
  { key: "hotels", label: "Hotels" },
  { key: "cars", label: "Hire cars" },
  { key: "assets", label: "Assets" },
  { key: "requests", label: "Requests" },
  { key: "messages", label: "Messages" },
  { key: "attachments", label: "Attachments" },
  { key: "vaccinations", label: "Vaccinations" },
  { key: "access", label: "Access" },
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
  const isSpc = !!trip.roles.spc?.uid && trip.roles.spc.uid === session.uid;
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
  const { trip, session, canLead } = ctx;
  const [editRisk, setEditRisk] = useState(false);
  const [editRoles, setEditRoles] = useState(false);
  const [statusErr, setStatusErr] = useState("");
  return (
    <div className="stack">
      <section className="card stack">
        <div className="row"><h2 style={{ flex: 1 }}>Risk</h2>{session.isHost && <button className="btn ghost small" onClick={() => setEditRisk(true)}><Icon name="edit" size={16} /> Edit</button>}</div>
        <div className="grid2">
          <RiskBlock title="Cyber risk" level={trip.cyberRisk} rationale={trip.cyberRationale} />
          <RiskBlock title="Country risk" level={trip.countryRisk} rationale={trip.countryRationale} />
        </div>
      </section>
      <section className="card stack">
        <div className="row"><h2 style={{ flex: 1 }}>Roles</h2>{session.isHost && <button className="btn ghost small" onClick={() => setEditRoles(true)}><Icon name="edit" size={16} /> Edit</button>}</div>
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
        <h2>Trip</h2>
        <dl className="kv"><dt>Team</dt><dd>{trip.teamName}</dd><dt>Location</dt><dd>{trip.location}</dd><dt>Dates</dt><dd>{dateRange(trip.startDate, trip.endDate)}</dd></dl>
        {canLead && (
          <div className="row">
            {TRIP_STATUSES.filter((s) => s.key !== trip.status).map((s) => (
              <button key={s.key} className="btn secondary small" onClick={() => setTripStatus(trip.id, s.key as TripStatus).catch((e) => setStatusErr(errorText(e)))}>Move to {s.label}</button>
            ))}
          </div>
        )}
        {statusErr && <Notice tone="bad">{statusErr}</Notice>}
      </section>
      {editRisk && <RiskEditor trip={trip} onClose={() => setEditRisk(false)} />}
      {editRoles && <RolesEditor trip={trip} onClose={() => setEditRoles(false)} />}
    </div>
  );
}

const RiskBlock = ({ title, level, rationale }: { title: string; level: string; rationale: string }) => (
  <div className="stack" style={{ gap: 6 }}>
    <div className="row"><strong>{title}</strong>{level ? <Badge tone={riskTone(level)}>{level}</Badge> : <Badge>Not set</Badge>}</div>
    <div style={{ whiteSpace: "pre-wrap" }}>{rationale || <span className="muted">—</span>}</div>
  </div>
);

function RiskEditor({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [v, setV] = useState({ name: trip.name, location: trip.location, startDate: trip.startDate, endDate: trip.endDate, cyberRisk: trip.cyberRisk, cyberRationale: trip.cyberRationale, countryRisk: trip.countryRisk, countryRationale: trip.countryRationale });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  return (
    <Modal title="Edit trip" onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" onClick={async () => {
        if (v.endDate < v.startDate) { setErr("Return date is before departure."); return; }
        try { await updateTripOverview(trip.id, v); onClose(); } catch (e) { setErr(errorText(e)); }
      }}>Save</button>
    </>}>
      <div className="stack">
        <TextField label="Trip name" value={v.name} onChange={set("name")} maxLength={120} placeholder="Trip name" />
        <TextField label="Location" value={v.location} onChange={set("location")} maxLength={120} placeholder="City, country" />
        <div className="grid2">
          <TextField label="Departure date" type="date" value={v.startDate} onChange={set("startDate")} />
          <TextField label="Return date" type="date" value={v.endDate} onChange={set("endDate")} />
        </div>
        <SelectField label="Cyber risk" value={v.cyberRisk} onChange={set("cyberRisk")} options={RISK_LEVELS} />
        <TextField label="Cyber risk rationale" multiline value={v.cyberRationale} onChange={set("cyberRationale")} maxLength={2000} placeholder="Why this level" />
        <SelectField label="Country risk" value={v.countryRisk} onChange={set("countryRisk")} options={RISK_LEVELS} />
        <TextField label="Country risk rationale" multiline value={v.countryRationale} onChange={set("countryRationale")} maxLength={2000} placeholder="Why this level" />
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}

function RolesEditor({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [roles, setRoles] = useState<Record<TripRoleKey, RoleHolder>>(() =>
    Object.fromEntries(TRIP_ROLES.map((r) => [r.key, { name: trip.roles[r.key]?.name ?? "", email: trip.roles[r.key]?.email ?? "" }])) as Record<TripRoleKey, RoleHolder>);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: TripRoleKey, f: "name" | "email") => (v: string) => setRoles({ ...roles, [k]: { ...roles[k], [f]: v } });
  return (
    <Modal title="Edit roles" onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy} onClick={async () => {
        for (const r of TRIP_ROLES) if (roles[r.key].email.trim() && !EMAIL_RE.test(roles[r.key].email.trim())) { setErr(`${r.label}: enter a valid email.`); return; }
        setBusy(true);
        try {
          await updateTripRoles(trip.id, Object.fromEntries(Object.entries(roles).filter(([, h]) => h.name.trim() || h.email.trim())
            .map(([k, h]) => [k, { name: h.name.trim(), email: h.email.trim().toLowerCase() }])));
          onClose();
        } catch (e) { setErr(errorText(e)); setBusy(false); }
      }}>Save</button>
    </>}>
      <div className="stack">
        {TRIP_ROLES.map((r) => (
          <div key={r.key} className="grid2">
            <TextField label={r.label} placeholder="Full name" value={roles[r.key].name} onChange={set(r.key, "name")} maxLength={80} />
            <TextField label={`${r.label} email`} type="email" placeholder="name@example.com" value={roles[r.key].email} onChange={set(r.key, "email")} />
          </div>
        ))}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}
