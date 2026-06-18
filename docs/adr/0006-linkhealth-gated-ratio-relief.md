# LinkHealth-gated ratio relief

**Status: Accepted.** Serves [PRD-06 Ratio](../prd/06-ratio.md) and [PRD-01 Community-Score / CRS](../prd/01-Community-Score.md). Relates to the LinkHealth lifecycle ([`linkHealth.ts`](../../src/modules/linkHealth.ts), [`linkHealthJob.ts`](../../src/modules/linkHealthJob.ts)).

## Context

Stellar's required-ratio model (`src/modules/ratio.ts`) follows the classic ratio model (see the [ratio writeup](https://kyleobrien.me/%E9%BB%92%E6%98%A5%E5%85%89%E7%90%B3%E6%B5%B7)), in which required ratio is `maximum required ratio × (1 − X)` and depends on **amount consumed, how many contributions you keep available, and how long they have stayed available over the trailing window** — a contribution counts while it has been available for at least 72 hours in the past seven days.

Our implementation captures the download brackets and the `maxRequired × (1 − coverage)` shape, but models the relief term `X` as a **static, permanent byte-credit**: `coverage = eligibleContributionBytes / consumed`, where `eligibleContributionBytes` is the sum of a user's staff-approved, 72h-old contribution bytes. Once approved, a contribution lowers the user's required ratio **forever** — even if its download link died years ago. That misses the central pillar: relief comes from _ongoing availability_, not a one-time act of uploading.

Contributions are hosted links, and `downloads.ts` accrues a contributor's `contributed` bytes each time someone consumes from their link. So **a live link is a continuously-available contribution**, and **LinkHealth is the availability substrate**: `linkStatus` already tracks whether a contribution's link is reachable (`PASS`), suspect (`WARN`), unchecked (`UNKNOWN`), or dead (`FAIL`), rechecked every 24h by `linkHealthJob.ts`.

## Decision

Gate ratio relief on current link health. A contribution's approved bytes count toward `eligibleContributionBytes` **only while its latest `linkStatus ≠ FAIL`**.

1. **Revocable relief.** A contribution flipping to `FAIL` drops its bytes out of the relief pool, so a user's required ratio can _rise_ as their links rot — with no new consumption on their part. This mirrors a contribution losing its relief credit once it is no longer available.
2. **Suspicion does not revoke.** `WARN` (including the ≥3-distinct-reporter auto-warn) and `UNKNOWN` keep counting. Only a machine-confirmed dead link (`FAIL`) revokes. Community reports therefore cannot be weaponized to inflate a rival's required ratio — only an actual failed HEAD check can.
3. **Persistent suspicion is promoted.** A contribution stuck at `WARN` and unresolved for **72 hours** is swept to `FAIL` by the link-health job (PM the contributor, file the staff report), which then revokes relief. This closes the "returns 200 but the file is gone" hole without making reports a weapon.
4. **Current status only.** Ratio relief reads the latest `linkStatus`; the 24h recheck keeps it fresh. We do **not** build a link-health history series for ratio. Cumulative-uptime-over-account-lifetime is a separate, slower CRS dimension (`LinkHealthBonusPoints`) tracked elsewhere.
5. **No clawback of `contributed`.** Revocation affects only the _relief pool_ (`eligibleContributionBytes`, which lowers required ratio). A user's lifetime `contributed` — bytes others actually downloaded from them — is historical and is never reduced when a link dies; already-earned upload credit is permanent.

Ratio remains a standalone download gate. It does not read CRS, and CRS does not gate downloads (see [ADR-0007](0007-crs-read-time-and-event-ledger.md)).

## Consequences

- **Faithful to the reference model**, and reuses the existing `linkHealth.ts` / `linkHealthJob.ts` substrate — slice 1 is a `linkStatus ≠ FAIL` filter on the eligible-bytes query plus the 72h sweep; no schema change.
- **User-visible behavior change with teeth:** a user who stops maintaining their links sees their required ratio climb. This is intended (it rewards sustained availability) but must be surfaced clearly in the profile/ratio UI and is the reason this is recorded as an Accepted ADR rather than left implicit.
- The `WARN`-never-revokes rule means a genuinely-dead-but-200 link keeps relief for up to 72h after the first report; acceptable given the anti-weaponization benefit.
- Establishes LinkHealth as the shared availability substrate for both Ratio (current status) and CRS (lifetime uptime), so the two systems read one signal at two timescales.
