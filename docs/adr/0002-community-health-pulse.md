# Community-health pulse → CommunityScore

**Status: Proposed — future direction.** Serves [PRD-01 Community-Score / CRS](../prd/01-Community-Score.md); tracked by [#75](https://github.com/orphic-inc/stellar-api/issues/75).

Stellar computes a community-health signal on read (`getCommunityHealthPulse`). The decision recorded here is how that pulse becomes a durable input to the CommunityReputationScore (CRS).

Decision to record (not yet finalized):

- **Persistence:** snapshot the pulse over time (mirror `statsHistory`) for trend analysis vs. recompute-on-read only.
- **Folding into CRS:** how the pulse feeds the `CommunityScore` dimension of `CommunityReputationScore`, and ultimately a `CommunityValueIndex`.

This is the ADR the stylesheet-scoring work ([PRD-03](../prd/03-stylesheet-themes-and-scoring.md)) and other CRS dimensions reference for "computed-on-read vs. event-logged" accrual.

**Resolved by [ADR-0007 — CRS computation: read-time value + event accrual ledger](0007-crs-read-time-and-event-ledger.md):** the score is computed-on-read; only events that current state cannot reconstruct are append-only logged (a `CRS_*` reason on `EconomyTransaction`); time-series snapshots (the pulse-over-time trend this ADR anticipated) are a deferred additive layer mirroring `statsHistory`, never the source of truth. The pulse stays computed-on-read and folds into the `CommunityScore` dimension under that model.
