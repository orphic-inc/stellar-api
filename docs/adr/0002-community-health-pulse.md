# Compute community health as a read-time link pulse; defer persistence and scoring

`01-Community-Score.md` favours communities that stay "active, healthy, and
self-sustaining." LinkHealth already gives that health a per-contribution
signal: submitting through the contribution form sets `Contribution.linkStatus`
(`UNKNOWN | PASS | WARN | FAIL`), and a job re-checks stale links. Nothing rolled
those up to the community level.

We aggregate **on read** rather than storing a score. `getCommunityHealthPulse`
(`src/modules/linkHealth.ts`) groups a community's contributions by `linkStatus`
(via `release.communityId`) and returns a pulse = `pass / checked`, where
`checked = pass + warn + fail` (UNKNOWN is excluded — not yet probed). The ratio
is banded `Healthy ≥ 0.90`, `Ailing ≥ 0.60`, `Critical` otherwise, `Unknown`
when nothing is checked. It is served at `GET /api/communities/:id/health`.

No schema change and no stored state: the pulse is cheap to compute and always
reflects current link reality, so there is nothing to invalidate. The existing
`Release → Contribution` shape feeds it as-is, so this does not wait on the Music
model remodel (#72–#74). Persisting/snapshotting the pulse and folding it into
the PRD's `CommunityScore` is deliberately deferred (#75), as is weighting it by
upload quality — a lossless/logged/cued release should count for more than a
transcode (#76).
