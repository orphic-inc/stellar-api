# ADR-0016: Consumption accounting & ratio-gate contract (korin.pink `ledger` ↔ stellar-api)

**Status:** **Superseded (2026-07-18) — the contract is withdrawn and the implementation removed.** Briefly Accepted (2026-07-13) when Phase 2 shipped (#322/#323); driving the announce end-to-end runbook against a live korin stack then showed the ledger to be redundant with stellar's own accounting. See [Supersession](#supersession-2026-07-18) below. The Context section is retained because its analysis is the durable artifact.
**Date:** 2026-06-18
**Repos:** orphic-inc/stellar-api (system of record), obrien-k/korin-pink (`ledger` accounting authority)
**Extends:** [ADR-0013 — korin.pink IRC integration](0013-korin-pink-irc-integration.md) (the bidirectional boundary this builds on)
**Serves:** [PRD-06 Ratio](../prd/06-ratio.md), [ADR-0006 LinkHealth-gated ratio relief](0006-linkhealth-gated-ratio-relief.md)
**Counterpart:** korin.pink [ADR-004 Go Accounting Service (`ledger`)](https://github.com/obrien-k/korin-pink/blob/main/docs/adr/004-go-accounting-service.md) — its Phase-2 dependency is exactly this contract.

---

## Context

ADR-0013 established the stellar-api ↔ korin.pink boundary for **IRC signals**: stellar pulls `GET /irc/metrics`, korin reads CRS / resolves nicks, all over a shared-secret back-channel. korin.pink ADR-004 then proposed the Go `ledger` — a hot-path accounting authority (real-time consumption accounting, a `canConsume` gate, live activity counters) — but explicitly gated its Phase 2 on **stellar-api exposing consumption-event and ratio-gate contracts**. This ADR is that contract.

Today, ratio accounting lives entirely in stellar-api: `downloads.ts` accrues `contributed`/`consumed` at grant time, `ratio.ts` computes required ratio, and `ratioPolicy.ts` evaluates `OK → WATCH → LEECH_DISABLED` **at read time**. There is no real-time gate at grant time, no hot working set, and no live activity stats — and computing those per-request against Postgres is the wrong place for hot, high-churn counters.

**The origin is reversed from the classic ratio model.** In the reference model, clients self-reported transfer to a hot-path daemon, which was therefore the _origin_ of the numbers and had to buffer-flush them back to the durable site. Stellar has no swarm: **stellar issues every consumption grant itself** (`downloads.ts`), so consumption is **server-authoritative** and stellar is already the durable origin of every byte. This collapses two pieces of the reference design:

- There is **no client self-report**, so no cheat surface and no delta-of-cumulative-counter reconciliation.
- There is **no flush-back of accounting** — stellar already persisted the truth when it issued the grant. korin does not own numbers to return.

So `ledger` is not a parallel authority; it is a **derived, real-time read-model** fed by stellar's authoritative grant events, providing three things stellar's read-time model cannot cheaply provide: a **grant-time gate**, **live activity stats**, and a vantage for **integrity/abuse detection**.

---

## Decision

Define the accounting contract as an **extension of ADR-0013's integration contract**, reusing its auth and key model unchanged. Roles:

- **stellar-api** — durable system of record and the **origin** of every consumption event. Owns `Contribution`/`User` state, the ratio formula and brackets (`ratio.ts`, ADR-0006), the policy state machine (`ratioPolicy.ts`), and the Freepass/Neutralpass/bonus-pass resolution (PRD-06). It **resolves the ratio impact of each grant before emitting it** — korin never re-derives pass logic.
- **korin.pink `ledger`** — a **derived hot-path read-model**: an in-memory working set seeded from stellar, advanced by stellar's grant events, answering the `canConsume` gate and live-stats reads, and (later) surfacing abuse signals. Holds only recoverable state; on restart it reloads the snapshot from stellar (bounded-loss model, korin ADR-003 / ADR-0013).

### Flows (extends the ADR-0013 contract table; same keys, same fail-closed rules)

| Flow                     | Direction                | Endpoint                                                         | Auth                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Consumption event**    | stellar **pushes** korin | `POST {KORIN_API_URL}/ledger/consumption`                        | `x-pull-key: KORIN_PULL_KEY`                       | Server-authoritative. Body `{grantId, userId, contributorId, contributionId, consumedDelta, contributedDelta, pass: "none"\|"freepass"\|"neutralpass"\|"bonus", at}`. **stellar pre-resolves the deltas** (Freepass → `consumedDelta=0`, `contributedDelta=bytes`; Neutralpass → both 0; bonus-pass → `consumedDelta=0`); korin only sums into the hot working set. Idempotent on `grantId`. |
| **Ratio gate**           | stellar **pulls** korin  | `GET {KORIN_API_URL}/ledger/can-consume?userId=&contributionId=` | `x-pull-key`                                       | Returns `{allow, reason, currentRatio, requiredRatio, policyState}`. `downloads.ts` calls this before issuing a grant. **Fail-open to stellar's own read-time `ratioPolicy` if korin is unreachable** — a korin outage must never hard-block consumption.                                                                                                                                    |
| **State sync**           | stellar **pushes** korin | `POST {KORIN_API_URL}/ledger/sync`                               | `x-pull-key`                                       | Working-set mutations that aren't grant events: add/remove/update `Contribution` (bytes, `contributorId`, `linkStatus`, pass flag), user policy-state transitions (`OK`/`WATCH`/disabled), `AnnounceKey` rotation, bonus-pass grant/spend. Keeps korin consistent with stellar's authoritative state between snapshots.                                                                      |
| **Working-set snapshot** | korin **pulls** stellar  | `GET /api/ledger/snapshot`                                       | `Bearer STELLAR_SERVICE_KEY` (`requireServiceKey`) | Seed/reload on boot. Returns the durable totals + contribution/user state korin needs to rebuild the hot aggregate; korin then advances it with live consumption events.                                                                                                                                                                                                                     |
| **Live stats**           | stellar **pulls** korin  | `GET {KORIN_API_URL}/ledger/stats`                               | `x-pull-key`                                       | Global + per-user real-time activity (active consumers/contributors, current-window counters) for site/profile surfaces — the degraded-"scrape" analog. Cached like `/irc/metrics`.                                                                                                                                                                                                          |

Auth, key names, and fail-closed semantics are inherited verbatim from ADR-0013 (`KORIN_API_URL`/`KORIN_PULL_KEY` for stellar→korin; `STELLAR_SERVICE_KEY` bearer for korin→stellar; korin mirrors them as `STELLAR_API_URL`/`STELLAR_PULL_KEY`/`STELLAR_API_KEY`).

> **Namespace guard (from ADR-0013 / PRD-02).** The consumption-event ingest above is **not** "announce." korin's `/irc/announce` is the unrelated RSS/IRC _publish_ path. Porting the ledger ingest is not porting announce.

---

## Rationale

- **Server-authoritative ⇒ simpler than the reference model.** No self-report, no per-file balance reconciliation, no buffered flush-back of accounting. The ingest is a stream of pre-resolved deltas stellar already trusts.
- **The gate moves to grant time, fed by hot state** (PRD-06's intent), without per-request Postgres aggregation. korin's working set is the read-model that makes that cheap.
- **Outage tolerance, both ways.** korin down → stellar gates from its own read-time `ratioPolicy` (fail-open) and buffers/retries consumption events; korin recovers by re-pulling the snapshot. This preserves ADR-0013's "korin downtime degrades, never breaks core" property.
- **Pass logic stays in the system of record.** Freepass/Neutralpass/bonus-pass affect the ratio impact; resolving them in stellar (which owns the flags and the bonus economy) keeps korin a dumb summer and avoids split-brain on the economy rules.
- **One boundary, reused.** No new auth model, no new inbound surface on stellar beyond the existing Bearer reads.

---

## Consequences

- korin gains a `Contribution`-aware working set (not just IRC metrics) and three endpoints (`/ledger/consumption`, `/ledger/can-consume`, `/ledger/stats`); stellar gains a `/api/ledger/snapshot` read and emits events + sync mutations from `downloads.ts` / the contribution + ratio-policy paths.
- **Phasing.** korin ADR-004 Phase 1 (port IRC metrics) needs **no** new contract. This ADR is the **Phase 2** dependency; it can land incrementally — gate-only first (read path), then event ingest, then live stats, then abuse signals.
- **Freepass / Neutralpass** (PRD-06 red-green target #4) are realized as the `pass` field on the consumption event + a `Contribution` flag synced via `/ledger/sync`. **Bonus-funded pass** rides the same `pass: "bonus"` value, debited in stellar's (deferred) bonus economy.
- **Integrity / abuse detection** is enabled but **out of scope for this contract** — korin's hot-state + IRC vantage is the home for it; the signal shape (impossible-consumption, sybil/multi-account) is a follow-on ADR.
- If korin is never deployed, stellar's existing read-time accounting continues unchanged — this contract is purely additive.

---

## Supersession (2026-07-18)

Everything above is retained as written. This section records why it was withdrawn.

The contract shipped (#322/#323) and was marked Accepted. Exercising the announce end-to-end runbook (#299) against a live korin stack then surfaced that the ledger does not earn its place:

1. **The gate is redundant.** korin's `can-consume` verdict is `Allow: u.canDownload` and nothing else. `downloads.ts` reads that same flag from Postgres, authoritatively, ~20 lines later in the same request, and throws 403 on it. The remote call can only ever deny the set stellar already denies — from a derived copy that can be stale, cold, or absent, and that fails open on every error path. Stellar's balance gate (`contributed - consumed < cost`) is strictly stronger and korin never implemented it.
2. **The stated rationale is not realized.** "Without per-request Postgres aggregation" (Rationale, above) does not hold: the grant transaction reads the consumer row regardless, for the CAS. No query is saved.
3. **The load premise was imported, not measured.** "Hot, high-churn counters" describes a swarm tracker — every peer re-announcing every ~30 minutes from untrusted clients. Stellar's profile is one event per deliberate human download. The Context section above already establishes why: _"Stellar has no swarm: stellar issues every consumption grant itself."_ That analysis correctly identifies the sidecar's reason for existing as absent here, and the Decision then specifies one anyway.
4. **The justification was circular.** This ADR exists because korin ADR-004 gated Phase 2 on it; ADR-004 exists because _"the capability korin lacks is a hot-path accounting authority."_ Neither states a problem observed in the system of record.

**Removed:** `ledger.ts`, `ledgerJob.ts`, their specs, the integration suite, `GET /api/ledger/snapshot`, the `app.ts` mount and job start, and the `downloads.ts` gate and reversal-event emission. korin's counterpart PR (obrien-k/korin-pink#65) was closed unmerged and its Phase 1 scaffold removed.

**Deliberately untouched:** stellar's own accounting — the `contributed`/`consumed` CAS, `DownloadAccessGrant`, the `economyTransaction` ledger, and the ADR-0006 ratio-relief substrate (`ratio.ts`, `ratioPolicy.ts`, `linkHealth.ts`). None of it imported the korin client. "Ledger" naming the korin client _and_ stellar's local accounting is what made this ambiguous; if the pipe is ever rebuilt, name it for korin explicitly.

**If this is revisited,** the bar is a problem observed in stellar — a measured slow path, real contention, or a question stellar genuinely cannot answer locally — not a capability gap in the sidecar. [ADR-0029](0029-integrity-monitoring-contract.md) (integrity monitoring) is the strongest surviving candidate, since correlating IRC presence with consumption is something neither system can do alone; it is held Proposed-but-blocked and must specify its own substrate.

---

## Cross-references

- **stellar-api:** ADR-0013 (boundary, extended here) · ADR-0006 (ratio relief) · PRD-06 (ratio, Freepass/Neutralpass) · ADR-0029 (integrity monitoring — blocked, see above).
- **korin.pink:** ADR-004 (the `ledger` service this contract unblocked — also superseded) · ADR-003 (bounded-loss hot-state model).
