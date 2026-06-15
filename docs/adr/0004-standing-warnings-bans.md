# Standing → CRS, and the Warning/Ban model

**Status: Accepted.** Serves [PRD-05 Rules & Governance](../prd/05-rules-and-governance.md); the CRS backbone in [PRD-01](../prd/01-Community-Score.md). Computation shape follows [ADR-0007](0007-crs-read-time-and-event-ledger.md). Resolves decision [#131](https://github.com/orphic-inc/stellar-api/issues/131).

## Context

Rule compliance must move a user's Community Reputation Score (CRS): a pristine record rewards ×10 (the strongest positive), and long-term poor standing — frequent warnings, ban evasion — draws a large compounding penalty, "the mighty hammer." The only datum today is `User.warnedTimes` alongside the `UserWarning` rows and `User.banDate`; there is no escalation-ladder entity, and no invite-tree linkage feeding standing.

Two questions were open: the **shape of standing** (its tiers and how it is computed), and **how invite-tree health feeds it**. This ADR settles the structure; magnitudes and the fuller entity model are deferred (below).

## Decision

### 1. Standing is a five-rung ladder, computed on read

`Standing = pristine | clean | neutral | poor | hammer`, derived by a pure function (`computeStanding`, `src/modules/standing.ts`) over a user's **active** `UserWarning` rows, ban state, and account tenure. There is no denormalized `standing` column. This follows [ADR-0007](0007-crs-read-time-and-event-ledger.md): standing is reconstructable from current state, so it is **computed on read**, never accrued.

| Rung       | Meaning                                                                               |
| ---------- | ------------------------------------------------------------------------------------- |
| `hammer`   | Banned, **or** confirmed self ban-evasion, **or** frequent active warnings. Terminal. |
| `poor`     | Repeated active warnings.                                                             |
| `neutral`  | A single active warning — the ×1, no-amplification baseline.                          |
| `clean`    | Zero active warnings, short tenure.                                                   |
| `pristine` | Zero active warnings, long clean tenure — the ×10 reward.                             |

Tenure distinguishes only the top two rungs (`clean` vs `pristine`); a single warning drops a user to `neutral` regardless of tenure. The rung set and ordering are **settled and canonical** — `Standing` is owned by `standing.ts`, and `ruleImpact()` consumes that same tier. The numeric **thresholds** (active-warning counts, the pristine tenure window) are **deferred magnitudes**: placeholders flagged in code, tuned alongside the CRS magnitudes in PRD-05.

### 2. Standing scales rule impact; it does not gate

`ruleImpact(outcome, weights, standing)` (`src/modules/ruleImpact.ts`) maps a rule/sub-rule's raw CRS weight through standing: good standing amplifies compliance rewards (pristine strongest), bad standing amplifies violation penalties (hammer strongest) — the downside mirror of tiering. A sub-rule's weight composes additively on its parent's. Enforcement remains [ADR-0001](0001-granular-permission-checks.md) (granular permissions); standing only moves CRS, it never gates access. Standing-trend input comes from [ADR-0002](0002-community-health-pulse.md) (the pulse).

### 3. Confirmed evasion is terminal; invite-tree contagion is graded and separate

The terminal-rung `banEvasion` input means **confirmed self ban-evasion** — binary, the worst standing. The broader signal — an inviter (trunk) that is infected makes their invitees (branches) _suspect_ — is **contagion**, and is deliberately **not** wired to the terminal tier. A clean user must not be auto-condemned because a distant inviter was banned long after the invite; **suspect is not condemned**. Contagion is therefore a _graded_ suspicion — a review flag plus a mild, distance-decaying CRS drag — owned by the InviteTree model ([#61](https://github.com/orphic-inc/stellar-api/issues/61)), not a Standing rung. This ADR names #61 as the source of the confirmed-evasion linkage and scopes contagion-suspicion out of the terminal tier.

## Deferred (tracked, not part of this decision)

- **Magnitudes** — the ×10 reward, the hammer curve, warning thresholds, and per-rule/SubRule micro-impact weights (PRD-05 open questions).
- **The fuller Warning/Ban entity model** — suspension/ban entities and an explicit escalation ladder beyond `UserWarning` + `User.banDate`.
- **Invite-tree contagion** (the graded suspicion above) and the **positive Invite CRS dimension** (a productive sub-tree reflecting well on the inviter) — both owned by [#61](https://github.com/orphic-inc/stellar-api/issues/61); the latter registers as a future `reputation.ts` dimension.

## Consequences

- The settled structure ships now (#128, #129); the constants change in lockstep with the spec, never silently.
- `Standing` is defined once in `standing.ts`; `ruleImpact()`'s structurally-identical copy folds into an import from it once both slices are in `main`.
- No staleness and no recompute job for standing — correctness is structural (ADR-0007).
- `computeStanding`'s `banEvasion` seam is correct as-is: a binary, terminal, _confirmed-evasion_ input. The unfed contagion signal is new scope under #61, not a gap in this decision.
