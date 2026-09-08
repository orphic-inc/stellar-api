// Pure Prisma *guard coverage* checker (#564). Mirrors the shape of
// openapiCompleteness.ts: no I/O here, so the comparison is trivially testable;
// the CLI wrapper (src/scripts/check-prisma-guard-coverage.ts) parses the real
// source tree, reads the real Prisma DMMF, and feeds the sites in.
//
// WHY THIS EXISTS:
//
// The global handler in app.ts is `err.statusCode ?? 500`, with FieldError its
// only special case — no Prisma error code is mapped anywhere. So a Prisma write
// that violates a constraint reports a CLIENT mistake as a SERVER error, logged
// at log.error('Unhandled error') rather than log.warn.
//
// #564 recorded that class four separate times and published four different
// counts (8, 12, 15, 18), every one of them wrong, because the rule lived in
// prose and each application of it by hand missed a different half. This file is
// that rule as code, so the number is re-derived instead of quoted.
//
// THE RULE HAS TWO ARMS, and every earlier tally described only the first:
//
//   Arm A  create / upsert        model owns an FK or a @unique   P2003 / P2002
//   Arm B  update / delete by id  NO precondition — any model     P2025
//
// Arm B is why `PUT /announcements/{id}` 500s on `News`, a model with neither a
// foreign key nor a unique constraint: a missing row makes update and delete
// throw regardless of what the model carries. A rule keyed on constraints alone
// classifies those as safe. They are not.
//
// The `*Many` variants are deliberately NOT candidates: updateMany and
// deleteMany no-op on zero rows rather than throwing, and createMany's
// constraint behaviour is the caller's to handle in bulk.
//
// WHAT COUNTS AS GUARDED, and why a prior read does not:
//
// A guard is a catch that translates the Prisma error code. A `findUnique` +
// 404 before the write reads as safe but leaves a TOCTOU window — if the row
// goes away between the read and the write, the write throws and 500s anyway.
// That is the failure #564's original report actually observed (two concurrent
// bookmark POSTs racing a @@unique), so a read alone cannot clear a site.
//
// A site is therefore cleared by exactly one of:
//   - a catch translating P2002 / P2003 / P2025 (detected structurally), or
//   - a baseline entry recording that every constrained id is internally or
//     session-derived, and so cannot dangle.

/** Which arm of the rule a site falls under, or null when it needs no guard. */
export type Arm = 'A' | 'B';

/** One Prisma mutation call site found in the source tree. */
export interface MutationSite {
  /**
   * Stable identity, keyed on the SEMANTIC OWNER rather than the line:
   *   routes    `POST /bookmarks/artists/{artistId}::bookmarkArtist.create`
   *   modules   `src/modules/forum.ts::updateTopic::forumTopic.update`
   * with a `#n` ordinal only where one owner genuinely repeats a model+op.
   *
   * Keying on `file::model.op` alone would collapse 116 of 545 sites into 54
   * entries, so clearing one would silently clear up to nine others — the exact
   * over-suppression the ratchet exists to prevent. Keying on `file:line`
   * churns on every edit above the site, which trains reviewers to regenerate
   * the baseline without reading it.
   */
  key: string;
  area: 'routes' | 'modules' | 'lib';
  model: string;
  op: string;
  /** null when the site needs no guard: an unconstrained create, or a *Many. */
  arm: Arm | null;
  /** True when the call sits inside a catch that translates a Prisma code. */
  guarded: boolean;
}

export interface Baseline {
  /** Keys accepted as safe, each mapped to WHY. Never a bare list: an entry
   *  nobody had to justify is a mute button, not a ratchet. */
  internallyDerived: Record<string, string>;
  /** Keys nobody has read yet. Burns down to empty, as #517's did. */
  unreviewed: string[];
}

export interface GuardCoverageInput {
  sites: MutationSite[];
  baseline: Baseline;
  /** Areas the gate FAILS on. Others are counted and reported only. */
  gated: ReadonlyArray<'routes' | 'modules' | 'lib'>;
}

export interface GuardCoverageResult {
  /** Unguarded, in a gated area, and in neither baseline list — the failing set. */
  newlyUnguarded: string[];
  /** Baselined but now guarded, or no longer present — stale entries. */
  staleBaseline: string[];
  /** Every candidate that is not guarded, baselined or not (for reporting). */
  allUnguarded: string[];
  totals: {
    sites: number;
    candidates: number;
    guarded: number;
    internallyDerived: number;
    unreviewed: number;
    /** Candidates outside the gated areas — measured, not enforced. */
    countedOnly: number;
  };
  ok: boolean;
}

const isCandidate = (s: MutationSite): boolean => s.arm !== null;

/**
 * Compare the mutation sites in the tree against the baseline.
 *
 * The baseline is a RATCHET, not a mute button. Three rules make it
 * un-rottable, matching openapiCompleteness's:
 *
 *   1. An unguarded candidate in a gated area, absent from the baseline, FAILS.
 *      Every route written from the day this lands is gated, without waiting
 *      for the backlog to burn down.
 *   2. A baseline entry that is now guarded FAILS as stale, so the list shrinks
 *      as the backlog burns down and cannot silently over-suppress.
 *   3. A baseline entry matching no site FAILS the same way, so deleting or
 *      renaming a handler prunes its entry rather than leaving a stale grant.
 *
 * `gated` is separate from the site list on purpose. src/modules/ is counted
 * but not enforced: a module takes its ids as function arguments, so telling a
 * request-supplied id from an internally-read one needs inter-procedural
 * analysis this does not attempt. Reporting that remainder as a number is
 * honest; gating it on a rule that cannot discriminate would not be.
 */
export const checkPrismaGuardCoverage = ({
  sites,
  baseline,
  gated
}: GuardCoverageInput): GuardCoverageResult => {
  const candidates = sites.filter(isCandidate);
  const byKey = new Map(candidates.map((s) => [s.key, s]));
  const derivedKeys = Object.keys(baseline.internallyDerived);
  const baselined = new Set([...derivedKeys, ...baseline.unreviewed]);

  const unguarded = candidates.filter((s) => !s.guarded);
  const isGated = (s: MutationSite) => gated.includes(s.area);

  const newlyUnguarded = unguarded
    .filter((s) => isGated(s) && !baselined.has(s.key))
    .map((s) => s.key)
    .sort();

  // Rules 2 and 3 in one pass: an entry is stale when its site is gone, or when
  // the site is now guarded and so no longer needs the grant.
  const staleBaseline = [...baselined]
    .filter((k) => {
      const site = byKey.get(k);
      return site === undefined || site.guarded;
    })
    .sort();

  return {
    newlyUnguarded,
    staleBaseline,
    allUnguarded: unguarded.map((s) => s.key).sort(),
    totals: {
      sites: sites.length,
      candidates: candidates.length,
      guarded: candidates.filter((s) => s.guarded).length,
      internallyDerived: derivedKeys.length,
      unreviewed: baseline.unreviewed.length,
      countedOnly: candidates.filter((s) => !isGated(s)).length
    },
    ok: newlyUnguarded.length === 0 && staleBaseline.length === 0
  };
};
