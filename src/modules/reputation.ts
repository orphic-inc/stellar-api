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
// (the model is a directed add, no reciprocity yet, #60) hits the cap fast.
// Quality-weighting (mutuality, friend account age, network diversity) is
// future work per the PRD.
const FRIENDS_CAP = 4;
const FRIENDS_TAU = 5; // 5 friends → ~63% of cap; diminishing hard after
const FRIENDS_WEIGHT = 1.0;

const friendsScorer: DimensionScorer = {
  name: 'friends',
  weight: FRIENDS_WEIGHT,
  cap: FRIENDS_CAP,
  compute: ({ friendCount = 0 }) =>
    FRIENDS_CAP * (1 - Math.exp(-Math.max(0, friendCount) / FRIENDS_TAU))
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

// Registry — add a dimension here (Invite, Donation, …) and the aggregator
// picks it up unchanged.
const REGISTRY: DimensionScorer[] = [
  longevityScorer,
  ratioScorer,
  friendsScorer,
  ircScorer
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
  const [user, friendCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, contributed: true, consumed: true, ircNick: true }
    }),
    prisma.friend.count({ where: { userId } })
  ]);
  if (!user) return { score: 0, dimensions: [] };
  return computeCrs({
    userId,
    createdAt: user.createdAt,
    ratio: computeRatio(user.contributed, user.consumed),
    contributed: user.contributed,
    friendCount,
    ircNick: user.ircNick
  });
};
