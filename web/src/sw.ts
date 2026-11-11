/// <reference lib="webworker" />
/**
 * Service worker: app-shell caching (as before) + push notifications (owner, 2026-11-10).
 * Trip data is NEVER cached here: API calls (/api, /sanctum) always go to the network
 * (SECURITY-PLAN T10). Push payloads come from Firebase Cloud Messaging (Firebase build) or
 * standard Web Push from the Laravel API ({title, body, link, tag}); tapping a notification opens
 * (or focuses) the app at the notification's link — only ever a path inside this app.
 */
import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/__/, /^\/api\//, /^\/sanctum\//, /^\/up$/] }));

interface FcmPayload {
  notification?: { title?: string; body?: string }; data?: Record<string, string>; fcmOptions?: { link?: string };
  title?: string; body?: string; link?: string; tag?: string; // Web Push from the Laravel API
}
/** Only same-app paths are opened from a notification. */
const safeLink = (l: unknown) => (typeof l === "string" && /^\/(?!\/)/.test(l) ? l : "/");

self.addEventListener("push", (event) => {
  let p: FcmPayload = {};
  try { p = event.data?.json() ?? {}; } catch { p = { notification: { title: "Voyager", body: event.data?.text() ?? "" } }; }
  const title = p.notification?.title ?? p.title ?? "Voyager";
  const link = safeLink(p.fcmOptions?.link ?? p.data?.link ?? p.link);
  event.waitUntil(self.registration.showNotification(title, {
    body: p.notification?.body ?? p.body ?? "", icon: "/icons/icon-192.png", badge: "/icons/badge-96.png",
    tag: p.tag ?? `${p.data?.type ?? "note"}:${p.data?.tripId ?? ""}`, data: { link },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = safeLink((event.notification.data as { link?: string } | undefined)?.link);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) { await w.focus(); (w as WindowClient).navigate(link).catch(() => undefined); return; }
    }
    await self.clients.openWindow(link);
  })());
});
