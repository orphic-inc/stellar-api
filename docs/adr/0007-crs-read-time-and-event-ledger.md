# CRS computation: read-time value + event accrual ledger

**Status: Accepted.** Resolves the open question in [ADR-0002 community-health-pulse → CRS](0002-community-health-pulse.md) ("computed-on-read vs. event-logged accrual"). Serves [PRD-01 Community-Score / CRS](../prd/01-Community-Score.md); referenced by [PRD-03 stylesheet scoring](../prd/03-stylesheet-themes-and-scoring.md).

## Context

CRS aggregates many dimensions (Friends, Invite, Donation, Longevity now; RatioScore, stylesheet, LinkHealth-lifetime, IRC, Feed later). ADR-0002 and PRD-03 both flagged the same undecided question: is a user's score **computed on read** from current state, or **accrued from logged events**? The two break differently per dimension:

- **Reconstructable from current state:** Longevity (`User.createdAt`), Friends (current relationship rows), Donation (donation history), RatioScore (current ratio health). A read-time recompute is always correct and never goes stale.
- **Not reconstructable from current state:** event signals where "what is true now" loses history. The clearest case is the Friends×Stylesheet controlled vector ([PRD-03](../prd/03-stylesheet-themes-and-scoring.md)): "A currently uses sheet X" does not tell you the *set of distinct adoptions A has ever made*. A pure recompute would silently lose credit (A adopted then switched) or double-count it.

## Decision

A **hybrid**: read-time value, with a thin durable ledger only for events that current state cannot reconstruct.

1. **The CRS value is always computed on read.** There is no denormalized `crsScore` column that can drift. The aggregator (`reputation.ts`) sums the registered dimension scorers on demand, the same way `ratio.ts` computes ratio.
2. **Non-reconstructable event signals are append-only logged.** Reuse the existing immutable-ledger pattern of `EconomyTransaction` (double-entry, reason-tagged, staff-auditable) with a new `CRS_*` reason family. The stylesheet-adoption edge is the first such event: it records the `(adopter, author)` pair so the once-per-pair dedup and per-user cap of the controlled vector are durable. Read-time computation reads this ledger for the affected dimensions.
3. **Time-series snapshots are deferred.** Trends over time (CRS history, the lifetime-uptime `LinkHealthBonusPoints` dimension) are an *additive* layer that mirrors `statsHistory.ts` — they are **not** the source of truth and do not change rule 1. Tracked as a follow-up issue; this is the "future direction" ADR-0002 anticipated.

## Consequences

- **No staleness, no recompute job** for the score itself; correctness is structural.
- A small, well-understood durable surface (the `CRS_*` ledger) carries only what genuinely needs history — keeping most dimensions pure functions in the spirit of `stylesheetScore.ts`.
- Snapshots, when built, become a read-model for trends and never the authority — so a snapshot bug can never corrupt a user's actual score.
- Resolves ADR-0002's and PRD-03's open "computed-on-read vs event-logged" question for all CRS dimensions uniformly: **read-time by default, ledger only for irreducible events.**
