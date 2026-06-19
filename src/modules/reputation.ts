/**
 * Community Reputation Score (CRS) — PRD-01.
 *
 * A registry of bounded, pure dimension-scorers (mirrors the pure-scoring
 * style of `stylesheetScore.ts` / `ratio.ts`). The score is:
 *
 *     CRS = Σ (weight_i × subScore_i)
 *
 * Each dimension's subScore is clamped to a per-dimension cap, so no single
 * axis can dominate — the PRD's "friend count alone should not determine
 * score" and "donation value should not dominate" guardrails are enforced as
 * caps, not hopes. The value is computed on read (ADR-0007); only events that
 * current state can't reconstruct are ledger-logged elsewhere.
 *
 * New dimensions self-register into REGISTRY; the aggregator never changes.
 * Weight/cap constants are tier-0 — tune alongside the PRD.
 */
import { prisma } from '../lib/prisma';
import { computeRatio } from './ratio';
import { getIrcScore } from './irc';
import { scoreStylesheetSelection } from './stylesheetScore';

/** What dimension scorers may read. Grows as dimensions are added; the
 *  assembler (`getReputation`) fetches it, keeping each scorer pure. */
export interface DimensionInput {
  userId: number;
  createdAt: Date;
  /** Current ratio (contributed/consumed). Defaults to the break-even 1.0. */
  ratio?: number;
  /** Lifetime contributed bytes — gates RatioScore so a fresh default account earns nothing. */
  contributed?: bigint;
  /** Number of friend relationships. Defaults to 0. */
  friendCount?: number;
  /** IRC nick linked to this account — used to look up the cached IRCScore. */
  ircNick?: string | null;
  /** Distinct (adopter, author) adoptions of this member's stylesheets — the
   *  durable count from the CRS_* ledger (ADR-0007), where this user is the
   *  author (credited). Defaults to 0. */
  stylesheetAdoptions?: number;
  /** Distinct adoptions this user *made* as the adopter (the `actorUserId` side
   *  of the same CRS_* ledger). Feeds the Friends-dimension controlled vector
   *  (#147). Defaults to 0. */
  stylesheetAdoptionsMade?: number;
  /** Injectable for deterministic tests; defaults to now. */
  now?: Date;
}

export interface DimensionScorer {
  name: string;
  weight: number;
  cap: number;
  /** Pure: no DB, no clock except `input.now`. Returns the raw (pre-clamp) subScore. */
  compute: (input: DimensionInput) => number;
}

export interface DimensionResult {
  name: string;
  subScore: number;
  weighted: number;
}

export interface CrsResult {
  score: number;
  dimensions: DimensionResult[];
}

const clamp = (value: number, cap: number): number =>
  Math.max(0, Math.min(cap, value));

// ─── LongevityScore ───────────────────────────────────────────────────────
// Continuity matters (PRD-01): account age positively influences reputation,
// with diminishing returns — asymptotic to the cap, each year worth less than
// the last. ~63% of cap at TAU years, ~86% at 2×TAU.
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const LONGEVITY_CAP = 10;
const LONGEVITY_TAU_YEARS = 3;
const LONGEVITY_WEIGHT = 1.0;

const longevityScorer: DimensionScorer = {
  name: 'longevity',
  weight: LONGEVITY_WEIGHT,
  cap: LONGEVITY_CAP,
  compute: ({ createdAt, now }) => {
    const ageYears =
      Math.max(0, (now ?? new Date()).getTime() - createdAt.getTime()) /
      YEAR_MS;
    return LONGEVITY_CAP * (1 - Math.exp(-ageYears / LONGEVITY_TAU_YEARS));
  }
};

// ─── RatioScore ───────────────────────────────────────────────────────────
// Reputation reflection of the Ratio mechanism, strictly one-way: CRS reads
// ratio, ratio never reads CRS (ADR-0006 / PRD-06). Rewards a net-contributor
// ratio with diminishing returns — but only once the user has demonstrated
// contribution (contributed > 0), so a fresh account at the default 1.0 ratio
// earns nothing. Non-negative: ratio enforcement (WATCH/LEECH_DISABLED) is the
// Ratio mechanism's job, not a CRS penalty.
const RATIO_CAP = 8;
const RATIO_TAU = 1.5; // ratio 1.5 → ~63% of cap, 3.0 → ~86%
const RATIO_WEIGHT = 1.0;

