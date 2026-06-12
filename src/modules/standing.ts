/**
 * PRD-05 #2 / ADR-0004 — governance standing computation.
 *
 * Pure function: roll a user's active `UserWarning` rows + ban state into the
 * `Standing` tier that the PRD-05 CRS backbone reads (and that `ruleImpact()`
 * consumes — this is the producer for that scorer's `standing` input). No DB; the
 * caller fetches the rows and passes a clock, so accrual/expiry/ban transitions
 * are all deterministically testable.
 *
 * ADR-0004 is "Proposed — pending": the LADDER (banned/evasion → hammer, frequent
 * warnings → poor/hammer, long clean tenure → pristine) is the settled structure;
 * the THRESHOLDS below are flagged placeholders (magnitudes TBD per the ADR + the
 * PRD-05 open questions). Change the constants here + the spec together.
 */

/**
 * The governance standing tier — the PRD-05 CRS backbone. ADR-0004 owns this
 * concept, so it is defined canonically here. `ruleImpact()` (PRD-05 #1) declares
 * a structurally-identical `Standing` and consumes this tier as its scaling input;
 * once both slices land in main, fold ruleImpact's copy into an import from here.
 */
export type Standing = 'pristine' | 'clean' | 'neutral' | 'poor' | 'hammer';

/** The subset of a `UserWarning` row the computation needs. */
export interface WarningRecord {
  /** null = a permanent warning; a date = expires then (past = no longer active). */
  expiresAt: Date | null;
}

export interface StandingInput {
  /** The user's warning rows (active + expired); filtered by `now` internally. */
  warnings: WarningRecord[];
  /** True when the user is banned (`User.banDate` is set). */
  banned: boolean;
  /**
   * ADR-0004 ban-evasion linkage signal — the worst standing. NOT yet fed by any
   * caller: the invite-tree/account linkage that would set it is the unfinished
   * part of ADR-0004's entity model. Wired here as the seam (and unit-tested) so
   * the computation is ready; until that model lands it is always undefined.
   */
  banEvasion?: boolean;
  /** Clock for expiry evaluation — passed in to keep the function pure. */
  now: Date;
  /** Account tenure in days; long clean tenure earns the pristine tier. */
  accountAgeDays?: number;
}

// Thresholds — ADR-0004 TBD placeholders; the ladder shape is what's settled.
const POOR_AT = 2; // 2+ active warnings → poor
const HAMMER_AT = 4; // 4+ active warnings → "the mighty hammer" (frequent)
const PRISTINE_TENURE_DAYS = 365; // a clean year → pristine (the ×10 reward)

/** A warning counts while permanent (no expiry) or not yet expired at `now`. */
export const isWarningActive = (w: WarningRecord, now: Date): boolean =>
  w.expiresAt === null || w.expiresAt.getTime() > now.getTime();

export const computeStanding = (input: StandingInput): Standing => {
  // Ban (and ban evasion) is terminal — the hammer, regardless of warning count.
  if (input.banned || input.banEvasion) return 'hammer';

  const active = input.warnings.filter((w) =>
    isWarningActive(w, input.now)
  ).length;

  if (active >= HAMMER_AT) return 'hammer'; // frequent warnings compound to the hammer
  if (active >= POOR_AT) return 'poor';
  if (active === 1) return 'neutral';

  // Zero active warnings: long clean tenure is pristine, otherwise merely clean.
  return (input.accountAgeDays ?? 0) >= PRISTINE_TENURE_DAYS
    ? 'pristine'
    : 'clean';
};
