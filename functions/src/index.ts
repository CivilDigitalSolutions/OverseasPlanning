import { initializeApp } from "firebase-admin/app";
import "./lib/config";

initializeApp();

export { recordAgreement } from "./recordAgreement";
export { createTrip, updateTripRoles } from "./createTrip";
export { addTripAccess, removeTripAccess, syncPendingAccess, onFlightWritten, onMessageCreated } from "./tripAccess";
export { listLiveTrips } from "./listLiveTrips";
export { listAccounts, createAccount, setAccountRoles, deleteAccount } from "./adminAccounts";
export { setHostRole, setRole } from "./setHostRole";
export {
  passkeyRegistrationOptions, passkeyRegister, passkeySignInOptions, passkeySignIn, listPasskeys, deletePasskey,
} from "./passkeys";
// TODO(owner): notifications — e.g. email/push HOST when a trip request arrives, the Team Leader when
// a request needs approval, and the requester when it is decided (spec §9).