const ratioScorer: DimensionScorer = {
  name: 'ratio',
  weight: RATIO_WEIGHT,
  cap: RATIO_CAP,
  compute: ({ ratio = 1, contributed = 0n }) => {
    if (contributed <= 0n) return 0;
    return RATIO_CAP * (1 - Math.exp(-Math.max(0, ratio) / RATIO_TAU));
  }
};

// ─── FriendsScore ─────────────────────────────────────────────────────────
// A lightweight trust signal (PRD-01 "Relationships Matter"). The PRD is
// explicit that "friend count alone should not determine score", so this is
// deliberately the weakest dimension: a LOW cap and heavy diminishing returns,
// so even a huge friend list can't dominate longevity/ratio — and ring-farming
// hits the cap fast. The count is *accepted* friendships only (#60 request →
// accept lifecycle), so a one-sided request earns nothing until reciprocated.
// Further quality-weighting (friend account age, network diversity) is future
// work per the PRD.
const FRIENDS_CAP = 4;
const FRIENDS_TAU = 5; // 5 friends → ~63% of cap; diminishing hard after
const FRIENDS_WEIGHT = 1.0;

// Friends × Stylesheet — controlled vector (PRD-03, #147). Adopting another
// member's AuthorStylesheet is a weak social/trust edge, so each distinct
// adoption fires a SECOND accrual here in the Friends dimension — additive to,
// and separate from, the author reward in the `stylesheet` dimension. The
// adopter earns slightly more than the author (favour active curation), and the
// whole vector is bounded by its OWN per-user cap so ring/sock-puppet mass
// adoption flattens out and plain friending stays the stronger signal. Both
// counts are already deduped once-per-(adopter, author) by the ledger's partial
// unique index — no extra dedup here.
// PROVISIONAL (tier-0): the 0.2 / 0.1 weights are PRD-decided; ADOPTION_VECTOR_CAP
// is an interim magnitude to tune alongside the PRD.
const ADOPTION_ADOPTER_WEIGHT = 0.2;
const ADOPTION_AUTHOR_WEIGHT = 0.1;
const ADOPTION_VECTOR_CAP = 2;
// The dimension ceiling holds both signals: the friend-count curve (asymptotic
// to FRIENDS_CAP) plus the bounded adoption nudge, so the nudge is genuinely
// additive rather than competing with friends under one shared cap.
const FRIENDS_DIMENSION_CAP = FRIENDS_CAP + ADOPTION_VECTOR_CAP;

const friendsScorer: DimensionScorer = {
  name: 'friends',
  weight: FRIENDS_WEIGHT,
  cap: FRIENDS_DIMENSION_CAP,
  compute: ({
    friendCount = 0,
    stylesheetAdoptions = 0,
    stylesheetAdoptionsMade = 0
  }) => {
    const friendSignal =
      FRIENDS_CAP * (1 - Math.exp(-Math.max(0, friendCount) / FRIENDS_TAU));
    const adoptionVector = Math.min(
      ADOPTION_VECTOR_CAP,
      Math.max(0, stylesheetAdoptionsMade) * ADOPTION_ADOPTER_WEIGHT +
        Math.max(0, stylesheetAdoptions) * ADOPTION_AUTHOR_WEIGHT
    );
    return friendSignal + adoptionVector;
  }
};

// ─── IRCScore ─────────────────────────────────────────────────────────────
// PRD-01 v0.1.x. Reads the last flush window cached by ircJob.ts from korin.pink.
// Formula: activity × consistency × channelQuality (see irc.ts for definitions).
// Returns 0 if the user has no linked nick or no data in the current window —
// IRC presence is optional; absence is not penalised (ADR-0005).
const IRC_CAP = 6;
const IRC_WEIGHT = 1.0;

const ircScorer: DimensionScorer = {
  name: 'irc',
  weight: IRC_WEIGHT,
  cap: IRC_CAP,
  compute: ({ ircNick }) => {
    if (!ircNick) return 0;
    const raw = getIrcScore(ircNick);
    // getIrcScore returns [0,1]; scale up to cap so the dimension fills its range
    return raw !== null ? raw * IRC_CAP : 0;
  }
};

