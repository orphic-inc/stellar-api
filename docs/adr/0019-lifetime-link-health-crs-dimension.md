# Lifetime link-health CRS dimension

**Status: Accepted.** Serves [PRD-01 Community-Score / CRS](../prd/01-Community-Score.md). Builds the link-health history series deferred by [ADR-0006](0006-linkhealth-gated-ratio-relief.md) (decision #4) and slots into the registry under [ADR-0007](0007-crs-read-time-and-event-ledger.md). Resolves [#95](https://github.com/orphic-inc/stellar-api/issues/95).

## Context

PRD-01 rewards reliability: "users who consistently contribute over time should be rewarded." For contributions — which are hosted links — reliability means _keeping the link alive_. ADR-0006 made current link health a ratio-relief lever (a contribution's bytes count toward relief only while `linkStatus ≠ FAIL`), but decision #4 deliberately read **only the current `linkStatus`** and explicitly did _not_ build a history series: "Cumulative-uptime-over-account-lifetime is a separate, slower CRS dimension (`LinkHealthBonusPoints`) tracked elsewhere." This ADR is that elsewhere. It is the **positive lifetime-reliability reward** — the mirror of the dead-link/flapping/upheld-report penalties that already live in PRD-01/PRD-03 negative scoring and the LinkHealth lifecycle.

#95 hoped to share a single history substrate with #94 (CRS time-series snapshots). That coordination turned out moot: #94 snapshots the _computed CRS output_ over time (`CrsSnapshot`), not per-contribution link health. So this dimension stands up its own uptime substrate. The pleasant consequence is symmetric anyway — once both land, this dimension's _trend_ is captured by #94 for free, because `CrsSnapshot` stores the full per-dimension breakdown and this dimension self-registers (no snapshot code touched).

A naming note: the issue title `LinkHealthBonusPoints` refers to a **post-v1 reward/teeth layer** (the "making CRS bite — privilege-granting" future direction in PRD-01) that will eventually _consume_ this signal. v1 ships only the underlying CRS **dimension**, named `linkHealth`. Bonus Points are out of scope here.

## Decision

Add a self-registered, bounded, pure CRS dimension `linkHealth` measuring a member's **cumulative lifetime confirmed link uptime**, backed by a per-contribution accumulator on the `Contribution` spine.

1. **Scope: cumulative uptime only.** v1 rewards sustained confirmed availability and nothing else. The other signals #95 floated — contribution frequency, fail-resolved-before-reported, report-upheld suspicion — are deferred (see below); the last two are _negative/suspicion_ signals that belong in negative scoring, not this positive dimension (folding them here would re-open ADR-0006's anti-weaponization stance).

2. **Metric: reliability-first, with a bounded volume×duration term.** Per the member, over all their contributions:

   - `R` (reliability) = mean of `clamp(passMs_i / (now − createdAt_i), 0, 1)` — _"are your links rotting?"_, volume-agnostic, in [0,1]. A dead or never-confirmed link drags `R` down; a rotted catalogue lowers lifetime reliability, which is the point.
   - `H` (banked healthy-link-time) = `Σ passMs_i` in healthy-link-years — _"how much confirmed uptime have you actually accumulated?"_, capturing both volume and duration in one term.
   - `subScore = CAP × R × (1 − exp(−H / H_TAU))`. Both factors are in [0,1], so the product is bounded by `CAP` by construction (the PRD's "no single axis dominates" guardrail, structural not aspirational). `R` leads as a true multiplier — if links rot, banked `H` cannot save the score; and a fresh account that dumps many links has `R ≈ 1` but `H ≈ 0`, so it cannot farm the dimension instantly. Only _sustained_ uptime banks `H`.

3. **PASS-only accrual.** Only a confirmed-reachable `PASS` accrues healthy time. `UNKNOWN` (never probed — absence of evidence) and `WARN` (suspect) do not accrue, and `FAIL` obviously does not. This is deliberately _stricter_ than ADR-0006's relief rule (which counts everything but `FAIL`): an enforcement gate is lenient to avoid false revocation, but a positive reward must credit only confirmed health so it cannot be inflated by parking links in an unconfirmed state. WARN windows are short (corrected to PASS on recheck, or swept to FAIL in 72h), so lost credit during a genuine transient blip is negligible.

4. **Substrate: an accumulator on the `Contribution` spine.** Two columns beside the existing link-health fields: `healthyMs BigInt @default(0)` (banked confirmed-PASS milliseconds, excluding the currently-open segment) and `healthySince DateTime?` (when the current open PASS segment began; `null` when not currently PASS). Live uptime at read = `healthyMs + (healthySince ? now − healthySince : 0)`. This is the _time_ analog of `User.contributed`/`consumed` — mutable `BigInt` running accumulators already kept on the spine and read by a scorer (RatioScore). ADR-0007 forbids a denormalized _score_ column that can drift; `healthyMs` is a substrate fact (an input), not a score, so it sits with the other link-health spine fields rather than on a satellite — which also keeps it off a join on the hot reputation read path (#195).

5. **Accrual is a pure function of `(new status, current healthySince)`.** A single helper in `linkHealth.ts`:

   - if `isPass && healthySince == null` → open: `healthySince = now` (covers entering PASS _and_ self-healing a backfilled PASS that never opened);
   - else if `!isPass && healthySince != null` → bank & close: `healthyMs += now − healthySince; healthySince = null`.
     `healthySince` itself is the accrual-state flag, so the prior status is irrelevant and the block is idempotent/self-healing. It is reused unchanged at both status writers — `checkContributionLink` and the `recordContributionReport` auto-WARN write. The WARN→FAIL `sweepStaleWarnLinks` is a no-op for accrual (WARN never accrued).

6. **Read-time, single widened fetch.** The dimension self-registers in `reputation.ts`; the aggregator is untouched (PRD-01 registry). `getReputation` widens its existing per-user contribution fetch (previously community-only, for CommunityScore) to _all_ the user's contributions plus the uptime fields, then derives both CommunityScore's per-community weight and this dimension's `R`/`H` from one scan — no second pass over the table. The scorer stays pure: the assembler computes `R`/`H` (including the live open segment) and passes `linkHealthReliability`/`linkHealthYears` into `DimensionInput`.

7. **Cold-start migration, no fabricated history.** New rows default `healthyMs = 0`; the migration seeds `healthySince = now` for rows currently at `linkStatus = PASS` so live links start ticking at launch rather than drifting up to a week before the next probe opens their segment. No `healthyMs` is back-filled — nobody is credited uptime nobody confirmed. The dimension reads near-zero at launch and earns its weight as genuine uptime accrues, which is correct for a _lifetime_ signal. (Prod is pre-alpha; data is disposable, so this is the principled choice even under a reset.)

8. **Tier-0 constants:** `CAP = 8` (tied with RatioScore — both derive from the same contribution-availability substrate, at the current vs. lifetime timescale — and second only to Longevity's 10, honoring the PRD owner's "among the highest-weight signals" note without crowning a new dimension the single biggest), `weight = 1.0` (no second lever), `H_TAU = 3` healthy-link-years (mirrors `LONGEVITY_TAU_YEARS`). Tune alongside the PRD like every other dimension constant.

9. **Visibility.** `linkHealth` is **not** snatch-derived — it is computed purely from the member's own contributions' link status, leaking nothing about what they consumed — so it stays visible in the #193 paranoia-gated profile block alongside longevity/friends/invite. It is a vague reliability signal, not informative activity.

## Consequences

- The history series ADR-0006 deferred now exists — for CRS (lifetime uptime), not for ratio (which still reads current `linkStatus` only). The two systems read one availability substrate at two timescales, as ADR-0006 anticipated.
- A new schema migration adds two `Contribution` columns; the accrual hook is a small, contained addition to the two existing status writers in `linkHealth.ts`.
- The reputation read gains a CPU-side `R`/`H` reduction but no new query (it rides the widened contribution fetch). The #195 read-path memoization follow-up now covers this reduction too.
- A member who lets their catalogue rot sees this dimension decay (lower `R`); one who maintains links for years saturates it. A reformed contributor recovers as new healthy contributions lift `R` and `H` grows — the dimension is purely positive (floor 0), so rot bounds the _gain_, never pushing negative.

## Deferred / out of scope for v1

- **Contribution-frequency signal** — a positive enhancement (reward steady contribution cadence, not just uptime). Tracked as [#212](https://github.com/orphic-inc/stellar-api/issues/212); overlaps the eventual ContributionScore/CommunityScore weight, so it needs its own grill-before-schema design pass.
- **Fail-resolved-before-reported** and **report-upheld / "highly reported user is always suspect"** — these are _negative/suspicion_ signals. They belong in PRD-01/PRD-03 negative scoring and the LinkHealth lifecycle, not in this positive dimension; keeping them out preserves ADR-0006's anti-weaponization stance (reports cannot be turned into a CRS weapon).
- **`LinkHealthBonusPoints` (the teeth).** The post-v1 reward/privilege layer that consumes this dimension — part of PRD-01's "making CRS bite" future direction. Captured here and in PRD-01; no issue opened yet, as it is far out.
- **Typed snapshot columns / per-(user) weight memoization** — covered by the existing #195 read-path follow-up.
