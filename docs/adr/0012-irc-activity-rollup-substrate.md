# IRC activity rollup as the CRS durable substrate (messages-only, computed-on-read)

**Status: Superseded by [ADR-0013](0013-korin-pink-irc-integration.md) (2026-06-14).** The durable `IrcActivity` rollup was removed; IRC metrics now live in the external korin.pink service and are polled into a read-time cache. The computed-on-read principle is preserved at the new boundary. Original status: Accepted (2026-06-13). **Extends** [ADR-0007 — CRS read-time value + event accrual ledger](0007-crs-read-time-and-event-ledger.md). Serves [PRD-01 Community-Score / CRS](../prd/01-Community-Score.md) (the `IRCScore` dimension) and [PRD-02 IRC + Announce](../prd/02-irc-and-announce.md) (draft).

## Context

`IRCScore` is a planned CRS **Dimension Scorer** over a member's IRC participation. [ADR-0007](0007-crs-read-time-and-event-ledger.md) settled the computed-on-read-vs-event-logged question with one test: **can the signal be reconstructed from current state?**

- Reconstructable (Longevity ← `createdAt`, Ratio ← current ratio) → pure read-time, no durable surface.
- Not reconstructable (stylesheet adoption — "current sheet" loses the set of past adoptions) → an append-only `CRS_*` row on the `EconomyTransaction` ledger.

IRC activity fails the reconstruction test in the same way the stylesheet edge does: once a day passes, _who said what in which channel_ is gone unless it was recorded. So by ADR-0007's own logic it **earns a durable surface**. But it differs from the stylesheet edge in volume and shape: it is **high-volume and continuous**, and it is not dedup-/double-entry-shaped — pushing every message onto the economic `CRS_*` ledger would pollute a double-entry economic ledger with non-economic chatter and distort its row semantics.

ADR-0007 anticipated exactly this as its rule 3 ("time-series … an _additive_ layer"), but left the concrete shape for the first dimension that needed it. IRCScore is that dimension.

## Decision

The durable surface for IRC activity is a **purpose-built, pre-aggregated rollup** — not the `CRS_*` ledger and not a denormalized score.

1. **`IrcActivity` rollup.** One row per **member × channel × day** of **message counts**, upserted by the IRC bot. Bounded row count (members × channels × days-in-window), fit-for-purpose shape — distinct from both the economic ledger and a raw message log.
2. **Messages only — presence never feeds the score.** Idle-in-channel is the most farmable IRC signal (park a bouncer, "be present" 24/7, contribute nothing). Presence may be tracked elsewhere for _"who's online"_ UX/ops, but it is **never recorded into the scoring path** and never contributes to `IRCScore`.
3. **Still computed on read.** `IRCScore` remains a pure `Dimension Scorer`: the assembler (`reputation.ts` `getReputation`) fetches a trailing window (**90 days**) of rollup rows into the `DimensionInput`, and the pure scorer computes from them. There is **no stored `ircScore` column** — ADR-0007 rule 1 (no denormalized, drift-prone score) holds unchanged.
4. **Anti-farming is structural in the formula**, not a bolt-on: a per-channel/day cap on counted messages (flooding doesn't scale), `consistency = distinctActiveDays / windowDays` (one marathon session scores near-zero; regular presence is the only lever), and a per-channel weight map (`channelQuality`). Channel weights live in the scorer as **tuning constants** (like the existing caps/τ), table-driven and unit-tested against fixture rows. Magnitudes (`CAP`, `TAU`, `DAILY_CAP`, `MIN_MSGS`, weights) are hand-pinned later (HITL), like every other CRS magnitude.
5. **Old rows aggregate into monthly summaries** (the deferred trend layer, [#94](https://github.com/orphic-inc/stellar-api/issues/94)); they are a read-model for trends, **never** the source of truth for the live score.

## Consequences

- **Extends, does not contradict, ADR-0007.** The rule generalizes cleanly: _reconstructable_ → pure read-time; _irreducible + low-volume/dedup-shaped_ → the `CRS_*` ledger; _irreducible + high-volume/continuous_ → a pre-aggregated rollup. The score is computed-on-read in all three.
- A new table the IRC bot writes to; the bot's only persistence responsibility. Reads come from this API's own state, never from IRCd internals (pairs with [ADR-0011](0011-delegated-irc-authentication.md)).
- The scorer stays **pure and table-driven** — the red-green seam: build and unit-test `scoreIrcActivity(rows, weights, window)` against fixtures before any IRC infra exists.
- **Presence-free scoring is deliberate and surprising** — a future reader will ask "why doesn't idle count?" The answer is recorded here: idle is trivially farmed, so it earns UX visibility but not reputation.
