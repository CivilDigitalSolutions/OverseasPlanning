/**
 * Voyager — Trip Manager brand (owner, 2026-11-11). Artwork: emblem (compass-globe with a plane)
 * and the VOYAGER / TRIP MANAGER wordmark, extracted from the owner's brand board as transparent
 * PNGs in src/assets (black and white versions). Icons in public/icons are generated from the same
 * emblem — see docs/BRAND.md. Imported so they are bundled (and inlined in the single-file demo).
 */
import appIcon from "./assets/app-icon-128.png";
import emblemBlack from "./assets/emblem-black.png";
import emblemWhite from "./assets/emblem-white.png";
import wordmarkBlack from "./assets/wordmark-black.png";
import wordmarkWhite from "./assets/wordmark-white.png";

export const APP_NAME = "Voyager";
export const APP_FULL_NAME = "Voyager Trip Manager";
/** White emblem on a black rounded square: the app icon, for small in-app uses. */
export const ICON = appIcon;
export const EMBLEM_BLACK = emblemBlack;
export const EMBLEM_WHITE = emblemWhite;
export const WORDMARK_BLACK = wordmarkBlack;
export const WORDMARK_WHITE = wordmarkWhite;
