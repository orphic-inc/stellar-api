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
import { scoreStylesheetTier } from './stylesheetScore';
import {
  contagion,
  CONTAGION_FLOOR,
  CONTAGION_REVIEW_THRESHOLD
} from './contagion';
import { getInfectedAncestorDistances } from './user';
import { communityHealthFor } from './communityHealthHistory';
import { gradeContribution } from './contributionQuality';

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
  /** Direct invitees that are active (not disabled) AND contributing (>0 bytes).
   *  The core "successful invitation" positive signal. Defaults to 0. */
  inviteActiveContributing?: number;
  /** Direct invitees whose account age is past the long-lived threshold — a
   *  weaker positive (durable referrals). Defaults to 0. */
  inviteLongLived?: number;
  /** Direct invitees that are banned (disabled) — penalises invitation abuse /
   *  disposable accounts. Defaults to 0. */
  inviteBanned?: number;
  /** Direct invitees that are low-quality — an active warning, or dormant
   *  (no recent login). Penalises weak referrals. Defaults to 0. */
  inviteLowQuality?: number;
  /** Number of donations this user has made — feeds supportConsistency.
   *  Amount is deliberately NOT read (recognition, not pay-to-win). Defaults to 0. */
  donationCount?: number;
  /** Years between this user's first and last donation — feeds supportLongevity.
   *  0 when fewer than two donations. Defaults to 0. */
  donationSpanYears?: number;
  /** Per contributed-to community: that community's latest link-health pulse +
   *  coverage, and the member's weight there. The weight is the sum of the
   *  member's per-contribution quality grades in that community (#76), so a
   *  lossless/logged/cued rip pulls more than a transcode. Feeds the signed
   *  CommunityScore dimension (#75 / ADR-0017). Defaults to []. */
  communityHealth?: Array<{
    pulse: number | null;
    coverage: number | null;
    weight: number;
  }>;
  /** Mean per-contribution confirmed-PASS uptime fraction (R), in [0,1] — the
   *  reliability term of the lifetime link-health dimension (#95 / ADR-0019).
   *  Defaults to 0. */
  linkHealthReliability?: number;
  /** Total banked confirmed-PASS time across this member's contributions, in
   *  healthy-link-years (H) — the volume×duration term of the same dimension.
   *  Defaults to 0. */
  linkHealthYears?: number;
  /** Hops UP this member's invite chain (1 = direct inviter) to each *infected*
   *  (banned) ancestor, capped at the contagion reach. Feeds the signed
   *  `inviteContagion` dimension (#155 / ADR-0004 §3). Defaults to []. */
  infectedAncestorDistances?: number[];
  /** Injectable for deterministic tests; defaults to now. */
  now?: Date;
}

export interface DimensionScorer {
  name: string;
  weight: number;
  cap: number;
  /** Lower bound for the subScore. Defaults to 0 (non-negative, like every
   *  dimension to date). A *signed* dimension — CommunityScore, whose poor-health
   *  term subtracts (#75) — sets a negative floor so the aggregator keeps the
   *  penalty instead of clamping it to 0. */
  floor?: number;
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
  /** ADR-0004 §3 invite-tree Contagion review flag — true when the member sits
   *  close/dense enough to a banned trunk to warrant a moderator look. A
   *  *moderation* signal: stripped from non-staff views (see
   *  `filterReputationView`) so suspicion can't tip off a sockpuppet ring. */
  suspect: boolean;
}

const clamp = (value: number, cap: number, floor = 0): number =>
  Math.max(floor, Math.min(cap, value));

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
// Deliberately thin (cap 2) — a small signal until real IRC traffic exists to
// justify more. Pinned with the other CRS magnitudes (PRD-02 #141).
const IRC_CAP = 2;
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
// An author's reward for others adopting their stylesheets (PRD-03). The score
// is `scoreStylesheetTier` over the durable count of distinct (adopter, author)
// adoptions read from the ledger — a back-loaded marginal curve, not a flat
// per-adoption rate. Computed on read (ADR-0007): nothing stores a denormalized
// stylesheet score. Anti-farm is the `/private` invite + report model's job
// (PRD-03), not a bespoke cap.
//
// The reward shape is PRD-03 target #2 (#121): a back-loaded marginal tiering
// curve over the distinct-adoption count — `scoreStylesheetTier` owns the
// magnitude (and the base anchor) so this dimension is just the read-time wiring.
// The cap is the module's standard "no single dimension dominates" guardrail;
// the curve is calibrated to reach it (~adoption 16) only by sustained adoption.
// The ledger row stays a pure (adopter, author) event marker — the curve swaps
// without touching it.
const STYLESHEET_CAP = 6;
const STYLESHEET_WEIGHT = 1.0;

