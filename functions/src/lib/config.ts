import { defineString } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";

/** Keep in step with web VITE_FUNCTIONS_REGION. TODO(owner): confirm region (UK data residency → europe-west2). */
export const REGION = "europe-west2";
setGlobalOptions({ region: REGION, maxInstances: 20 });

/**
 * Passkey relying party: the hosted app's domain, e.g. "overseas.example.com". Set in
 * functions/.env.<projectId> (PASSKEY_RP_ID=..., PASSKEY_ORIGINS=https://overseas.example.com).
 * TODO(owner): choose the production domain.
 */
export const PASSKEY_RP_ID = defineString("PASSKEY_RP_ID", { default: "localhost" });
export const PASSKEY_ORIGINS = defineString("PASSKEY_ORIGINS", { default: "http://localhost:5173" });
export const RP_NAME = "Voyager Trip Manager";
