# CommunityScore: a signed, contribution-gated CRS dimension folding community link-health

**Status: Accepted.** Builds on [ADR-0002 community-health-pulse → CRS](0002-community-health-pulse.md) and [ADR-0007 CRS read-time + event ledger](0007-crs-read-time-and-event-ledger.md); serves [PRD-01 Community-Score / CRS](../prd/01-Community-Score.md). Implements the deferred CommunityScore fold (#75); unblocks quality-grade weighting (#76).

## Context

PRD-01 names a `CommunityScore` dimension that rewards members for communities that stay "active, healthy, and self-sustaining." The substrate already exists: `linkHealth.ts` computes a community's link-health pulse on read (`getCommunityHealthPulse`, ADR-0002 — `pass/checked`, banded Healthy ≥0.90 / Ailing ≥0.60 / Critical, Unknown below 0.5 coverage), and PR #161 persists it as a `CommunityHealthSnapshot` time-series. What was undecided — and why this was grilled before any schema — is the _shape of the term_: a member has ONE global CRS, so N communities' health must collapse into ONE bounded term, and that collapse hides real fairness/farming/cardinality teeth. The outcome needs **no new schema** — it reuses the snapshot substrate behind a read port.

## Decision

A read-time dimension `community`, registered in the `reputation.ts` registry like every other, with these settled properties:

- **Contribution-gated collective.** The signal is a _community-wide_ pulse, but a member earns the term only for communities they have **contributed** to (mere membership earns nothing). This keeps the "community health" framing while closing the lurker-farm: you can't bank reputation for sitting in a healthy community you never built.
- **Signed, softly floored.** A healthy community rewards; a Critical one _penalises_. The penalty is bounded by a shallow negative floor so others' link-rot nudges rather than craters a member's CRS — collective accountability without weaponisation. Enforcement remains the Ratio mechanism's job; this is a status signal (PRD-01 ratio-independence).
- **Continuous pulse, neutral at the Critical edge (0.60 = `PULSE_AILING`).** Each eligible community's pulse maps to a signed value: `pulse ≥ 0.60` scales `0 … +CAP` toward a perfect `1.0`; `pulse < 0.60` scales `0 … −FLOOR` toward `0`. Communities reading **Unknown** (coverage below `PULSE_MIN_COVERAGE` 0.5) are excluded — neither reward nor penalty.
- **Contribution-count-weighted average** across the member's contributed-to communities. Where they have invested most weighs most; one contribution to a huge community barely moves the term. Because it is an average of values already in `[−FLOOR, +CAP]`, the result is inherently bounded.
- **Magnitude (tier-0, provisional):** `CAP = +4`, `FLOOR = −1`, weight `1.0` — sits near invite/donation, can't dominate longevity (10) or ratio (8). Weight metric is **contribution count** for v1, swappable to link-health-eligible bytes (ADR-0006) later.

This required one structural change: dimension scorers gain an optional `floor` (default 0), and the aggregator clamps to `[floor, cap]` instead of `[0, cap]`. CommunityScore is the first _signed_ dimension; the change also unblocks the deferred PRD-03 negative IRC-mutual-mention vector (#122). The dimension is not snatch-derived, so it is unaffected by the #193 paranoia `ratio`-drop and flows into both `/api/profile/me/reputation` and the profile `community` block.

## Substrate — a pluggable read port (the one deferred axis)

The scorer is **substrate-agnostic**: it consumes, per community, `{ pulse, coverage, contributionCount }`. What feeds it is a port — `communityHealthFor(communityIds)` (`communityHealthHistory.ts`) — whose **v1 reads the latest Daily `CommunityHealthSnapshot` per community** (O(1) each, ≤1-day stale, captured by the stats job like the top10 snapshots). Per ADR-0007 the snapshot is a derived trend layer, not the source of truth; we accept that for a bounded tier-0 signal in exchange for a cheap read path (`getReputation` now runs on every profile view, #193).

**Open question (tracked separately):** the eventual read model. This likely converges on a top10-style snapshot mechanism and/or the korin.pink ledger ([ADR-0016](0016-ledger-accounting-contract.md)) once that accounting story settles. Because the scorer only sees the port's shape, swapping the source later does not touch `reputation.ts`. A follow-up issue carries this.

## Consequences

- Completes the PRD-01 CommunityScore dimension with no migration.
- Introduces signed CRS dimensions as a first-class concept (the `floor` field).
- Leaves a clean per-community seam for #76 (quality-grade weighting): a lossless/logged/cued release will weight its community's term more, multiplying in at the per-community loop without changing this shape.
- Couples the score's freshness to the daily snapshot cadence (v1) — acceptable, revisited by the substrate follow-up.

## Alternatives rejected

- **Pure collective / ambient** (health of all communities you belong to) — lurker-farmable and punishes good contributors trapped in an ailing community.
- **Individual stewardship** (only your own contributions' health) — stops being a _community_ signal, contradicting ADR-0002's community-wide pulse.
- **Positive-only** — considered, but rejected in favour of signed-with-soft-floor for genuine stewardship pressure.
- **Trend-averaged over the snapshot series** — rejected; the term reads instantaneous (latest) health, not a multi-period average. Snapshots remain a display/trend layer.
- **Pure live recompute per community on every read** — correct but N group-bys on the hot profile path; the latest-snapshot port gives near-live health cheaply.

## Update (#76) — quality-weighting

The contribution-count weight is replaced by a **quality weight**: per community, the member's weight is the **sum of their per-contribution quality grades** there — `Σ ( gradeContribution(c).score ?? 0.3 )` over their contributions in that community. `gradeContribution` (`contributionQuality.ts`, already shipped) grades each rip from `{ type, bitrate, hasLog, hasCue }` to a score in `[0,1]` (Perfect 1.0 … LowLossy 0.3); ungradeable contributions (no bitrate / no `ReleaseFile`) fall back to `0.3` so legacy/unprobed data still counts without erasing a community. The signed pulse value is unchanged; the combination is **symmetric** — a member's quality stake amplifies both the reward of a healthy community and the penalty of a Critical one (more answerable for what you invested quality in), still bounded `[−1, +4]`. So ten lossless/logged/cued rips swing a community's term ~3× harder than ten ungradeable transcodes. The grade stays as-is; adding `isScene`/`media`/Edition to the grader is a separate refinement of `contributionQuality.ts`, not this change.

**Read-path cost:** grading is TS logic (single-sourced in `gradeContribution`), so the assembler now fetches the member's contributions (with the `ReleaseFile` join) on every `getReputation` rather than a cheap `COUNT(*)`. A SQL `CASE` mirror was rejected (grade-logic drift). Memoising the per-(member, community) quality weight is folded into the substrate follow-up (#195), alongside the community-pulse read model.