const stylesheetScorer: DimensionScorer = {
  name: 'stylesheet',
  weight: STYLESHEET_WEIGHT,
  cap: STYLESHEET_CAP,
  compute: ({ stylesheetAdoptions = 0 }) =>
    scoreStylesheetTier(stylesheetAdoptions)
};

// ─── InviteScore ──────────────────────────────────────────────────────────
// Referral genealogy (PRD-01 InviteTree): "users inherit reputation from
// successful invitations." Scored over the inviter's DIRECT invitees only (v1;
// subtree trust-inheritance deferred). Positive signals — active+contributing
// and (weaker) long-lived invitees — raise it with diminishing returns; banned
// and low-quality (warned/dormant) invitees erode it. Floored at 0 so invite
// abuse can't push the dimension negative (the other dimensions are non-negative
// too — penalties bound the *gain*, not the floor).
// PROVISIONAL (tier-0): caps/weights/thresholds are interim, to tune with the PRD.
const INVITE_CAP = 5;
const INVITE_TAU = 4; // ~4 good invitees → ~63% of cap
const INVITE_LONGLIVED_WEIGHT = 0.5;
const INVITE_BANNED_WEIGHT = 1.0;
const INVITE_LOWQUALITY_WEIGHT = 0.5;
const INVITE_WEIGHT = 1.0;
// Classification thresholds (read by the assembler, not the pure scorer):
const INVITE_LONGLIVED_YEARS = 1; // invitee account age past this = long-lived
const INVITE_DORMANT_DAYS = 180; // no login in this window = dormant (low-quality)

const inviteScorer: DimensionScorer = {
  name: 'invite',
  weight: INVITE_WEIGHT,
  cap: INVITE_CAP,
  compute: ({
    inviteActiveContributing = 0,
    inviteLongLived = 0,
    inviteBanned = 0,
    inviteLowQuality = 0
  }) => {
    const positive =
      Math.max(0, inviteActiveContributing) +
      INVITE_LONGLIVED_WEIGHT * Math.max(0, inviteLongLived);
    const penalty =
      INVITE_BANNED_WEIGHT * Math.max(0, inviteBanned) +
      INVITE_LOWQUALITY_WEIGHT * Math.max(0, inviteLowQuality);
    const net = Math.max(0, positive - penalty);
    return INVITE_CAP * (1 - Math.exp(-net / INVITE_TAU));
  }
};

// ─── InviteContagion ──────────────────────────────────────────────────────────
// The negative governance arm of the invite tree (ADR-0004 §3 / PRD-05, #155):
// an infected trunk (a banned inviter) casts graded, distance-decaying suspicion
// down over its descendants. A *signed* dimension (cap 0, no upside — a healthy
// genealogy isn't a reward, just the absence of a drag) with a negative floor,
// like CommunityScore. The magnitude + decay live in `contagion()`; this is the
// read-time wiring over the per-member distances to banned ancestors.
const inviteContagionScorer: DimensionScorer = {
  name: 'inviteContagion',
  weight: 1.0,
  cap: 0,
  floor: CONTAGION_FLOOR,
  compute: ({ infectedAncestorDistances = [] }) =>
    contagion(infectedAncestorDistances).score
};

// ─── DonationScore ──────────────────────────────────────────────────────────
// Financial support (PRD-01 Donations): "recognition, not pay-to-win" —
// donation *value must never dominate*. So this is AMOUNT-AGNOSTIC: it never
// reads `amount`. DonationScore = supportConsistency (how many donations, with
// diminishing returns) + supportLongevity (how long support has been sustained,
// first→last span). The dimension cap is deliberately the lowest of all
// dimensions so donations can't outweigh participation/trust.
// PROVISIONAL (tier-0): caps/taus interim, to tune with the PRD.
const DONATION_CONSISTENCY_CAP = 2;
const DONATION_CONSISTENCY_TAU = 3; // 3 donations → ~63% of the consistency cap
const DONATION_LONGEVITY_CAP = 1;
const DONATION_LONGEVITY_TAU = 2; // 2 years of support → ~63% of the longevity cap
const DONATION_CAP = DONATION_CONSISTENCY_CAP + DONATION_LONGEVITY_CAP;
const DONATION_WEIGHT = 1.0;

