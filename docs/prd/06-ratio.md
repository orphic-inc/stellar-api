# PRD-06 — Ratio

**Status:** Draft · **Owner:** @obrien-k
**Decisions:** [ADR-0006 LinkHealth-gated ratio relief](../adr/0006-linkhealth-gated-ratio-relief.md)
**Feeds:** [PRD-01 Community-Score / CRS](01-Community-Score.md) — a derived `RatioScore` is one CRS/CVI dimension; the ratio *mechanism* itself is independent of CRS.

> Lean PRD. Captures the ratio mechanism as it should be, maps each piece to existing code, and flags the overhaul. Ratio is an **enforcement** mechanism (download gate); CRS is a **reputation** signal. They are layered one-way: a `RatioScore` flows into CRS; CRS never gates downloads and ratio never reads CRS.

## Problem

Stellar's required-ratio model follows the classic private-tracker ratio model (see the [ratio writeup](https://kyleobrien.me/%E9%BB%92%E6%98%A5%E5%85%89%E7%90%B3%E6%B5%B7)) but is incomplete. That model's required ratio depends on three pillars — **downloaded amount**, **how many things you're seeding**, and **how long they've stayed available over the trailing window** (effectively seeded if available ≥ 72h in the past 7 days). The formula was `maximum required ratio × (1 − X)`.

`src/modules/ratio.ts` captures the download brackets and the `maxRequired × (1 − coverage)` shape, but models the relief `X` as a **static, permanent byte-credit** (`eligibleContributionBytes / consumed`). Once a contribution is staff-approved it lowers required ratio forever — even if its link died. The *seeding / ongoing-availability* pillar is missing.

## The seeding analog: LinkHealth

Stellar has no peer-to-peer transfers — contributions are hosted links. `downloads.ts` credits a contributor's `contributed` bytes each time someone downloads from their link. So **a live link is an actively-seeded release**, and **LinkHealth is the seeding analog**:

| Reference model | Stellar |
| --- | --- |
| Seeding a release | A contribution whose link is reachable (`linkStatus = PASS`) |
| Effectively seeded (available ≥72h/7d) | Current `linkStatus ≠ FAIL` (24h recheck keeps it fresh) |
| Stopped seeding → lose relief | Link `FAIL` → contribution drops from the relief pool |
| Uploaded bytes (others snatched) | `User.contributed` (others downloaded from you) — permanent, never clawed back |

## Mechanism

### Required ratio (unchanged shape, gated relief)

- **Download brackets** (`ratio.ts` `BRACKETS`): 10 consumption tiers (5 GiB steps). `0–5 GiB → 0.0` (no requirement) … `100+ GiB → 0.6` (floor = ceiling). *Bracket values are tuning; current table assumed settled, flagged for review.*
- **Formula:** `requiredRatio = max(minRequired, maxRequired × (1 − coverage))`.
- **Coverage (the overhaul):** `coverage = eligibleContributionBytes / consumed`, where `eligibleContributionBytes` sums a user's staff-approved, 72h-old contribution bytes **whose current `linkStatus ≠ FAIL`**. See [ADR-0006](../adr/0006-linkhealth-gated-ratio-relief.md):
  - `FAIL` revokes relief (required ratio can rise as links rot).
  - `WARN`/`UNKNOWN` keep counting — reports alone cannot tank a rival's ratio.
  - A contribution stuck `WARN` and unresolved 72h is swept to `FAIL`, then drops.
  - No clawback of lifetime `contributed`.

### Policy state machine (unchanged)

`ratioPolicy.ts`: `OK → WATCH → LEECH_DISABLED`. `WATCH` lasts 14 days; auto-disable on 10 GiB consumed during watch or watch expiry; `LEECH_DISABLED` reversed by staff only.

### Concepts from the reference model not yet modelled (flagged)

- **Seeding *count*** (the reference factors how many releases you seed, not just bytes) — out of scope for v1; byte-coverage is the lever.
- **Freeleech / neutral-leech** (download without ratio impact) — a tracker feature; separate concern, not in this overhaul.

## Concept → existing code (the descent map)

| Concept | Lives in |
| --- | --- |
| Ratio + required-ratio + brackets | `src/modules/ratio.ts` |
| Policy state machine | `src/modules/ratioPolicy.ts` |
| `contributed` credit (seeding-snatch analog) | `src/modules/downloads.ts` |
| LinkHealth status + 24h recheck + 72h sweep | `src/modules/linkHealth.ts`, `src/modules/linkHealthJob.ts` |
| Ratio surface | `GET /api/profile/me/ratio` (`routes/api/profile.ts`), `routes/api/ratioPolicy.ts` |
| Lifetime uptime (CRS, not ratio) | deferred — `LinkHealthBonusPoints` dimension, PRD-01 |

## Red-green descent targets

1. ✅ **Relief LinkHealth gate** — `eligibleContributionBytes` filtered by `linkStatus ≠ FAIL`; required ratio rises when a covered contribution flips `FAIL`, `WARN`/`UNKNOWN` still count. **Shipped [#96](https://github.com/orphic-inc/stellar-api/pull/96).**
2. 🟡 **72h WARN→FAIL sweep** — `linkStatusChangedAt` + `sweepStaleWarnLinks` in `linkHealthJob.ts`. **Promotion shipped [#96](https://github.com/orphic-inc/stellar-api/pull/96)**; the contributor-PM + staff-report notification on promotion is still TODO.
3. ✅ **`RatioScore` dimension** — bounded CRS sub-score from current ratio health, one-way into PRD-01's registry. **Shipped [#96](https://github.com/orphic-inc/stellar-api/pull/96).**

## Open questions

- Bracket values — keep the current table or re-tune to specific numeric thresholds? (assumed settled for now)
- Whether the policy `WATCH` thresholds (14d / 10 GiB) change in the overhaul (assumed unchanged).
