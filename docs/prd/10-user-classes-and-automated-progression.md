# PRD-10 — User Classes & Automated Progression

**Status:** Draft · **Owner:** @obrien-k
**Decisions:** [ADR-0028 — user-classes ladder and automated rank progression](../adr/0028-user-classes-ladder-and-automated-progression.md)
**Relates:** [PRD-06 Ratio](06-ratio.md) (the enforcement-vs-reputation firewall this PRD's classes-vs-CRS boundary mirrors), [PRD-01 Community-Score / CRS](01-Community-Score.md) (the advisory signal classes never gate on or feed)
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · PRD-05 Rules & Governance · PRD-06 Ratio · PRD-07 Donations · PRD-08 Collages & Cover Art · PRD-09 Golden-Rules Surfacing · **PRD-10 User Classes & Automated Progression**

> Records the automated user-class progression system shipped by epic #167–#171 — the `RankPromotionRule` schema, the seeded ladder, the background sweep, the admin criteria editor, and `rankLocked` — as a governing product doc. Every product call in this PRD was already settled and shipped; this document exists because the system previously had none, having been designed in a local plan file that was never checked into the repository.

## Why

`UserRank` has always been Stellar's level-gated privilege ladder — permissions, forum access thresholds, collage limits — but every rank change used to be a manual staff action. Epic #167–#171 automated it: users now advance and retreat through a defined ladder based on their contribution activity, without staff intervention, while staff retain an override (`rankLocked`) and full control over the ladder's thresholds (the admin criteria editor). This PRD is the durable record of what that system does and does not do, written against the shipped seed and sweep job rather than the epic's own issue text, which drifted from the final implementation in at least one place (see "Notifications, not private messages" below).

## The ladder

Seven ranks are auto-managed; two sit above the ladder as staff-assigned only:

| Level | Name          | Auto-managed | Notes                                                                    |
| ----- | ------------- | ------------ | ------------------------------------------------------------------------ |
| 100   | User          | yes          | Base rank on registration.                                               |
| 150   | Member        | yes          | First earned rung — advanced search unlocked.                            |
| 200   | Power User    | yes          | Elevated collage management.                                             |
| 300   | Elite         | yes          | Elevated user search; top of the capability-granting range.              |
| 350   | Stellarific   | yes          | Prestige tier — identity only, no new permissions over Elite.            |
| 400   | Stellartastic | yes          | Prestige tier — gated by the `DISTINCT_RELEASES_500` predicate.          |
| 450   | Stellarige    | yes          | Prestige tier — gated by the `QUALITY_CONTRIB_500` predicate.            |
| 500   | Staff         | no           | Staff-assigned only; never auto-reached, never auto-demoted into/out of. |
| 1000  | SysOp         | no           | Staff-assigned only; also the system actor attributed on auto changes.   |

The prestige tiers (350/400/450) exist to give long-tenured contributors a growing sense of identity — color, badge, a larger personal collage limit — once there is no more member-level capability left to grant below Staff. This is a deliberate product call, not an oversight: capability stops at Elite, and everything above it is status.

## Promotion criteria

A rung is a `RankPromotionRule` row: a byte floor (`minContributed`), a ratio floor (`minRatio`), a contribution-count floor (`minContributions`), an account-age floor (`minAccountAgeDays`), and an optional `extra` predicate. All of a rung's criteria must be met simultaneously to promote, and a user advances at most one rung per sweep pass regardless of how far past every threshold they sit.

**Byte counting reuses the ratio-relief pool.** `minContributed` is checked against the same link-health-eligible byte pool ratio relief reads (ADR-0006) — staff-approved, 72-hours-old, currently-reachable (`linkStatus ≠ FAIL`) contribution bytes — not a user's raw lifetime `contributed`. A promotion is therefore earned from links that are actually live right now, not from uploads that may have since gone dark.

**The prestige predicates are extra gates, not replacements.** `DISTINCT_RELEASES_500` (500+ distinct releases contributed to) gates Stellarific→Stellartastic; `QUALITY_CONTRIB_500` (500+ non-scene contributions that are lossless, or carry both a log and a cue) gates Stellartastic→Stellarige. Both are layered on top of the same stock numeric thresholds every other rung uses, not a substitute for them.

## Demotion

Demotion is symmetric with promotion on the "stock" criteria only — byte floor, contribution-count floor, and the extra predicate — but deliberately excludes the ratio and account-age floors. A user is never demoted for ratio drift, and never demoted simply because time passed. One consequence is the zero-consumption stall: a user who has never consumed anything computes a ratio of exactly 1.0 (never lower), which is below every rung's 1.05 ratio floor, so they can contribute an unlimited amount and still never clear Member — not a punishment, just a floor they cannot cross without consuming at least once. Demotion is checked before promotion on every pass: a user must still qualify for their current rank before the engine considers advancing them further.

## Guards

Two independent flags stop a user from being touched in either direction: `rankLocked` — an explicit staff freeze with its own admin toggle, kept deliberately separate from the general rank-editing endpoint because that endpoint replaces a user's entire secondary-rank set and would otherwise strip a Donor/VIP secondary on every automated change — and an active (non-expired) `UserWarning`, which freezes progression until it lapses or is cleared. Staff (500) and SysOp (1000) are excluded from the auto-managed cohort entirely: they are never auto-reached by promotion, and a user assigned to either rank is never auto-demoted out of it.

## The classes-vs-CRS boundary

Classes are the level-gated **privilege** system: they determine what a user can do. CRS (Community Reputation Score) is a read-time **reputation** signal and stays strictly advisory. This is the same one-way layering already settled for Ratio in PRD-06 — a derived score can feed into CRS, but CRS never gates the mechanism that produced it — applied here to progression: no CRS dimension is a promotion or demotion criterion, and no rank change feeds back into a CRS dimension. A future proposal to cross that boundary in either direction is a decision for its own ADR, not a quiet schema addition.

## Notifications, not private messages

The epic's tracking issue described the user-facing side of a rank change as a "System PM." The shipped sweep job does not send a private message — it creates a `Notification` row (`rank_promoted` / `rank_demoted`, routed through the global notices subscription page). This document records the system's actual, shipped behavior; the private-message framing in the epic's issue text is superseded.

## Operator surface

Staff retune the ladder's numeric thresholds without a deploy through the admin promotion-criteria editor (`GET/POST/PUT /api/tools/promotion-rules`), which refuses to let a new or edited rule skip past, or overlap with, an existing rung. Staff freeze an individual user's progression with `PUT /api/users/:id/rank-lock`, and read the freeze state alongside a user's current rank via `GET /api/users/:id/rank`. The sweep itself runs unattended on an hourly cadence by default, scanning active users in ascending-id batches and applying at most one step per user per pass.

## Concept → code

| Concept                                    | Lives in                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Ladder + rule schema                       | `prisma/schema.prisma` (`UserRank`, `RankPromotionRule`, `User.rankLocked`)               |
| Seeded ladder + rules                      | `src/modules/bootstrap.ts` (`seedRanks`, `seedRankPromotionRules`)                        |
| Pure evaluator (promotion/demotion policy) | `src/modules/rankProgression.ts` (`evaluateRankChange`, `DEFAULT_RANKS`, `DEFAULT_RULES`) |
| DB-bound sweep                             | `src/modules/rankProgressionJob.ts` (`runRankProgressionSweep`, `applyRankChange`)        |
| Admin criteria editor                      | `src/routes/api/tools.ts` (`/promotion-rules` CRUD)                                       |
| `rankLocked` read/write                    | `src/routes/api/user.ts` (`GET/PUT /:id/rank`, `PUT /:id/rank-lock`)                      |

## Open questions

- Issue #171's member-facing "progress to next class" widget was closed without a corresponding endpoint shipping in this repository — there is currently no member-facing gap-to-next-rank surface. Left as a future issue rather than retrofitted into this PRD.
- Whether `DISTINCT_RELEASES_500` and `QUALITY_CONTRIB_500`'s 500-item bars need per-rung tuning once real usage data exists is an open operational question for staff running the admin editor, not a design gap.
