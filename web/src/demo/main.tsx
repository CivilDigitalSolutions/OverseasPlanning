import { createRoot } from "react-dom/client";
import { useEffect, useState, type ComponentType } from "react";
import "../theme.css";
import "./demo.css";
import { initBackend, type Backend } from "./backend";
import { EMBLEM_WHITE, WORDMARK_WHITE } from "../brand";
import { useAccount, accountPath } from "./store";
import { be } from "./backend";

/**
 * Entry for the artifact demo. Waits for the demo backend, then renders the real App with the
 * demo strip above it (data mode + a HOST switch so one person can try every role).
 */
function DemoStrip({ mode }: { mode: Backend["mode"] }) {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  return (
    <div className="demo-strip">
      <span className="badge warn">Demo</span>
      <span className="small">{mode === "shared" ? "Shared with everyone on this page" : "Saved in this browser only"}</span>
      <span style={{ flex: 1 }} />
      {account && (["host", "controller", "spc", "admin"] as const).map((role) => (
        <label key={role} className="check small" style={{ alignItems: "center" }}>
          <input type="checkbox" checked={account[role]} disabled={busy}
            onChange={async (e) => { setBusy(true); await be().patch(accountPath(), { [role]: e.target.checked }).finally(() => setBusy(false)); }} />
          <span>{role === "host" ? "Act as HOST" : role === "controller" ? "Act as Controller" : role === "spc" ? "Act as SPC" : "Act as Administrator"}</span>
        </label>
      ))}
    </div>
  );
}

function Root() {
  const [ready, setReady] = useState<{ mode: Backend["mode"] } | null>(null);
  const [App, setApp] = useState<null | ComponentType>(null);
  useEffect(() => {
    initBackend().then(async (b) => {
      const m = await import("../App");
      setApp(() => m.App);
      setReady({ mode: b.mode });
    });
  }, []);
  if (!ready || !App) return <div className="splash" aria-busy="true"><img src={EMBLEM_WHITE} alt="" /><img src={WORDMARK_WHITE} alt="Voyager Trip Manager" /></div>;
  return <><DemoStrip mode={ready.mode} /><App /></>;
}

createRoot(document.getElementById("root")!).render(<Root />);
