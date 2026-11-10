import { useState, type FormEvent } from "react";
import { Badge, Confirm, Empty, Link, Loading, Notice, SelectField, TextField, errorText, navigate } from "./components";
import {
  EMAIL_RE, RISK_LEVELS, TRIP_ROLES, dateRange, validateRequest,
  type RequestInput, type RoleHolder, type TripRequest, type TripRoleKey,
} from "./model";
import { RolePersonFields } from "./PeoplePicker";
import { createTrip, declineRequest, submitRequest, useRequest, type Session } from "./store";

const STATUS = { submitted: { tone: "warn", label: "Awaiting triage" }, accepted: { tone: "ok", label: "Trip created" }, declined: { tone: "bad", label: "Declined" } } as const;

/** The short request form anyone can submit (spec §3). */
export function NewRequest({ session }: { session: Session }) {
  const [r, setR] = useState<RequestInput>({ teamName: "", startDate: "", endDate: "", location: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof RequestInput, string>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof RequestInput) => (v: string) => setR({ ...r, [k]: v });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateRequest(r);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true); setErr("");
    try { await submitRequest(session, r); navigate("/requests"); } catch (e2) { setErr(errorText(e2)); setBusy(false); }
  }

  return (
    <>
      <div className="page-head"><h1>New trip request</h1></div>
      <form className="card stack" onSubmit={submit} noValidate>
        <TextField label="Team name" placeholder="e.g. Northern Region Team" value={r.teamName} onChange={set("teamName")} error={errors.teamName} maxLength={80} />
        <div className="grid2">
          <TextField label="Departure date" type="date" value={r.startDate} onChange={set("startDate")} error={errors.startDate} />
          <TextField label="Return date" type="date" value={r.endDate} onChange={set("endDate")} error={errors.endDate} />
        </div>
        <TextField label="Location" placeholder="City, country" value={r.location} onChange={set("location")} error={errors.location} maxLength={120} />
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="row"><button className="btn" disabled={busy}>Submit request</button><Link to="/" className="btn ghost">Cancel</Link></div>
      </form>
    </>
  );
}

/** HOST: the triage inbox. Everyone else: their own requests and what happened to them. */
export function RequestsPage({ session, requests }: { session: Session; requests: TripRequest[] | null }) {
  const [filter, setFilter] = useState<"submitted" | "all">("submitted");
  const list = requests ? (session.isHost && filter === "submitted" ? requests.filter((r) => r.status === "submitted") : requests) : null;
  return (
    <>
      <div className="page-head">
        <h1>{session.isHost ? "Triage" : "My requests"}</h1>
        <span className="spacer" />
        <Link to="/requests/new" className="btn secondary">New request</Link>
      </div>
      {session.isHost && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={filter === "submitted"} onClick={() => setFilter("submitted")}>Awaiting triage</button>
          <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All</button>
        </div>
      )}
      {list === null ? <Loading /> : list.length === 0 ? <Empty>No requests</Empty> : (
        <ul className="list">
          {list.map((r) => {
            const inner = (
              <>
                <span className="grow">
                  <span className="title">{r.teamName}</span>
                  <span className="muted small" style={{ display: "block" }}>{r.location} · {dateRange(r.startDate, r.endDate)}</span>
                  {session.isHost && <span className="muted small" style={{ display: "block" }}>{r.requesterName || r.requesterEmail}</span>}
                  {r.status === "declined" && r.declineReason && <span className="small" style={{ display: "block", color: "var(--bad)" }}>{r.declineReason}</span>}
                </span>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              </>
            );
            const to = r.status === "accepted" && r.tripId ? `/trips/${r.tripId}` : session.isHost && r.status === "submitted" ? `/requests/${r.id}` : null;
            return <li key={r.id}>{to ? <Link to={to} className="list-item">{inner}</Link> : <div className="list-item">{inner}</div>}</li>;
          })}
        </ul>
      )}
    </>
  );
}

type RoleForm = Record<TripRoleKey, RoleHolder>;
const emptyRoles = (): RoleForm => Object.fromEntries(TRIP_ROLES.map((r) => [r.key, { name: "", email: "" }])) as RoleForm;

