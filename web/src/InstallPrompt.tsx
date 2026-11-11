import { useEffect, useState } from "react";

/**
 * Encourages mobile users to install the PWA.
 *  - Android / Chrome / Edge: captures `beforeinstallprompt` and shows an Install button.
 *  - iOS Safari (no install API): shows "Share → Add to Home Screen".
 * Hidden when already installed (standalone) or on desktop, and for 14 days after "Not now".
 */
interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const KEY = "op.installDismissedAt";
const SNOOZE_MS = 14 * 24 * 3600_000;

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const snoozed = () => { try { return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < SNOOZE_MS; } catch { return false; } };

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || !isMobile() || snoozed()) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); setShow(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => setShow(false);
    window.addEventListener("appinstalled", onInstalled);
    if (isIos()) { setIos(true); setShow(true); }
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setShow(false); };

  return (
    <div className="install" role="dialog" aria-label="Install app">
      <img src="/icons/icon-192.png" alt="" />
      <div className="grow">
        <strong>Install Voyager</strong>
        {ios && <div className="small">Tap <ShareGlyph /> then <b>Add to Home Screen</b></div>}
      </div>
      {!ios && evt && (
        <button className="btn small" onClick={async () => { await evt.prompt(); await evt.userChoice.catch(() => null); setShow(false); setEvt(null); }}>Install</button>
      )}
      <button className="btn small secondary" onClick={dismiss}>Not now</button>
    </div>
  );
}

const ShareGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Share" style={{ verticalAlign: "-2px" }}>
    <path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" />
  </svg>
);
