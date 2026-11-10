import { Badge, Empty, Icon, Loading, navigate } from "./components";
import { MessagesTab } from "./MessagesTab";
import { TRIP_ROLES, dateRange, riskTone, todayIso, tripPhase } from "./model";
import { useTrip, type Session } from "./store";
import type { TripCtx } from "./TripDetail";

/**
 * The Live trips view of one trip (owner, 2026-11-10): only the basic details, then the team's
 * messages. Planning happens in the full trip screen.
 */
export function LiveTrip({ session, tripId }: { session: Session; tripId: string }) {
  const trip = useTrip(tripId);
  if (trip === undefined) return <Loading />;
  if (trip === null) return <Empty>Trip not found, or you don't have access.</Empty>;
  const isTeamLeader = !!trip.roles.teamLeader?.uid && trip.roles.teamLeader.uid === session.uid;
  const isSpc = (!!trip.roles.spc?.uid && trip.roles.spc.uid === session.uid) || session.isSpcProfile;
  const ctx: TripCtx = { session, trip, canLead: session.isHost || isTeamLeader, isTeamLeader, isSpc };
  const phase = tripPhase(trip, todayIso());

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <button className="icon-btn" aria-label="Back to live trips" onClick={() => navigate("/live")}><Icon name="back" /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ overflowWrap: "anywhere" }}>{trip.name || trip.teamName}</h1>
          <div className="muted small">{trip.location} · {dateRange(trip.startDate, trip.endDate)}</div>
        </div>
        <Badge tone={phase.tone}>{phase.label}</Badge>
      </div>
      <section className="card">
        <dl className="kv">
          <dt>Team</dt><dd>{trip.teamName || "—"}</dd>
          {TRIP_ROLES.map((r) => trip.roles[r.key]?.name ? [<dt key={`${r.key}t`}>{r.label}</dt>, <dd key={`${r.key}d`}>{trip.roles[r.key]!.name}</dd>] : null)}
          <dt>Risk</dt>
          <dd className="row" style={{ gap: 6 }}>
            {trip.cyberRisk && <Badge tone={riskTone(trip.cyberRisk)}>Cyber {trip.cyberRisk}</Badge>}
            {trip.countryRisk && <Badge tone={riskTone(trip.countryRisk)}>Country {trip.countryRisk}</Badge>}
          </dd>
        </dl>
      </section>
      <h2>Team messages</h2>
      <MessagesTab ctx={ctx} />
    </div>
  );
}
