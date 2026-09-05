// Machine-readable auth gates on middleware, for the auth-coverage gate (#494).
//
// #474 proved every route is REGISTERED. It never claimed each registration is
// complete, and auth failure modes are the largest remaining gap: of 361
// operations only 39 declare a 401 and 88 a 403, and the three axes (401, 403,
// `security`) do not correlate — the signature of drift rather than policy.
//
// The authority for "can this route answer 401/403?" is the middleware chain,
// and nothing read it. It cannot be read reliably by inspection either:
// `requirePermission()` returns an ARRAY of anonymous arrow functions, so there
// is no `fn.name` to match on, and matching on names would silently stop
// working the moment one is renamed or wrapped.
//
// So the gates label themselves. `markGate` stamps a non-enumerable symbol on
// the handler; `readGate` reads it back off the built app's route stack. A
// handler with no stamp is simply unknown, never guessed at.
import type { RequestHandler } from 'express';

/** What a route's middleware chain can reject with before the handler runs. */
export type GateKind = 'auth' | 'permission' | 'service';

const GATE = Symbol.for('stellar.routeGate');

/** Stamp a middleware with the gate it enforces. Returns the same function. */
export const markGate = <T extends RequestHandler>(
  fn: T,
  kind: GateKind
): T => {
  Object.defineProperty(fn, GATE, {
    value: kind,
    enumerable: false,
    configurable: true
  });
  return fn;
};

/** The gate a handler enforces, or undefined if it is not a gate. */
export const readGate = (fn: unknown): GateKind | undefined =>
  typeof fn === 'function'
    ? ((fn as unknown as Record<symbol, GateKind>)[GATE] ?? undefined)
    : undefined;

/**
 * The response codes a chain carrying these gates can answer BEFORE the
 * handler runs.
 *
 * `permission` implies 401 as well as 403, and that is not a nicety:
 * `requirePermission()` literally spreads `[requireAuth, check]`, so an
 * unauthenticated caller gets 401 from the first element and an authenticated
 * one without the permission gets 403 from the second. A registration that
 * declares only 403 describes half the gate.
 */
export const expectedCodes = (gates: Iterable<GateKind>): number[] => {
  const set = new Set(gates);
  const codes = new Set<number>();
  if (set.has('auth') || set.has('permission')) codes.add(401);
  if (set.has('permission')) codes.add(403);
  // The service key is presented as a Bearer header, so a bad or absent key is
  // a 401 — it is an authentication failure, not an authorization one.
  if (set.has('service')) codes.add(401);
  return [...codes].sort((a, b) => a - b);
};
