/**
 * ADR-0004 §3 / PRD-05 — invite-tree Contagion.
 *
 * Pure function: an infected trunk (a banned — or, when that model lands,
 * confirmed-evading — inviter) casts graded, distance-decaying suspicion DOWN
 * over its branches. The negative governance arm of the invite tree, the
 * counterpart to the positive `invite` CRS dimension.
 *
 * Deliberately NOT terminal: a clean member is *suspect*, never condemned,
 * because a distant inviter was later banned — distance-decay (not recency) is
 * the dampener. The terminal confirmed-self-evasion rung is a separate seam
 * (`computeStanding`'s `banEvasion`) and is never reached here.
 *
 * No DB and direction-agnostic: it consumes the distances from a member UP to
 * each infected ancestor (the read path walks the inviter chain, capped at
 * REACH), mirroring the pure style of `computeStanding` / `ruleImpact`.
 * Magnitudes are pinned (#155) and tunable here in one place.
 */

export interface Contagion {
  /** The CRS drag — ≤ 0, clamped to FLOOR. 0 for a clean genealogy. */
  score: number;
  /** True when the drag warrants a moderation review (score ≤ REVIEW_THRESHOLD). */
  suspect: boolean;
}

// Suspicion halves each level away from the infected trunk and is out of reach
// past level 4 (1/8 of base is already near-noise). Steep on purpose — a
// distant-but-clean member must not be condemned by an ancestor's later ban.
const REACH = 4;
const DECAY = 0.5; // per-level multiplier: mult(d) = DECAY^(d-1)
const BASE = -1.0; // drag from a *direct* invitee of an infected trunk (distance 1)
const FLOOR = -2.0; // most contagion can ever subtract (dense bad genealogy)
const REVIEW_THRESHOLD = -0.5; // ≤ this surfaces a moderation review flag

export const CONTAGION_FLOOR = FLOOR;
export const CONTAGION_REVIEW_THRESHOLD = REVIEW_THRESHOLD;
/** How far up the inviter chain the read path walks — beyond this, drag is 0. */
export const CONTAGION_REACH = REACH;

/** Drag contributed by one infected ancestor `distance` hops up (0 past REACH). */
const dragAt = (distance: number): number =>
  distance >= 1 && distance <= REACH ? BASE * DECAY ** (distance - 1) : 0;

export const contagion = (infectedAncestorDistances: number[]): Contagion => {
  // Cumulative: multiple infected ancestors compound (a denser bad cluster is
  // stronger evidence), then clamp so the worst case stays suspect, not condemned.
  const raw = infectedAncestorDistances.reduce((sum, d) => sum + dragAt(d), 0);
  const score = Math.max(FLOOR, raw);
  return { score, suspect: score <= REVIEW_THRESHOLD };
};
