import { initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

/**
 * Firebase wiring. Every build talks to the real project named in web/.env.local — no emulator
 * connections in app code (emulators are for automated tests only, as in TrackLink).
 */
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FB_API_KEY,
  authDomain: env.VITE_FB_AUTH_DOMAIN,
  projectId: env.VITE_FB_PROJECT_ID,
  appId: env.VITE_FB_APP_ID,
  storageBucket: env.VITE_FB_STORAGE_BUCKET || (env.VITE_FB_PROJECT_ID ? `${env.VITE_FB_PROJECT_ID}.firebasestorage.app` : undefined),
};
if (!config.apiKey || !config.projectId) {
  throw new Error("Firebase is not configured. Copy web/.env.example to web/.env.local and fill in VITE_FB_*.");
}

export const app = initializeApp(config);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => undefined);
// Offline cache so a team overseas with poor signal can still read the trip they last opened.
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
export const REGION = env.VITE_FUNCTIONS_REGION || "europe-west2";
export const functions = getFunctions(app, REGION);
export const storage = getStorage(app);
