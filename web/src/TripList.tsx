import { useState } from "react";
import { Badge, Empty, Link, Loading } from "./components";
import { awaitingMySpcDecision, dateRange, isSpcFor, liveTrips, pendingLabel, pendingSpc, riskTone, todayIso, tripPhase, tripsFor, type TripStatus } from "./model";
import { useControllerLiveTrips, useTrips, type Session } from "./store";

const TITLES: Record<TripStatus, string> = { planning: "Planning", live: "Live trips", archived: "Archived trips" };

/**
 * One list for Planning, Live and Archived. Planning and Archived are the same view; Archived adds
 * a search across historic trips (spec §3).
 */
export function TripList({ session, status }: { session: Session; status: TripStatus }) {
  const trips = useTrips(session);
  // Controllers also see every live trip they aren't on (basic details; owner, 2026-11-10).
  const controllerLive = useControllerLiveTrips(session);
  const [q, setQ] = useState("");
  const searchable = status === "archived";
  // Live trips is a date window, not a status: not archived and starting within 10 days or already started.
  const live = status === "live";
  const today = todayIso();
  const merged = trips && live && controllerLive ? [...trips, ...controllerLive.filter((c) => !trips.some((t) => t.id === c.id))] : trips;
  const list = merged ? (live ? liveTrips(merged, today) : tripsFor(merged, status, searchable ? q : "")) : null;
  // SPC (owner, 2026-11-12): trips with requests or flights waiting for my decision, shown first.
  const awaiting = trips && status === "planning" ? awaitingMySpcDecision(trips, session) : [];

  return (
    <>
      <div className="page-head">
        <h1>{TITLES[status]}</h1>
        <span className="spacer" />
        {status === "planning" && <Link to="/requests/new" className="btn">New request</Link>}
      </div>
      {searchable && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="trip-search" className="sr-only">Search</label>
          <input id="trip-search" type="search" placeholder="Search team, location, date, person…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {awaiting.length > 0 && (
        <section className="card stack" style={{ gap: 8, marginBottom: 14, borderColor: "var(--warn)" }} aria-labelledby="spc-awaiting">
          <h2 id="spc-awaiting" style={{ margin: 0 }}>Awaiting your approval</h2>
          <ul className="list">
            {awaiting.map((t) => (
              <li key={t.id}>
                <Link to={`/trips/${t.id}/${t.pendingRequests ? "requests" : "flights"}`} className="list-item">
                  <span className="grow">
                    <span className="title">{t.name || t.teamName}</span>
                    <span className="muted small" style={{ display: "block" }}>{dateRange(t.startDate, t.endDate)}</span>
                  </span>
                  <Badge tone="warn">{pendingLabel(t)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {list === null ? <Loading /> : list.length === 0 ? <Empty>{q ? "No matches" : "No trips"}</Empty> : (
        <ul className="list">
          {list.map((t) => (
            <li key={t.id}>
              <Link to={live ? `/live/${t.id}` : `/trips/${t.id}`} className="list-item">
                <span className="grow">
                  <span className="title">{t.name || t.teamName}</span>
                  <span className="muted small" style={{ display: "block" }}>{t.location} · {dateRange(t.startDate, t.endDate)}</span>
                </span>
                <span className="stack" style={{ gap: 4, justifyItems: "end" }}>
                  {live && (() => { const ph = tripPhase(t, today); return <Badge tone={ph.tone}>{ph.label}</Badge>; })()}
                  {status === "planning" && t.status === "live" && <Badge tone="ok">Live</Badge>}
                  {pendingSpc(t) > 0 && isSpcFor(t, session) && <Badge tone="warn">{pendingSpc(t)} awaiting you</Badge>}
                  {t.cyberRisk && <Badge tone={riskTone(t.cyberRisk)}>Cyber {t.cyberRisk}</Badge>}
                  {t.countryRisk && <Badge tone={riskTone(t.countryRisk)}>Country {t.countryRisk}</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
