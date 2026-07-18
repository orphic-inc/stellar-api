# ADR-0029: Integrity-monitoring & abuse-detection contract (korin.pink `ledger` ↔ stellar-api)

**Status:** Proposed — **blocked: no substrate.** The korin `ledger` this contract reads over is being withdrawn (see ADR-0016, Superseded); `GET /ledger/integrity` therefore has nothing to attach to. The signal taxonomy and action model below stand on their own and are worth keeping, but any implementation must **first specify and justify its own substrate** rather than inherit one. Do not build against the endpoint shape in this document until that is done.
**Date:** 2026-07-15
**Repos:** orphic-inc/stellar-api (decides & acts), obrien-k/korin-pink (`ledger` — detects)
**Extends:** [ADR-0013 — korin.pink IRC integration](0013-korin-pink-irc-integration.md) (boundary + key model) · [ADR-0016 — consumption accounting & ratio-gate contract](0016-ledger-accounting-contract.md) (the hot consumption state this reads over)
**Serves:** [PRD-06 Ratio](../prd/06-ratio.md) · [PRD-01 Community-Score / CRS](../prd/01-Community-Score.md) · [ADR-0025 moderation & messaging surfaces](0025-moderation-and-messaging-surface-model.md)
**Counterpart:** obrien-k/korin-pink — the `ledger` sidecar's deferred "abuse/integrity signals" work (its ADR-004 lists it as out-of-scope-until-a-follow-on-ADR; this is that ADR's stellar half).

---

## Context

Consumption is server-authoritative (ADR-0016): stellar issues every grant, so there is no client self-report and no cheat surface in the accounting itself. That closes the classic ratio-inflation hole but leaves the abuse patterns that live _around_ the numbers rather than _in_ them, and that stellar's read-time model cannot cheaply see:

- **Ratio / grant abuse** — grant patterns that are individually legal but collectively gaming the ratio or pass economy (e.g. burst consumption timed against a policy-state boundary).
- **Sybil / multi-account** — accounts correlated by shared session/IP, invite lineage, or a shared verified IRC identity, acting in concert.
- **Impossible-consumption** — consumption velocity or volume beyond physical plausibility for one human (grant rate, concurrent-session geography).
- **Announce / feed scraping** — automated harvesting of the announce firehose or feeds beyond human cadence.

