# PRD-06 — Ratio

**Status:** Draft · **Owner:** @obrien-k
**Decisions:** [ADR-0006 LinkHealth-gated ratio relief](../adr/0006-linkhealth-gated-ratio-relief.md)
**Hot-path accounting:** korin.pink [ADR-004 Go Accounting Service (`ledger`)](https://github.com/obrien-k/korin-pink/blob/main/docs/adr/004-go-accounting-service.md) (Proposed) — the `canConsume` gate + real-time consumption accounting that enforces this at runtime.
**Feeds:** [PRD-01 Community-Score / CRS](01-Community-Score.md) — a derived `RatioScore` is one CRS/CVI dimension; the ratio _mechanism_ itself is independent of CRS.
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · PRD-05 Rules & Governance · **PRD-06 Ratio** · PRD-07 Donations · PRD-08 Collages & Cover Art

> Lean PRD. Captures the ratio mechanism as it should be, maps each piece to existing code, and flags the overhaul. Ratio is an **enforcement** mechanism (consumption gate); CRS is a **reputation** signal. They are layered one-way: a `RatioScore` flows into CRS; CRS never gates consumption and ratio never reads CRS.

## Problem

Stellar's required-ratio model follows the classic ratio model (see the [ratio writeup](https://kyleobrien.me/%E9%BB%92%E6%98%A5%E5%85%89%E7%90%B3%E6%B5%B7)) but is incomplete. That model's required ratio depends on three pillars — **amount consumed**, **how many contributions you keep available**, and **how long they've stayed available over the trailing window** (counted while available ≥ 72h in the past 7 days). The formula was `maximum required ratio × (1 − X)`.

`src/modules/ratio.ts` captures the consumption brackets and the `maxRequired × (1 − coverage)` shape, but models the relief `X` as a **static, permanent byte-credit** (`eligibleContributionBytes / consumed`). Once a contribution is staff-approved it lowers required ratio forever — even if its link died. The _ongoing-availability_ pillar is missing.

## The availability substrate: LinkHealth

Contributions are hosted links. `downloads.ts` credits a contributor's `contributed` bytes each time someone consumes from their link. So **a live link is a continuously-available contribution**, and **LinkHealth is the availability substrate** the relief term reads:

| Availability concept              | Stellar mechanic                                                               |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Keeping a contribution available  | A contribution whose link is reachable (`linkStatus = PASS`)                   |
| Sustained availability (≥72h/7d)  | Current `linkStatus ≠ FAIL` (24h recheck keeps it fresh)                       |
| Availability lapses → lose relief | Link `FAIL` → contribution drops from the relief pool                          |
| Bytes others consumed from you    | `User.contributed` (others downloaded from you) — permanent, never clawed back |

## Mechanism

### Required ratio (unchanged shape, gated relief)

- **Consumption brackets** (`ratio.ts` `BRACKETS`): 10 consumption tiers (5 GiB steps). `0–5 GiB → 0.0` (no requirement) … `100+ GiB → 0.6` (floor = ceiling). _Bracket values are tuning; current table assumed settled, flagged for review._
- **Formula:** `requiredRatio = max(minRequired, maxRequired × (1 − coverage))`.
- **Coverage (the overhaul):** `coverage = eligibleContributionBytes / consumed`, where `eligibleContributionBytes` sums a user's staff-approved, 72h-old contribution bytes **whose current `linkStatus ≠ FAIL`**. See [ADR-0006](../adr/0006-linkhealth-gated-ratio-relief.md):
  - `FAIL` revokes relief (required ratio can rise as links rot).
  - `WARN`/`UNKNOWN` keep counting — reports alone cannot tank a rival's ratio.
  - A contribution stuck `WARN` and unresolved 72h is swept to `FAIL`, then drops.
  - No clawback of lifetime `contributed`.

### Policy state machine (unchanged)

`ratioPolicy.ts`: `OK → WATCH → LEECH_DISABLED`. `WATCH` lasts 14 days; auto-disable on 10 GiB consumed during watch or watch expiry; the disabled state is reversed by staff only.

### Ratio-exempt contributions: Freepass & Neutralpass

Two Contribution-level flags change how a consumption touches ratio — the only points where the consumption-accounting path (`downloads.ts` today; korin.pink `ledger` per ADR-004) conditionally skips accrual:

| Flag            | Consumer's `consumed` | Contributor's `contributed` | Use                                                                                                                       |
| --------------- | --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Freepass**    | not accrued           | **still accrued**           | Promote selected / staff-featured Contributions; members consume freely while contributors still earn availability credit |
| **Neutralpass** | not accrued           | not accrued                 | Fully ratio-invisible on both sides — items that should sit outside the ratio economy entirely                            |

Freepass is the lever for letting members rebuild ratio (consume without penalty) while still rewarding the contributor's sustained availability; Neutralpass removes an item from the ratio economy in both directions. The flag lives on the Contribution (king) and is read at consumption time — the accounting path checks it before incrementing `consumed` (both flags) and `contributed` (Neutralpass only).

### Concepts from the reference model not yet modelled (flagged)

- **Availability count** (the reference factors how many contributions you keep available, not just bytes) — out of scope for v1; byte-coverage is the lever.

## Concept → existing code (the descent map)

| Concept                                     | Lives in                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Ratio + required-ratio + brackets           | `src/modules/ratio.ts`                                                             |
| Policy state machine                        | `src/modules/ratioPolicy.ts`                                                       |
| `contributed` credit (availability analog)  | `src/modules/downloads.ts`                                                         |
| Freepass / Neutralpass accrual skip         | `src/modules/downloads.ts` (flag on `Contribution`)                                |
| LinkHealth status + 24h recheck + 72h sweep | `src/modules/linkHealth.ts`, `src/modules/linkHealthJob.ts`                        |
| Ratio surface                               | `GET /api/profile/me/ratio` (`routes/api/profile.ts`), `routes/api/ratioPolicy.ts` |
| Lifetime uptime (CRS, not ratio)            | deferred — `LinkHealthBonusPoints` dimension, PRD-01                               |

## Red-green descent targets

1. ✅ **Relief LinkHealth gate** — `eligibleContributionBytes` filtered by `linkStatus ≠ FAIL`; required ratio rises when a covered contribution flips `FAIL`, `WARN`/`UNKNOWN` still count. **Shipped [#96](https://github.com/orphic-inc/stellar-api/pull/96).**
2. 🟡 **72h WARN→FAIL sweep** — `linkStatusChangedAt` + `sweepStaleWarnLinks` in `linkHealthJob.ts`. **Promotion shipped [#96](https://github.com/orphic-inc/stellar-api/pull/96)**; the contributor-PM + staff-report notification on promotion is still TODO.
3. ✅ **`RatioScore` dimension** — bounded CRS sub-score from current ratio health, one-way into PRD-01's registry. **Shipped [#96](https://github.com/orphic-inc/stellar-api/pull/96).**
4. 🔲 **Freepass / Neutralpass** — boolean flags on `Contribution`; the consumption-accounting path skips `consumed` accrual for both and `contributed` accrual for Neutralpass. Not yet started.

## Open questions

- Bracket values — keep the current table or re-tune to specific numeric thresholds? (assumed settled for now)
- Whether the policy `WATCH` thresholds (14d / 10 GiB) change in the overhaul (assumed unchanged).
- Freepass / Neutralpass granularity — a per-Contribution flag only, or also time-boxed / site-wide promotional events?
