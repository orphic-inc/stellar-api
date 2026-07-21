# Compute community health as a read-time link pulse; defer persistence and scoring

**Status:** Accepted (2026-06-10). Both deferrals in the title have since been closed additively, without displacing the read-time pulse as the source of truth: persistence landed in v0.5.5 (PR #161, `communityHealthHistory.ts` — see the update note below), and the `CommunityScore` CRS fold (#75) landed in [ADR-0017](0017-communityscore-crs-dimension.md). The computed-on-read question this ADR left open was settled by [ADR-0007](0007-crs-read-time-and-event-ledger.md). Quality-weighting (#76) remains deferred.

`01-Community-Score.md` favours communities that stay "active, healthy, and
self-sustaining." LinkHealth already gives that health a per-contribution
signal: submitting through the contribution form sets `Contribution.linkStatus`
(`UNKNOWN | PASS | WARN | FAIL`), and a job re-checks stale links. Nothing rolled
those up to the community level.

We aggregate **on read** rather than storing a score. `getCommunityHealthPulse`
(`src/modules/linkHealth.ts`) groups a community's contributions by `linkStatus`
(via `release.communityId`). Only `PASS` and `FAIL` are definitive (`checked`);
`WARN` (transient 5xx / report-flagged) and `UNKNOWN` (unprobed) are
indeterminate and excluded — so a transient-only community reads `Unknown`, not
`Critical`. The pulse = `pass / checked`, banded `Healthy ≥ 0.90`,
`Ailing ≥ 0.60`, `Critical` otherwise. It withholds a confident band and reports
`Unknown` until coverage (`checked / total`) clears a floor (`0.5`), so one
probed link among thousands of unprobed ones doesn't read `Healthy`. Served at
`GET /api/communities/:id/health`.

No schema change and no stored state: the pulse is cheap to compute and always
reflects current link reality, so there is nothing to invalidate. The existing
`Release → Contribution` shape feeds it as-is, so this does not wait on the Music
model remodel (#72–#74). Persisting/snapshotting the pulse and folding it into
the PRD's `CommunityScore` is deliberately deferred (#75), as is weighting it by
upload quality — a lossless/logged/cued release should count for more than a
transcode (#76).

**Resolved by [ADR-0007 — CRS computation: read-time value + event accrual ledger](0007-crs-read-time-and-event-ledger.md):** the computed-on-read-vs-event-logged question this ADR left open is settled — the CRS value is computed-on-read; only events current state cannot reconstruct are append-only logged (a `CRS_*` reason on `EconomyTransaction`); time-series snapshots (the pulse-over-time trend, #75 / #94) are a deferred additive layer mirroring `statsHistory`, never the source of truth.

**Update (2026-06-17, v0.5.5):** the deferred _persist/snapshot_ half has landed (PR #161). The pulse is now captured as a `CommunityHealthSnapshot` time-series (per community × period × bucket) by the stats job — `src/modules/communityHealthHistory.ts`, read at `GET /api/communities/:id/health/history`, with `computePulse` (`linkHealth.ts`) shared between the live pulse and the snapshot so banding is single-sourced. Consistent with the ADR-0007 note above: a derived additive trend layer, not the source of truth. Still deferred: folding the pulse into the `CommunityScore` CRS dimension (#75) and quality-weighting it (#76).
