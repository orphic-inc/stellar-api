// Machine-readable auth gates on middleware — the source the OpenAPI contract
// derives a route's `security` and its 401/403 from (#494, #520, #517).
//
// #474 proved every route is REGISTERED. It never claimed each registration is
// complete, and auth failure modes were the largest remaining gap: of 361
// operations only 39 declared a 401 and 88 a 403, and the three axes (401, 403,
// `security`) did not correlate — the signature of drift rather than policy.
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
//
// #494 GATED the hand-written blocks against this stamp; #517 derives them from
// it instead, so the gate is gone and the drift it measured cannot recur.
import type { RequestHandler } from 'express';

/** What a route's middleware chain can reject with before the handler runs. */
export type GateKind = 'auth' | 'permission' | 'service' | 'rateLimit';

/**
 * A gate, and whatever parameters it needs to describe itself.
 *
 * The kind alone answers "which status codes?". It does not answer "and the
 * contract should say WHICH permission", which is the whole of the difference
 * between a `403` that reads `Missing news_manage` and one that reads
 * `Permission denied`. The parameter belongs on the gate that has it rather
 * than in a second array kept in correspondence — two arrays that must agree is
 * the same encoded-twice shape that let 309 of 364 `security` blocks drift.
 */
export interface Gate {
  kind: GateKind;
  /**
   * For a `permission` gate: the permissions that satisfy it, ANY of which is
   * enough — `requirePermission` spreads varargs into a `.some()`.
   *
   * OPTIONAL ON PURPOSE. A gate whose 403 does not mean "you lack permission X"
   * must not claim it does: `requireOwnerOrPermission` rejects only a caller
   * who is neither the owner NOR permitted, so naming its permission would
   * describe a route an owner reaches without it. Such a gate stamps its kind
   * and no names, and is described with the generic message its middleware
   * actually sends.
   */
  permissions?: readonly string[];
  /**
   * The HTTP methods this gate applies to. Absent means all of them.
   *
   * Needed because one gate in this codebase is genuinely method-conditional:
   * the app-level write limiter runs for `POST`/`PUT`/`PATCH`/`DELETE` and
   * passes everything else straight through (#553). A gate mounted on a single
   * route has no use for this — the route already fixes the method.
   *
   * The list is supplied by the middleware that branches on it, never restated
   * here, so the contract cannot come to disagree with the check.
   */
  methods?: readonly string[];
}

const GATE = Symbol.for('stellar.routeGate');

/**
 * Stamp a middleware with the gate it enforces. Returns the same function.
 *
 * Pass `permissions` only when a caller holding one of them passes the gate and
 * a caller holding none of them is refused. Anything weaker should stamp the
 * kind alone.
 */
export const markGate = <T extends RequestHandler>(
  fn: T,
  kind: GateKind,
  permissions?: readonly string[],
  methods?: readonly string[]
): T => {
  // COPIED, not aliased. `requirePermission` passes the same array its closure
  // evaluates on every request, so storing the reference would let anything
  // holding the stamp mutate a live authorization check. Nothing does today,
  // and this makes sure nothing can. The same reasoning covers `methods`, which
  // the write limiter branches on per request.
  const frozen = (values: readonly string[] | undefined) =>
    values && values.length > 0 ? Object.freeze([...values]) : undefined;

  const permissionList = frozen(permissions);
  const methodList = frozen(methods);

  Object.defineProperty(fn, GATE, {
    value: {
      kind,
      ...(permissionList ? { permissions: permissionList } : {}),
      ...(methodList ? { methods: methodList } : {})
    },
    enumerable: false,
    configurable: true
  });
  return fn;
};

/** The gate a handler enforces, or undefined if it is not a gate. */
export const readGate = (fn: unknown): Gate | undefined =>
  typeof fn === 'function'
    ? ((fn as unknown as Record<symbol, Gate>)[GATE] ?? undefined)
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
export const expectedCodes = (
  gates: Iterable<Gate>,
  method: string
): number[] => {
  // A gate that does not run for this method cannot reject it, and saying
  // otherwise would put a `429` on every `GET` in the contract (#553).
  const applies = (gate: Gate): boolean =>
    !gate.methods || gate.methods.includes(method.toUpperCase());

  const set = new Set([...gates].filter(applies).map((gate) => gate.kind));
  const codes = new Set<number>();
  if (set.has('auth') || set.has('permission')) codes.add(401);
  if (set.has('permission')) codes.add(403);
  // The service key is presented as a Bearer header, so a bad or absent key is
  // a 401 — it is an authentication failure, not an authorization one.
  if (set.has('service')) codes.add(401);
  if (set.has('rateLimit')) codes.add(429);
  return [...codes].sort((a, b) => a - b);
};
