import { signOut } from "firebase/auth";
import { useEffect } from "react";
import { Account } from "./Account";
import { ICON } from "./brand";
import { AuthAction, ForgotPassword, SignIn, SignUp, VerifyEmail } from "./Auth";
import { Icon, Link, Loading, usePath } from "./components";
import { auth } from "./firebase";
import { InstallPrompt } from "./InstallPrompt";
import { Privacy, Terms } from "./Legal";
import { CreateTrip, NewRequest, RequestsPage } from "./Requests";
import { TripDetail } from "./TripDetail";
import { TripList } from "./TripList";
import { syncPendingAccess, useRequests, useSession, type Session } from "./store";

export function App() {
  const path = usePath();
  const session = useSession();
  const pathname = path.split("?")[0];

  // Public pages, whatever the session.
  if (pathname === "/terms") return <><Terms /><InstallPrompt /></>;
  if (pathname === "/privacy") return <><Privacy /><InstallPrompt /></>;
  if (pathname === "/auth/action") return <AuthAction />;

  if (session === undefined) return <Loading />;
  if (session === null) {
    return (
      <>
        {pathname === "/signup" ? <SignUp /> : pathname === "/forgot-password" ? <ForgotPassword /> : <SignIn />}
        <InstallPrompt />
      </>
    );
  }
  if (!session.emailVerified) return <VerifyEmail session={session} />;
  return <Shell session={session} pathname={pathname} />;
}

function Shell({ session, pathname }: { session: Session; pathname: string }) {
  // Claim any trip access granted to this email before the account existed (once per session).
  useEffect(() => { syncPendingAccess().catch(() => undefined); }, [session.uid]);
  const requests = useRequests(session);
  const waiting = session.isHost ? (requests ?? []).filter((r) => r.status === "submitted").length : 0;

  const seg = pathname.split("/").filter(Boolean);
  let page;
  if (seg[0] === "trips" && seg[1]) page = <TripDetail session={session} tripId={seg[1]} tab={seg[2] ?? "overview"} />;
  else if (seg[0] === "live") page = <TripList session={session} status="live" />;
  else if (seg[0] === "archived") page = <TripList session={session} status="archived" />;
  else if (seg[0] === "requests" && seg[1] === "new") page = <NewRequest session={session} />;
  else if (seg[0] === "requests" && seg[1] && session.isHost) page = <CreateTrip session={session} requestId={seg[1]} />;
  else if (seg[0] === "requests") page = <RequestsPage session={session} requests={requests} />;
  else if (seg[0] === "account") page = <Account session={session} />;
  else page = <TripList session={session} status="planning" />;

  const nav = [
    { to: "/", label: "Planning", on: !seg[0] || seg[0] === "planning" },
    { to: "/live", label: "Live trips", on: seg[0] === "live" },
    { to: "/archived", label: "Archived", on: seg[0] === "archived" },
    { to: "/requests", label: session.isHost ? "Triage" : "My requests", on: seg[0] === "requests", count: waiting },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand"><img src={ICON} alt="" /> Overseas Planning</Link>
        <span className="spacer" />
        {session.isHost && <span className="badge info">HOST</span>}
        <Link to="/account" className="icon-btn"><span className="sr-only">Account</span><span style={{ color: "#fff" }}><Icon name="user" /></span></Link>
        <button className="icon-btn" aria-label="Sign out" onClick={() => signOut(auth)}><span style={{ color: "#fff" }}><Icon name="logout" /></span></button>
      </header>
      <nav className="nav" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} current={n.on}>{n.label}{n.count ? <span className="count">{n.count}</span> : null}</Link>
        ))}
      </nav>
      <main>{page}</main>
      <InstallPrompt />
    </div>
  );
}
