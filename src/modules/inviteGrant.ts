/**
 * Invite handout evaluator — the pure core of the class-based invite faucet
 * (#282, ADR-0039).
 *
 * Given one member's rank allowance, balance, clock and governance standing, it
 * decides whether to add invites, advance the clock without adding any, or do
 * nothing. No DB and no I/O, so the whole matrix is deterministically testable;
 * the sweep (inviteGrantJob) supplies the inputs and persists the outcome.
 *
 * Four things here are deliberate and not obvious from the issue:
 *
 *  - This is ACCRUAL, not top-up-to-cap. `inviteCount` gains `perPeriod` every
 *    period and plateaus at `cap`; it is never *set* to the cap. That choice is
 *    what makes the clock load-bearing: a top-up would be idempotent and need no
 *    stamp at all, whereas an accrual run twice grants twice. `app.ts` starts
 *    every job at boot, so without a durable clock each redeploy would be a
 *    handout.
 *  - There is NO back-pay. A gap of six periods grants one period, not six.
 *    Same reasoning as `inactivity.ts`'s warn grace: a job that was down for a
 *    month must not do a month's work in the pass that brings it back.
 *  - A period the member had no room for is SPENT. An eligible member sitting
 *    at their cap advances the clock and receives nothing (`advance`). Skip that
 *    and a member who holds at cap keeps an ancient stamp, then grants the
 *    instant they spend — which is top-up-to-cap semantics reached by accident,
 *    and it would mean a hoarder earns faster than a spender.
 *  - The tenure floor is a constant here rather than rank configuration. The
 *    per-rank rate and cap are admin-editable columns, so a typo surface exists;
 *    standing does not cover it, because a fresh account has zero warnings and
 *    computes as `clean`, which is grant-eligible. This floor is the one part
 *    of the rule a form cannot mistype away.
 */
import type { Standing } from './standing';

/** How long a member must hold their account before any grant. */
export const MIN_TENURE_DAYS = 30;
/** The accrual window. Independent of how often the job ticks. */
export const PERIOD_DAYS = 14;
/** Ranks at or above this level are assigned; staff create accounts directly. */
export const STAFF_LEVEL = 500;

export const DAY_MS = 86_400_000;

/**
 * Standing tiers that earn nothing. `poor` is 2+ active warnings and `hammer`
 * is a ban or 4+, per ADR-0004 — so the faucet closes on a member the site is
 * actively unhappy with, without withholding anything they already hold.
 */
const DENIED_STANDINGS: readonly Standing[] = ['poor', 'hammer'];

/**
 * Whether governance standing alone closes the faucet on this member.
 *
 * Exported so the sweep can tally "withheld on standing" without matching on
 * the human-readable reason string, which exists for logs and is free to change.
 */
export const isStandingDenied = (standing: Standing): boolean =>
  DENIED_STANDINGS.includes(standing);

export interface InviteGrantInput {
  /** `UserRank.inviteGrantPerPeriod`. 0 = this class earns none. */
  perPeriod: number;
  /** `UserRank.inviteCap`. 0 = this class holds none. */
  cap: number;
  /** Current `User.inviteCount`. */
  balance: number;
  /** `User.lastInviteGrantAt`; null for a member never evaluated. */
  lastInviteGrantAt: Date | null;
  /** Clock origin when the stamp is null, and the tenure basis either way. */
  dateRegistered: Date;
  /** From `computeStanding` — the ADR-0004 producer, not a local flag. */
  standing: Standing;
  disabled: boolean;
  /** Rank level; staff and above are never auto-managed. */
  rankLevel: number;
}

export type InviteGrantAction = 'none' | 'grant' | 'advance';

export interface InviteGrantDecision {
  action: InviteGrantAction;
  /** How many invites to add. Always 0 unless `action` is `grant`. */
  amount: number;
  /** Human-readable why — for the dry-run log and the cycle tally. */
  reason: string;
}

const decide = (
  action: InviteGrantAction,
  amount: number,
  reason: string
): InviteGrantDecision => ({ action, amount, reason });

const daysBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / DAY_MS;

/**
 * The clock origin: the last time we evaluated this member as eligible, or
 * their registration date if we never have.
 *
 * The fallback is why `registerUser` writes nothing and the migration backfills
 * nothing — `dateRegistered` is already the right answer for both a brand-new
 * member and every member who predates the feature.
 */
export const grantClockOrigin = (input: InviteGrantInput): Date =>
  input.lastInviteGrantAt ?? input.dateRegistered;

/**
 * Why this member is out of scope, or null if they are in scope.
 *
 * A reason rather than a boolean so the dry-run log can say which rule spared
 * each member: "rate 0" and "poor standing" are very different things to read
 * in a list of thousands, and only one of them is a misconfiguration.
 */
const exemptionReason = (input: InviteGrantInput): string | null => {
  if (input.disabled) return 'disabled';
  if (input.rankLevel >= STAFF_LEVEL)
    return 'staff rank — creates accounts directly';
  if (input.perPeriod <= 0) return 'rank earns no invites';
  if (input.cap <= 0) return 'rank holds no invites';
  if (DENIED_STANDINGS.includes(input.standing))
    return `${input.standing} standing`;
  return null;
};

export const evaluateInviteGrant = (
  input: InviteGrantInput,
  now: Date
): InviteGrantDecision => {
  const exempt = exemptionReason(input);
  if (exempt !== null) return decide('none', 0, exempt);

  const tenure = daysBetween(input.dateRegistered, now);
  if (tenure < MIN_TENURE_DAYS) {
    return decide(
      'none',
      0,
      `tenure ${Math.floor(tenure)}d < ${MIN_TENURE_DAYS}d`
    );
  }

  const elapsed = daysBetween(grantClockOrigin(input), now);
  if (elapsed < PERIOD_DAYS) {
    return decide(
      'none',
      0,
      `${Math.floor(elapsed)}d into a ${PERIOD_DAYS}d period`
    );
  }

  // Room is measured against the FULL grant, not a partial one. Topping a
  // member up to exactly their cap would need the balance we read to still be
  // true at write time, and the write is a conditional increment precisely so a
  // member spending mid-pass cannot be clobbered. The cost is an under-grant of
  // less than `perPeriod` at the ceiling, which self-corrects as they spend.
  if (input.balance > input.cap - input.perPeriod) {
    return decide(
      'advance',
      0,
      `at cap (${input.balance}/${input.cap}) — period spent`
    );
  }

  return decide(
    'grant',
    input.perPeriod,
    `+${input.perPeriod} (${input.balance}/${input.cap})`
  );
};
