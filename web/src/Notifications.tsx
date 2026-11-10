import { useEffect, useRef, useState } from "react";
import { Empty, Icon, Link, Loading, navigate, relTime } from "./components";
import { clearNotification, markNotificationRead, type AppNotification, type Session } from "./store";

/**
 * In-app notifications (owner, 2026-11-10): added to a trip, booked on a flight, new message.
 * Push reaches devices that switched it on; this inbox + banner works everywhere.
 */
const ICON: Record<string, string> = { trip_added: "user", flight_added: "send", message: "send" };

export function NotificationBell({ unread }: { unread: number }) {
  return (
    <Link to="/notifications" className="icon-btn bell">
      <span className="sr-only">Notifications{unread ? `, ${unread} unread` : ""}</span>
      <span style={{ color: "#fff" }}><Icon name="bell" /></span>
      {unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}

export function NotificationsPage({ session, list }: { session: Session; list: AppNotification[] | null }) {
  const open = (n: AppNotification) => { if (!n.read) markNotificationRead(session.uid, n.id).catch(() => undefined); navigate(n.link || "/"); };
  const unread = list?.filter((n) => !n.read) ?? [];
  return (
    <>
      <div className="page-head">
        <h1>Notifications</h1><span className="spacer" />
        {unread.length > 0 && <button className="btn ghost small" onClick={() => unread.forEach((n) => markNotificationRead(session.uid, n.id).catch(() => undefined))}>Mark all read</button>}
      </div>
      {list === null ? <Loading /> : list.length === 0 ? <Empty>No notifications</Empty> : (
        <ul className="list">
          {list.map((n) => (
            <li key={n.id} className={`list-item ${n.read ? "" : "unread"}`}>
              <Icon name={ICON[n.type] ?? "bell"} />
              <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }} onClick={() => open(n)}>
                <span className="title">{n.title}</span>
                <span className="small" style={{ display: "block", overflowWrap: "anywhere" }}>{n.body}</span>
                <span className="muted small">{relTime(n.createdAtMs)}</span>
              </button>
              {!n.read && <span className="unread-dot" aria-label="Unread" />}
              <button className="icon-btn" aria-label="Clear notification" onClick={() => clearNotification(session.uid, n.id)}><Icon name="close" size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Pop-up banner for notifications that arrive while the app is open (the in-app "push"). */
export function NotificationToast({ session, list }: { session: Session; list: AppNotification[] | null }) {
  const since = useRef(Date.now() - 5000);
  const seen = useRef(new Set<string>());
  const [show, setShow] = useState<AppNotification | null>(null);
  useEffect(() => {
    const fresh = (list ?? []).find((n) => !n.read && n.createdAtMs >= since.current && !seen.current.has(n.id));
    if (!fresh) return;
    seen.current.add(fresh.id);
    setShow(fresh);
    const t = window.setTimeout(() => setShow((s) => (s?.id === fresh.id ? null : s)), 6000);
    return () => window.clearTimeout(t);
  }, [list]);
  if (!show) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <button className="toast-body" onClick={() => { markNotificationRead(session.uid, show.id).catch(() => undefined); setShow(null); navigate(show.link || "/"); }}>
        <strong>{show.title}</strong>
        <span className="small">{show.body}</span>
      </button>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => setShow(null)}><Icon name="close" size={16} /></button>
    </div>
  );
}