const donationScorer: DimensionScorer = {
  name: 'donation',
  weight: DONATION_WEIGHT,
  cap: DONATION_CAP,
  compute: ({ donationCount = 0, donationSpanYears = 0 }) => {
    const consistency =
      DONATION_CONSISTENCY_CAP *
      (1 - Math.exp(-Math.max(0, donationCount) / DONATION_CONSISTENCY_TAU));
    const longevity =
      DONATION_LONGEVITY_CAP *
      (1 - Math.exp(-Math.max(0, donationSpanYears) / DONATION_LONGEVITY_TAU));
    return consistency + longevity;
  }
};

// ─── CommunityScore ─────────────────────────────────────────────────────────
// Community stewardship (PRD-01 / ADR-0002 / ADR-0017). Folds the link-health of
// the communities a member has CONTRIBUTED to into their single global CRS — a
// contribution-gated collective signal (mere membership earns nothing, so a
// lurker in a healthy community can't farm it). It is *signed*: a healthy
// community rewards, a Critical one penalises, with a deliberately shallow
// negative floor so others' link-rot nudges rather than craters a member's score.
//
// Per community, the live pulse (`pass/checked`, ADR-0002) maps to a signed value
// around the Critical-edge neutral (0.60 = PULSE_AILING): at/above neutral →
// 0…+CAP toward a perfect 1.0; below → 0…−FLOOR toward 0. Communities reading
// Unknown (coverage below PULSE_MIN_COVERAGE 0.5) are excluded. The per-community
// values are averaged weighted by the member's stake there — the SUM of their
// per-contribution quality grades (#76, `gradeContribution`), so lossless/logged/
// cued rips pull more than transcodes and the member is more answerable (reward
// AND penalty) for communities they invested quality in. Inherently bounded in
// [−FLOOR, +CAP]. The weight is assembled upstream; the scorer stays pure.
//
// PROVISIONAL (tier-0): caps/floor are interim.
const COMMUNITY_POS_CAP = 4;
const COMMUNITY_NEG_FLOOR = 1; // shallow — the soft penalty
const COMMUNITY_NEUTRAL = 0.6; // = linkHealth PULSE_AILING (Critical edge)
const COMMUNITY_MIN_COVERAGE = 0.5; // = linkHealth PULSE_MIN_COVERAGE (Unknown floor)
const COMMUNITY_WEIGHT = 1.0;
// Ungradeable contributions (no bitrate / no ReleaseFile) still count toward the
// community weight, at the lowest tier — so legacy/unprobed data isn't erased,
// but verifiable quality counts more (#76). Matches LowLossy's grade score.
const UNKNOWN_GRADE_WEIGHT = 0.3;

const communityScorer: DimensionScorer = {
  name: 'community',
  weight: COMMUNITY_WEIGHT,
  cap: COMMUNITY_POS_CAP,
  floor: -COMMUNITY_NEG_FLOOR,
  compute: ({ communityHealth = [] }) => {
    let weighted = 0;
    let weightSum = 0;
    for (const c of communityHealth) {
      // Unknown (unprobed / low coverage) contributes neither + nor −.
      if (
        c.pulse === null ||
        c.coverage === null ||
        c.coverage < COMMUNITY_MIN_COVERAGE
      ) {
        continue;
      }
      const weight = Math.max(0, c.weight);
      if (weight === 0) continue;
      const value =
        c.pulse >= COMMUNITY_NEUTRAL
          ? (COMMUNITY_POS_CAP * (c.pulse - COMMUNITY_NEUTRAL)) /
            (1 - COMMUNITY_NEUTRAL)
          : (-COMMUNITY_NEG_FLOOR * (COMMUNITY_NEUTRAL - c.pulse)) /
            COMMUNITY_NEUTRAL;
      weighted += weight * value;
      weightSum += weight;
    }
    return weightSum === 0 ? 0 : weighted / weightSum;
  }
};