With consumption-event ingest landed (#261), korin's `ledger` now holds the hot consumption stream, and via ADR-0013 it also holds the IRC vantage (presence, mentions, nick↔account map). That combination — high-churn hot counters plus a cross-account social signal — is exactly the vantage stellar's durable, per-request Postgres model is the wrong place to compute. ADR-0016 §Consequences enabled this but deferred the signal shape to "a follow-on ADR." This is that ADR.

It defines **what signals korin returns and how stellar acts on them** — deliberately _not_ a new enforcement mechanism. The reference lineage historically fired such events as one-way notices into staff channels; here the _taxonomy_ is preserved but delivery rides the existing ledger contract into stellar's own moderation and reputation surfaces.

---

## Decision

**Detection is korin's; adjudication and action are stellar's.** korin's `ledger` computes advisory integrity **signals** over its hot window; stellar drains them and routes them into human-reviewable or bounded-automatic surfaces it already owns. korin never mutates stellar state and never gates consumption on a signal.

### Ownership split

- **korin.pink `ledger` — detector.** Computes signals from the hot consumption stream + IRC vantage it already holds. Holds only derived, recoverable state (bounded-loss, ADR-0013). It emits _evidence_, never a verdict, and has no authority over stellar.
- **stellar-api — adjudicator + actor.** The system of record. Owns the accounts, the moderation/report surfaces (ADR-0025), and the CRS. It decides what a signal _means_ and what, if anything, happens — always via an existing bounded mechanism, never a new automated block.

### Signal shape

Each signal is `{ kind, subjects: userId[], severity: "info"|"warn"|"high", evidence: object, window: {start, end}, detectedAt }`, where `kind` is one of the taxonomy above and `evidence` is the detector-specific supporting data (correlated account ids, rate figures, geography deltas). Signals are idempotent on `(kind, subjects, window)` so re-draining never double-reports.

### Wire shape — stellar pulls, cursor-based (reuses ADR-0013 keys)

| Flow                  | Direction               | Endpoint                                              | Auth                         | Notes                                                                                                                                                                                                         |
| --------------------- | ----------------------- | ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integrity signals** | stellar **pulls** korin | `GET {KORIN_API_URL}/ledger/integrity?since=<cursor>` | `x-pull-key: KORIN_PULL_KEY` | Returns new signals since the cursor. A drain job advances the cursor on success, matching the `/irc/metrics` and announce posture. korin unreachable ⇒ no new signals (degrade, never break). No new secret. |

Pull (not push) is chosen to match every other stellar→korin read and to keep the fail-mode a _degradation_: if korin is down, stellar simply has no fresh signals — nothing blocks and nothing errors. There is no inbound abuse surface on stellar to attack.

### Action model on stellar — evidence, never an automated gate

A signal is **input**, and stellar routes it to exactly one or more of these existing, bounded outcomes:

1. **Staff-review substrate** — a signal materializes as a flag/report in the moderation queue (ADR-0025), where a human staffer adjudicates and takes any account action. This is the default for `warn`/`high`.
2. **Bounded CRS input** — a signal may feed a _negative/suspicion_ CRS dimension, capped and floored like the existing `inviteContagion` drag (ADR-0004): a bounded reputational headwind, never a cliff, and never itself a gate.
3. **Informational stats** — `info`-severity signals may surface only as staff-facing counters.

**Hard constraints (non-negotiable):**

- **Never an automated gate on consumption.** A detector must never disable a download or an account. Consumption stays a session-authed, ratio-accounted grant (Golden Rule 3); disabling is always a human staff action or, at most, an existing bounded CRS drag.
- **Never a content-access path.** This contract carries signals only; it authorizes nothing (consistent with ADR-0015's permanent design-out of key-authed IRC content access).
- **korin holds no authority over stellar state.** It returns evidence; stellar owns every mutation, and every action taken is audited.
- **Fail-degraded.** A korin outage yields no signals, never a blocked user and never an error to the consumer.

---

## Rationale

- **Puts detection where the hot state and the cross-account vantage already are** (korin), and adjudication where the authority and the human surfaces already are (stellar) — no new authority, no split-brain.
- **Reuses one boundary.** Same keys, same fail-closed/degrade rules as ADR-0013/0016; the only new surface is one cursor-drained read.
- **Safe by construction.** Because the action model tops out at "flag for a human" or "bounded CRS drag," a false positive can never auto-punish — the worst case is a staffer dismissing a flag or a small, capped reputational dip.
- **Additive.** If korin is never deployed, stellar loses only the signals; all existing accounting and moderation continue unchanged.

---

## Consequences

- **Implementation issues fall out of this ADR** (filed separately, gated on acceptance): (a) the `/ledger/integrity` **drain job + cursor** and the signal-ingest module on stellar; (b) **staff-queue wiring** — materializing a signal as a Report/flag in the ADR-0025 surfaces; (c) an optional **suspicion CRS dimension** (bounded/floored like `inviteContagion`); (d) the paired **korin `ledger` detector** work (the sidecar half).
- korin's `ledger` gains detector logic over state it already holds; stellar gains one pull-drain and the routing into surfaces it already owns.
- The taxonomy is intentionally open at the edges — new `kind`s are added on both sides without a contract change, since the wire shape carries `kind` + opaque `evidence`.

---

## Cross-references

- **stellar-api:** ADR-0013 (boundary) · ADR-0016 (hot consumption state, §Consequences deferral this fulfils) · ADR-0025 (moderation surfaces the signals land in) · ADR-0004 / PRD-01 (bounded negative CRS dimension precedent) · ADR-0015 (no key-authed content access).
- **korin.pink:** the `ledger` service (ADR-004) and its deferred abuse-signal work — the detector half of this contract.
