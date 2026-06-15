# ADR-0005: korin.pink IRC Integration Architecture

**Status:** Accepted
**Date:** 2026-06-14
**Repos:** orphic-inc/stellar-api, obrien-k/korin-pink
**PRD:** [PRD-01 Community-Score](../prd/01-Community-Score.md) — IRCScore dimension (v0.1.x)

---

## Context

PRD-01 defines IRC participation as a CRS dimension: `IRCScore = activity × consistency × channelQuality`. The infrastructure decision is how stellar-api acquires per-user IRC signals from korin.pink's irc-bridge, and how those signals integrate into the read-time CRS aggregator (ADR-0007).

Two integration patterns were evaluated:

| Pattern | Description | Tradeoff |
|---|---|---|
| **Pull (polling)** | stellar-api polls `GET /irc/metrics` every N minutes | Simple; tolerates korin downtime; stale by up to one interval |
| **Push (webhook)** | korin forwards each flush to stellar-api `POST /webhooks/irc-metrics` | More real-time; requires stellar to be reachable from korin; needs retry logic for failed deliveries |

---

## Decision

**Pull (polling).** stellar-api polls korin's `GET /irc/metrics` on a configurable interval (default 5 min via `KORIN_POLL_INTERVAL_MS`). The last payload is held in-process via `TtlCache` with a TTL of 2× the poll interval so a single missed poll doesn't evict valid data mid-read.

Webhooks are not ruled out for future versions. At v0.1.x scale (single-server private site, flush windows of 60s), the polling gap is immaterial and the simpler path wins.

---

## Rationale

- **Polling tolerates korin downtime gracefully.** A missed poll leaves the cached window stale rather than losing data. A failed webhook delivery loses the window unless retry logic is added — complexity not warranted at this scale.
- **No inbound surface on stellar-api from korin.** korin lives on a separate VPS/GCP instance. Polling means stellar controls the connection; webhooks would require stellar's API to be reachable from korin's network, adding a deployment coupling.
- **Consistent with ADR-0007 (CRS computed on read).** The IRCScore scorer is a pure function of the cached `IrcUserMetrics` — no score column, no recompute job, same pattern as longevity/ratio/friends.
- **Auth is symmetric:** `GET /irc/metrics` is gated by `x-pull-key: KORIN_PULL_KEY` on korin's side (only stellar-api calls it). `POST /irc/metrics` is gated by `x-bridge-secret: IRC_BRIDGE_SECRET` (only the irc-bridge calls it).

---

## IRCScore formula

```
IRCScore = activity × consistency × channelQuality   (scaled to IRC_CAP = 6)

activity       = log1p(messageCount)   / log1p(ACTIVITY_REF=50)   → [0, 1]
consistency    = presenceSeconds / windowDurationSeconds           → [0, 1]
channelQuality = log1p(channelCount)   / log1p(CHANNEL_REF=5)     → [0, 1]
```

Log-scaling on message count and channel count prevents volume abuse. The product of three `[0, 1]` factors gives natural bounding before the reputation registry cap. Absence of an IRC nick earns 0 — IRC presence is optional, absence is not penalised.

---

## Nick → account mapping

Users link their Ergo nick to their Stellar account via `PUT /api/users/:id/irc-nick`. The nick is stored as `User.ircNick` (unique, nullable). Ownership is user-managed — Stellar does not validate SASL credentials; it trusts the user's self-reported nick. For v0.1.x this is acceptable; v0.2.x may add verification via a SASL challenge through the irc-bridge.

---

## Consequences

- `KORIN_API_URL` and `KORIN_PULL_KEY` must be set in stellar-api's environment for IRC scoring to activate. If unset, `ircJob` logs a warning and skips — the scorer returns 0 gracefully.
- `User.ircNick` is a unique index. Conflicting nick claims return HTTP 409.
- The `TtlCache` is per-process. Multi-instance stellar-api deployments will each poll independently. Acceptable at v0.1.x; a shared cache layer (Redis) is the upgrade path.
- korin-pink's flush window (`FLUSH_INTERVAL_MS`, default 60s) determines signal granularity. stellar-api's poll interval (`KORIN_POLL_INTERVAL_MS`, default 5min) determines freshness. The IRCScore reflects the most recent completed flush window at time of CRS read.