// ─── LinkHealthScore ──────────────────────────────────────────────────────────
// Cumulative lifetime link-health (PRD-01 "Reliability Matters"; #95 / ADR-0019).
// The positive mirror of the dead-link/flapping penalties: rewards a member for
// keeping THEIR OWN contributions' download links alive over the account's life.
// Distinct from `community` (the COMMUNITY's pulse weighted by your stake —
// signed/collective) and from `longevity` (account age, no links needed).
//
// Two factors, both derived from the per-contribution confirmed-PASS accumulator
// (Contribution.healthyMs/healthySince, fed by linkHealth.ts):
//   R = mean per-contribution PASS fraction (passMs / age), [0,1] — "are your
//       links rotting?"; volume-agnostic, so dumping links can't farm it, and a
//       rotted catalogue lowers lifetime reliability (the point).
//   H = banked confirmed-PASS time in healthy-link-years — "how much uptime have
//       you actually accumulated?"; captures volume AND duration in one term.
//   subScore = CAP × R × (1 − exp(−H / H_TAU))
// Both factors ∈ [0,1] ⇒ bounded by CAP by construction (the PRD "no single axis
// dominates" guardrail). R leads as a true multiplier (rotted links ⇒ ~0 whatever
// H is); a fresh account dumping links has R≈1 but H≈0 ⇒ ~0, so the dimension
// can't be farmed instantly — only sustained uptime banks H. PASS-only accrual
// lives in the substrate; this scorer is pure.
//
// PROVISIONAL (tier-0): CAP tied with RatioScore (both read the contribution-
// availability substrate — current vs lifetime timescale), H_TAU mirrors
// LONGEVITY_TAU_YEARS. Tune alongside the PRD.
const LINK_HEALTH_CAP = 8;
const LINK_HEALTH_TAU_YEARS = 3; // ~63% of the volume curve at 3 banked link-years
const LINK_HEALTH_WEIGHT = 1.0;

const linkHealthScorer: DimensionScorer = {
  name: 'linkHealth',
  weight: LINK_HEALTH_WEIGHT,
  cap: LINK_HEALTH_CAP,
  compute: ({ linkHealthReliability = 0, linkHealthYears = 0 }) => {
    const r = Math.max(0, Math.min(1, linkHealthReliability));
    const h = Math.max(0, linkHealthYears);
    return LINK_HEALTH_CAP * r * (1 - Math.exp(-h / LINK_HEALTH_TAU_YEARS));
  }
};

// Registry — add a dimension here (Invite, Donation, …) and the aggregator
// picks it up unchanged.
const REGISTRY: DimensionScorer[] = [
  longevityScorer,
  ratioScorer,
  friendsScorer,
  inviteScorer,
  inviteContagionScorer,
  donationScorer,
  communityScorer,
  linkHealthScorer,
  ircScorer,
  stylesheetScorer
];

/** Pure aggregator: sum each capped dimension's weighted subScore. */
export const computeCrs = (input: DimensionInput): CrsResult => {
  const dimensions = REGISTRY.map((d) => {
    const subScore = clamp(d.compute(input), d.cap, d.floor ?? 0);
    return { name: d.name, subScore, weighted: d.weight * subScore };
  });
  const score = dimensions.reduce((sum, d) => sum + d.weighted, 0);
  // The contagion review flag is a function of the computed drag (ADR-0004 §3).
  const contagionDim = dimensions.find((d) => d.name === 'inviteContagion');
  const suspect = (contagionDim?.subScore ?? 0) <= CONTAGION_REVIEW_THRESHOLD;
  return { score, dimensions, suspect };
};

