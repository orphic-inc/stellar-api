/**
 * Inactivity evaluator — the pure core of the dormancy lifecycle (#279,
 * ADR-0038).
 *
 * Given one user's timestamps and exemption flags plus a clock, it decides
 * whether to warn, disable, or leave alone. No DB and no I/O live here, so the
 * whole warn/disable/exemption matrix is deterministically unit-testable; the
 * DB-bound sweep (inactivityJob) supplies the inputs and applies the outcome.
 *
 * The thresholds are constants rather than configuration on purpose: this is a
 * policy that disables member accounts, so changing it should be a code change
 * with a review and a changelog entry, not an environment variable someone can
 * mistype into 11. The operational dials (`mode`, the per-cycle cap) are
 * separate and live in config, because they bound blast radius rather than
 * define the rule.
 */

/** Warn once the account has been idle this long. */
export const WARN_AFTER_DAYS = 110;
/** Disable once it has been idle this long, and not before. */
export const DISABLE_AFTER_DAYS = 120;
/**
 * A warning must have been sent at least this long before a disable. The gap
 * is enforced against the stamp rather than the calendar, so a job that was
 * down for a month cannot warn and disable a user in a single catch-up pass —
 * which is the whole reason the stamp is persisted rather than recomputed.
 */
export const WARN_GRACE_DAYS = 7;
/** An account that registered and never returned is swept after this long. */
export const NEVER_LOGGED_IN_DAYS = 7;

export const DAY_MS = 86_400_000;

export interface InactivityInput {
  /** Null for an account that has never authenticated through the login form. */
  lastLogin: Date | null;
  dateRegistered: Date;
  /** Stamped by the staff re-enable; see `lastActivityAt`. */
  reactivatedAt: Date | null;
  /** Stamped when the warning is sent, cleared on login. */
  inactivityWarnedAt: Date | null;
  disabled: boolean;
  isDonor: boolean;
  rankLocked: boolean;
  /** Rank level; staff and above are never auto-managed. */
  rankLevel: number;
  /**
   * True when an admin created this account rather than the owner registering
   * it — derived from the `user.create` audit row, which self-registration does
   * not write. Only the never-logged-in sweep reads it.
   */
  adminCreated: boolean;
}

export type InactivityAction = 'none' | 'warn' | 'disable';

export interface InactivityDecision {
  action: InactivityAction;
  /** Human-readable why — for the dry-run log and the audit note. */
  reason: string;
}

/** Ranks at or above this level are assigned, never auto-managed. */
export const STAFF_LEVEL = 500;

/**
 * The dormancy clock: the most recent moment we have evidence the account was
 * wanted. All three terms are needed, because each alone is wrong for some
 * account — a member who registered and never returned has no `lastLogin`, and
 * one staff have just reinstated has a stale one.
 */
export const lastActivityAt = (input: InactivityInput): Date => {
  const candidates = [input.dateRegistered];
  if (input.lastLogin) candidates.push(input.lastLogin);
  if (input.reactivatedAt) candidates.push(input.reactivatedAt);
  return candidates.reduce((a, b) => (b > a ? b : a));
};

const daysBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / DAY_MS;

const decide = (
  action: InactivityAction,
  reason: string
): InactivityDecision => ({ action, reason });

/**
 * Decide what to do with one account.
 *
 * Order matters: exemptions are checked before anything else so an exempt user
 * is never warned either, and the disable arm is checked before the warn arm so
 * an account that is past both thresholds and already warned is disabled rather
 * than re-warned forever.
 */
export const evaluateInactivity = (
  input: InactivityInput,
  now: Date
): InactivityDecision => {
  if (input.disabled) return decide('none', 'already disabled');
  if (input.rankLevel >= STAFF_LEVEL)
    return decide('none', 'staff rank — never auto-managed');
  if (input.rankLocked)
    return decide('none', 'rankLocked — engine will not touch this user');
  if (input.isDonor) return decide('none', 'active donor');

  // Never-logged-in sweep. Keyed on the same clock as everything else, so a
  // reinstated account is not immediately re-swept: `lastLogin` is still null
  // after a re-enable, and only `reactivatedAt` says otherwise.
  if (input.lastLogin === null && input.reactivatedAt === null) {
    if (input.adminCreated)
      return decide('none', 'admin-created and not yet used');
    const age = daysBetween(input.dateRegistered, now);
    return age >= NEVER_LOGGED_IN_DAYS
      ? decide('disable', `registered ${Math.floor(age)}d ago, never logged in`)
      : decide('none', 'registered recently, never logged in');
  }

  const idleDays = daysBetween(lastActivityAt(input), now);

  if (idleDays >= DISABLE_AFTER_DAYS && input.inactivityWarnedAt !== null) {
    const warnedDays = daysBetween(input.inactivityWarnedAt, now);
    if (warnedDays >= WARN_GRACE_DAYS) {
      return decide(
        'disable',
        `idle ${Math.floor(idleDays)}d, warned ${Math.floor(warnedDays)}d ago`
      );
    }
    return decide(
      'none',
      `idle ${Math.floor(idleDays)}d but warned only ${Math.floor(warnedDays)}d ago`
    );
  }

  if (idleDays >= WARN_AFTER_DAYS && input.inactivityWarnedAt === null) {
    return decide('warn', `idle ${Math.floor(idleDays)}d`);
  }

  return decide('none', `idle ${Math.floor(idleDays)}d`);
};
