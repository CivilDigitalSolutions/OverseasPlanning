import { useState } from "react";
import { Badge, Empty, Link, Loading } from "./components";
import { dateRange, liveTrips, riskTone, todayIso, tripPhase, tripsFor, type TripStatus } from "./model";
import { useTrips, type Session } from "./store";

const TITLES: Record<TripStatus, string> = { planning: "Planning", live: "Live trips", archived: "Archived trips" };

/**
 * One list for Planning, Live and Archived. Planning and Archived are the same view; Archived adds
 * a search across historic trips (spec §3).
 */
export function TripList({ session, status }: { session: Session; status: TripStatus }) {
  const trips = useTrips(session);
  const [q, setQ] = useState("");
  const searchable = status === "archived";
  // Live trips is a date window, not a status: not archived and starting within 10 days or already started.
  const live = status === "live";
  const today = todayIso();
  const list = trips ? (live ? liveTrips(trips, today) : tripsFor(trips, status, searchable ? q : "")) : null;

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