/** Read-time CRS for a user. Assembles the dimension input, then computes. */
export const getReputation = async (userId: number): Promise<CrsResult> => {
  const now = new Date();
  const longLivedBefore = new Date(
    now.getTime() - INVITE_LONGLIVED_YEARS * YEAR_MS
  );
  const dormantBefore = new Date(
    now.getTime() - INVITE_DORMANT_DAYS * 24 * 60 * 60 * 1000
  );

  const [
    user,
    friendCount,
    stylesheetAdoptions,
    stylesheetAdoptionsMade,
    invitees,
    donationAgg,
    contributedContributions,
    infectedAncestorDistances
  ] = await Promise.all([
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
    }),
    // Direct invitees (depth 1) with the fields needed to classify each into the
    // InviteScore signals. N is small (a user's direct referrals), so classify
    // in JS rather than running four count queries.
    prisma.inviteTree.findMany({
      where: { inviterId: userId },
      select: {
        user: {
          select: {
            disabled: true,
            contributed: true,
            dateRegistered: true,
            lastLogin: true,
            // One active warning is enough to flag low-quality.
            warnings: {
              where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
              select: { id: true },
              take: 1
            }
          }
        }
      }
    }),
    // Amount-agnostic: only the count and the first→last span feed DonationScore.
    prisma.donation.aggregate({
      where: { userId },
      _count: { _all: true },
      _min: { donatedAt: true },
      _max: { donatedAt: true }
    }),
    // ALL of the user's contributions — one widened fetch feeding two dimensions
    // (#95 / ADR-0019): the grade inputs (`type` off the spine, `bitrate`/`hasLog`/
    // `hasCue` off the ReleaseFile satellite) summed per community for the
    // CommunityScore weight (#76, community contributions only — non-community
    // ones skip the weight loop below), AND the per-contribution confirmed-PASS
    // uptime (`createdAt`/`linkStatus`/`healthyMs`/`healthySince`) reduced to the
    // R/H of the lifetime link-health dimension. Widened from community-only so a
    // non-community release's link still counts toward link health.
    // NOTE (read-path cost): this fetches every contribution on each reputation
    // read (every profile view, #193) — the grade lives in TS, so it can't move
    // to a SQL aggregate without duplicating the logic, and the R/H reduction now
    // rides the same scan (extra CPU, no extra query). Memoising the per-(user,
    // community) weight is folded into the substrate follow-up (#195).
    prisma.contribution.findMany({
      where: { userId },
      select: {
        type: true,
        createdAt: true,
        linkStatus: true,
        healthyMs: true,
        healthySince: true,
        release: { select: { communityId: true } },
        releaseFile: {
          select: { bitrate: true, hasLog: true, hasCue: true }
        }
      }
    }),
    // Distances up the invite chain to each banned ancestor (#155 / ADR-0004 §3).
    getInfectedAncestorDistances(userId)
  ]);
  if (!user) return { score: 0, dimensions: [], suspect: false };

  // Sum each contributed-to community's quality-graded weight (#76).
  const weightByCommunity = new Map<number, number>();
  for (const contribution of contributedContributions) {
    const communityId = contribution.release.communityId;
    if (communityId === null) continue;
    const { score } = gradeContribution({
      type: contribution.type,
      bitrate: contribution.releaseFile?.bitrate ?? null,
      hasLog: contribution.releaseFile?.hasLog,
      hasCue: contribution.releaseFile?.hasCue
    });
    // Ungradeable → lowest-tier weight, so legacy/unprobed data still counts.
    const weight = score ?? UNKNOWN_GRADE_WEIGHT;
    weightByCommunity.set(
      communityId,
      (weightByCommunity.get(communityId) ?? 0) + weight
    );
  }

  // Fold each community's latest pulse (via the pluggable port, ADR-0017) and the
  // member's quality weight into the signed CommunityScore (#75 / #76).
  const communityIds = [...weightByCommunity.keys()];
  const pulses = await communityHealthFor(communityIds);
  const communityHealth = communityIds.map((id) => {
    const health = pulses.get(id);
    return {
      pulse: health?.pulse ?? null,
      coverage: health?.coverage ?? null,
      weight: weightByCommunity.get(id) ?? 0
    };
  });

  // Lifetime link-health (#95 / ADR-0019), from the same widened fetch: reliability
  // R = mean per-contribution confirmed-PASS fraction; H = total banked PASS time
  // in healthy-link-years. The live open segment (`healthySince`) is folded in at
  // read time. A contribution with no banked uptime (dead/never-PASS) contributes
  // a 0 fraction, dragging R down — a rotted catalogue lowers lifetime reliability.
  let reliabilitySum = 0;
  let healthyMsTotal = 0n;
  for (const contribution of contributedContributions) {
    const liveHealthyMs =
      contribution.healthyMs +
      (contribution.healthySince
        ? BigInt(
            Math.max(0, now.getTime() - contribution.healthySince.getTime())
          )
        : 0n);
    healthyMsTotal += liveHealthyMs;
    const ageMs = now.getTime() - contribution.createdAt.getTime();
    reliabilitySum +=
      ageMs > 0 ? Math.min(1, Number(liveHealthyMs) / ageMs) : 0;
  }
  const linkHealthReliability =
    contributedContributions.length > 0
      ? reliabilitySum / contributedContributions.length
      : 0;
  const linkHealthYears = Number(healthyMsTotal) / YEAR_MS;

  // Classify direct invitees into the four InviteScore signal counts.
  let inviteActiveContributing = 0;
  let inviteLongLived = 0;
  let inviteBanned = 0;
  let inviteLowQuality = 0;
  for (const { user: invitee } of invitees) {
    if (invitee.disabled) {
      inviteBanned++;
      continue; // a banned invitee is only a negative signal
    }
    if (invitee.contributed > 0n) inviteActiveContributing++;
    if (invitee.dateRegistered <= longLivedBefore) inviteLongLived++;
    const dormant = !invitee.lastLogin || invitee.lastLogin < dormantBefore;
    if (invitee.warnings.length > 0 || dormant) inviteLowQuality++;
  }

  const donationCount = donationAgg._count._all;
  const firstAt = donationAgg._min.donatedAt;
  const lastAt = donationAgg._max.donatedAt;
  const donationSpanYears =
    firstAt && lastAt
      ? Math.max(0, lastAt.getTime() - firstAt.getTime()) / YEAR_MS
      : 0;

  return computeCrs({
    userId,
    createdAt: user.createdAt,
    ratio: computeRatio(user.contributed, user.consumed),
    contributed: user.contributed,
    friendCount,
    ircNick: user.ircNick,
    stylesheetAdoptions,
    stylesheetAdoptionsMade,
    inviteActiveContributing,
    inviteLongLived,
    inviteBanned,
    inviteLowQuality,
    donationCount,
    donationSpanYears,
    communityHealth,
    linkHealthReliability,
    linkHealthYears,
    infectedAncestorDistances,
    now
  });
};