/** HOST turns a request into a trip: risks + rationale and the four basic roles, on one screen. */
export function CreateTrip({ session: _s, requestId }: { session: Session; requestId: string }) {
  const req = useRequest(requestId);
  const [name, setName] = useState("");
  const [cyberRisk, setCyberRisk] = useState("");
  const [cyberRationale, setCyberRationale] = useState("");
  const [countryRisk, setCountryRisk] = useState("");
  const [countryRationale, setCountryRationale] = useState("");
  const [roles, setRoles] = useState<RoleForm>(emptyRoles);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  if (req === undefined) return <Loading />;
  if (req === null) return <Empty>Request not found</Empty>;
  if (req.status !== "submitted") return <Notice>This request has already been {req.status}.</Notice>;


  async function submit(e: FormEvent) {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!cyberRisk) v.cyberRisk = "Choose a level.";
    if (!countryRisk) v.countryRisk = "Choose a level.";
    if (!cyberRationale.trim()) v.cyberRationale = "Enter a rationale.";
    if (!countryRationale.trim()) v.countryRationale = "Enter a rationale.";
    for (const r of TRIP_ROLES) {
      const h = roles[r.key];
      if (h.email.trim() && !EMAIL_RE.test(h.email.trim())) v[`${r.key}.email`] = "Enter a valid email.";
      if (h.email.trim() && !h.name.trim()) v[`${r.key}.name`] = "Enter a name.";
    }
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true); setErr("");
    try {
      const filled = Object.fromEntries(Object.entries(roles).filter(([, h]) => h.name.trim() || h.email.trim())
        .map(([k, h]) => [k, { name: h.name.trim(), email: h.email.trim().toLowerCase() }]));
      const { tripId } = await createTrip({
        requestId, name: name.trim() || `${req!.teamName} – ${req!.location}`, cyberRisk, cyberRationale: cyberRationale.trim(),
        countryRisk, countryRationale: countryRationale.trim(), roles: filled,
      });
      navigate(`/trips/${tripId}`);
    } catch (e2) { setErr(errorText(e2)); setBusy(false); }
  }

  return (
    <>
      <div className="page-head"><h1>Create trip</h1></div>
      <form className="stack" onSubmit={submit} noValidate>
        <section className="card stack">
          <h2>Request</h2>
          <dl className="kv">
            <dt>Team</dt><dd>{req.teamName}</dd>
            <dt>Dates</dt><dd>{dateRange(req.startDate, req.endDate)}</dd>
            <dt>Location</dt><dd>{req.location}</dd>
            <dt>Requested by</dt><dd>{req.requesterName} {req.requesterEmail && `(${req.requesterEmail})`}</dd>
          </dl>
          <TextField label="Trip name" placeholder={`${req.teamName} – ${req.location}`} value={name} onChange={setName} maxLength={120} />
        </section>

        <section className="card stack">
          <h2>Risk</h2>
          <div className="grid2">
            <SelectField label="Cyber risk" value={cyberRisk} onChange={setCyberRisk} options={RISK_LEVELS} error={errors.cyberRisk} />
            <SelectField label="Country risk" value={countryRisk} onChange={setCountryRisk} options={RISK_LEVELS} error={errors.countryRisk} />
            <TextField label="Cyber risk rationale" multiline placeholder="Why this level" value={cyberRationale} onChange={setCyberRationale} error={errors.cyberRationale} maxLength={2000} />
            <TextField label="Country risk rationale" multiline placeholder="Why this level" value={countryRationale} onChange={setCountryRationale} error={errors.countryRationale} maxLength={2000} />
          </div>
        </section>

        <section className="card stack">
          <h2>Roles</h2>
          {TRIP_ROLES.map((r) => (
            <RolePersonFields key={r.key} label={r.label} value={roles[r.key]} onChange={(v) => setRoles({ ...roles, [r.key]: v })}
              errors={{ name: errors[`${r.key}.name`], email: errors[`${r.key}.email`] }} />
          ))}
        </section>

        {err && <Notice tone="bad">{err}</Notice>}
        <div className="row">
          <button className="btn" disabled={busy}>Create trip</button>
          <button type="button" className="btn danger" onClick={() => setDeclining(true)}>Decline</button>
          <Link to="/requests" className="btn ghost">Cancel</Link>
        </div>
      </form>
      {declining && (
        <Confirm title="Decline request" confirmLabel="Decline" danger onClose={() => setDeclining(false)}
          onConfirm={async () => { await declineRequest(requestId, reason); navigate("/requests"); }}>
          <TextField label="Reason" multiline placeholder="Shown to the requester" value={reason} onChange={setReason} maxLength={500} />
        </Confirm>
      )}
    </>
  );
}
