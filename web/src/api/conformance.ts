/**
 * Type-level guard: the Laravel store (./store) must accept exactly what the screens pass to the
 * Firebase store (../store) and give back what they read. `npm run build` type-checks this file, so
 * the two backends cannot silently drift apart while both exist.
 *
 * Firebase's raw write results (Firestore DocumentReference) are not compared for the four writes
 * whose results no screen reads.
 */
import type * as F from "../store";
import type * as L from "./store";

type Fn = (...a: never[]) => unknown;
type Except = "useSession" | "Session" | "refreshSession";
type IgnoredReturns = "submitRequest" | "addItem" | "sendMessage" | "addTlRequest";
type Keys = Exclude<keyof typeof F, Except>;
type Fns = { [K in Keys]: (typeof F)[K] extends Fn ? K : never }[Keys];
type LFn<K> = K extends keyof typeof L ? Extract<(typeof L)[K], Fn> : never;

type Missing = Exclude<keyof typeof F, keyof typeof L>;
type BadParams = { [K in Fns]: Parameters<Extract<(typeof F)[K], Fn>> extends Parameters<LFn<K>> ? never : K }[Fns];
type BadReturns = { [K in Exclude<Fns, IgnoredReturns>]: Awaited<ReturnType<LFn<K>>> extends Awaited<ReturnType<Extract<(typeof F)[K], Fn>>> ? never : K }[Exclude<Fns, IgnoredReturns>];

type Assert<T extends never> = T;
export type NoMissingExports = Assert<Missing>;
export type ParametersMatch = Assert<BadParams>;
export type ReturnsMatch = Assert<BadReturns>;