// Dimensions derived from a member's snatches (downloads/consumed). When a
// viewer's paranoia hides consumed stats, these are dropped from the reputation
// VIEW too, so the score they see can't leak the hidden activity. RatioScore is
// the only consumed-derived dimension (ratio = contributed / consumed).
export const SNATCH_DERIVED_DIMENSIONS = ['ratio'];

// Moderation-only dimensions: the invite-tree Contagion drag is a suspicion
// signal (ADR-0004 §3). Hidden from non-staff views — including the member's own
// — so the penalty + flag can't tip off a sockpuppet ring. The drag still counts
// in the true internal CRS (`getReputation`); only the projected VIEW omits it.
export const MODERATION_DIMENSIONS = ['inviteContagion'];

/**
 * Project a computed CRS into a viewer-safe view by dropping dimensions the
 * viewer isn't entitled to and recomputing the displayed score from what
 * remains — so a gated viewer neither sees a hidden dimension nor can back it
 * out of the total. Two independent gates: `includeSnatchDerived` (paranoia —
 * hides consumed-derived `ratio`) and `includeModeration` (staff-only — hides
 * the invite-tree Contagion drag + clears the `suspect` flag). Pure.
 */
export const filterReputationView = (
  crs: CrsResult,
  opts: { includeSnatchDerived: boolean; includeModeration: boolean }
): CrsResult => {
  if (opts.includeSnatchDerived && opts.includeModeration) return crs;
  const hidden = [
    ...(opts.includeSnatchDerived ? [] : SNATCH_DERIVED_DIMENSIONS),
    ...(opts.includeModeration ? [] : MODERATION_DIMENSIONS)
  ];
  const dimensions = crs.dimensions.filter((d) => !hidden.includes(d.name));
  // Recompute from the visible dimensions so a gated viewer can't back a hidden
  // dimension out of the total.
  const score = dimensions.reduce((sum, d) => sum + d.weighted, 0);
  return {
    score,
    dimensions,
    suspect: opts.includeModeration ? crs.suspect : false
  };
};