// ─── StylesheetScore ──────────────────────────────────────────────────────────
// An author's reward for others adopting their stylesheets (PRD-03). The CRS
// magnitude is sourced from the shared pure scorer `scoreStylesheetSelection`
// (the per-adoption author delta of a non-self `author` selection) so the value
// has a single home; this dimension only multiplies it by the durable count of
// distinct (adopter, author) adoptions read from the ledger. Computed on read
// (ADR-0007): nothing stores a denormalized stylesheet score. Anti-farm is the
// `/private` invite + report model's job (PRD-03), not a bespoke cap — the cap
// here is the module's standard "no single dimension dominates" guardrail.
//
// PROVISIONAL (tier-0): the per-adoption magnitude and cap are interim. The
// real reward shape is PRD-03 target #2 (BonusPoints tiering, TBD), which will
// swap these constants without touching the ledger — the ledger row stays a
// pure (adopter, author) event marker.
const STYLESHEET_AUTHOR_PER_ADOPTION =
  scoreStylesheetSelection({
    userId: 0,
    origin: { kind: 'author', authorId: 1 }
  }).author?.delta ?? 0;
const STYLESHEET_CAP = 6;
const STYLESHEET_WEIGHT = 1.0;

const stylesheetScorer: DimensionScorer = {
  name: 'stylesheet',
  weight: STYLESHEET_WEIGHT,
  cap: STYLESHEET_CAP,
  compute: ({ stylesheetAdoptions = 0 }) =>
    STYLESHEET_AUTHOR_PER_ADOPTION * Math.max(0, stylesheetAdoptions)
};

// Registry — add a dimension here (Invite, Donation, …) and the aggregator
// picks it up unchanged.
const REGISTRY: DimensionScorer[] = [
  longevityScorer,
  ratioScorer,
  friendsScorer,
  ircScorer,
  stylesheetScorer
];

/** Pure aggregator: sum each capped dimension's weighted subScore. */
export const computeCrs = (input: DimensionInput): CrsResult => {
  const dimensions = REGISTRY.map((d) => {
    const subScore = clamp(d.compute(input), d.cap);
    return { name: d.name, subScore, weighted: d.weight * subScore };
  });
  const score = dimensions.reduce((sum, d) => sum + d.weighted, 0);
  return { score, dimensions };
};

/** Read-time CRS for a user. Assembles the dimension input, then computes. */
export const getReputation = async (userId: number): Promise<CrsResult> => {
  const [user, friendCount, stylesheetAdoptions, stylesheetAdoptionsMade] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          createdAt: true,
          contributed: true,
          consumed: true,
          ircNick: true
        }
      }),
      // Accepted friendships in either direction (requester or recipient).
      prisma.friendRelationship.count({
        where: {
          status: 'accepted',
          OR: [{ requesterId: userId }, { recipientId: userId }]
        }
      }),
      // Distinct (adopter, author) pairs where this user is the author — one
      // ledger row per pair (deduped at write), so a plain count is the distinct
      // adoption count. Feeds both the stylesheet (author reward) and friends
      // (weak-tie nudge) dimensions.
      prisma.economyTransaction.count({
        where: { userId, reason: 'CRS_STYLESHEET_ADOPTION' }
      }),
      // The adopter side of the same ledger: distinct adoptions this user made.
      // Friends-dimension controlled vector only (#147).
      prisma.economyTransaction.count({
        where: { actorUserId: userId, reason: 'CRS_STYLESHEET_ADOPTION' }
      })
    ]);
  if (!user) return { score: 0, dimensions: [] };
  return computeCrs({
    userId,
    createdAt: user.createdAt,
    ratio: computeRatio(user.contributed, user.consumed),
    contributed: user.contributed,
    friendCount,
    ircNick: user.ircNick,
    stylesheetAdoptions,
    stylesheetAdoptionsMade
  });
};

// Dimensions derived from a member's snatches (downloads/consumed). When a
// viewer's paranoia hides consumed stats, these are dropped from the reputation
// VIEW too, so the score they see can't leak the hidden activity. RatioScore is
// the only consumed-derived dimension (ratio = contributed / consumed).
export const SNATCH_DERIVED_DIMENSIONS = ['ratio'];

/**
 * Project a computed CRS into a viewer-safe view. When `includeSnatchDerived`
 * is false, the snatch-derived dimensions are removed and the displayed score is
 * recomputed from the remaining weighted subscores — so a paranoia-gated viewer
 * neither sees the dimension nor can back it out of the total. Pure.
 */
export const filterReputationView = (
  crs: CrsResult,
  opts: { includeSnatchDerived: boolean }
): CrsResult => {
  if (opts.includeSnatchDerived) return crs;
  const dimensions = crs.dimensions.filter(
    (d) => !SNATCH_DERIVED_DIMENSIONS.includes(d.name)
  );
  const score = dimensions.reduce((sum, d) => sum + d.weighted, 0);
  return { score, dimensions };
};
