# ADR-0014: Per-user contribution feed (feed.xml) — derive the feed token, don't mint a new secret

**Status:** Proposed
**Date:** 2026-06-16
**Repos:** orphic-inc/stellar-api, obrien-k/korin-pink
**PRD:** [PRD-02 IRC & Announce](../prd/02-irc-and-announce.md)
**Relates to:** [ADR-0013 — korin.pink IRC Integration](0013-korin-pink-irc-integration.md), [ADR-0015 — Verified IRC nick link](0015-verified-irc-nick-link.md), [ADR-0011 — Delegated IRC authentication](0011-delegated-irc-authentication.md) (superseded), [ADR-0007 — CRS read-time + event ledger](0007-crs-read-time-and-event-ledger.md)

> **Cross-reference — [ADR-0015](0015-verified-irc-nick-link.md).** This ADR and 0015 are siblings of the same discipline: neither mints a new stored per-user secret. The "covert consumption via a per-user token" job here is the legitimate descendant of the retired **AnnounceKey** (one of the four jobs ADR-0015 decomposes) — served by a _derived_ token, not a stored key. If a per-user feed ever needs to gate _private_-community content, it stands on ADR-0015's **Verified IRC Link** (identity), not on a token. For public contribution data, the derived token below stands alone.

---

## Context

A _global_ release-announce flow already exists: `src/modules/announce.ts` renders an RSS payload that
korin pushes to `#announce` (the `POST {KORIN_API_URL}/irc/announce` flow in ADR-0013's contract).
korin also serves a static `packages/web/feed.xml`.

The desired next feature is a **per-user contribution feed**: each Stellar user gets a personal
`feed.xml` enumerating their contributions/releases, consumable by external readers (and by IRC tooling)
to track activity — including "covert" consumption where a bot polls a user's feed via a per-user key
rather than a public URL.

This **reopens a concern two prior ADRs deliberately closed.** ADR-0011 introduced a per-user
`announceKey` (and `ircKey`) credential; ADR-0013's migration **deleted both** to eliminate a second
credential store — the project's most expensive recurring failure mode is _a second source of truth
drifting from the first_ (the `develop ↔ main` divergence behind ADR-0010). A new per-user feed secret,
mirrored into another datastore and rotated independently, would reintroduce exactly that drift.

## Decision (proposed)

Ship the per-user feed, but **do not mint or store a new per-user secret.** Two viable shapes; this ADR
proposes (A):

- **(A) Derived, stateless feed token (recommended).** The feed URL carries a token that is a **pure
  function of existing state** — e.g. `HMAC(server_secret, userId)` (optionally with a version/epoch so
  it can be globally rotated by bumping the server secret). The token lives in **zero** new columns;
  it's recomputed on request and validated by recompute-and-compare. No mirror, no per-user rotation
  fan-out, no drift — consistent with ADR-0011/0013's single-source discipline. Revocation per-user is
  handled by an existing flag (e.g. account disabled) or a small server-side epoch bump, not a stored
  key.
- **(B) Reuse an existing credential.** Gate the feed behind an already-present credential (session, or
  the `STELLAR_SERVICE_KEY` service path for bot consumers). Simpler, but couples public feed access to
  auth surfaces that weren't designed for unattended polling.

**Rejected: a new stored `feedKey`/`announceKey` per user.** That is precisely the mirror ADR-0013
removed; reintroducing it requires overturning that decision, not just extending it.

## Consequences

- **Feed content reads from existing CRS/contribution state** (ADR-0007 pattern: computed on read), so
  the feed is a pure projection — no new durable rollup, mirroring ADR-0013's IRCScore approach.
- The derived token (A) is **bearer-grade**: anyone with the URL can read that user's feed. Acceptable
  for a contributions feed (the data is largely public), but the ADR must state that the feed exposes
  no more than the user's public contribution surface. Anything sensitive stays out of the feed.
- **Rotation story:** global rotation = bump `server_secret`/epoch (invalidates all tokens at once);
  per-user revocation = account-state flag. No per-row key updates.
- korin's role is unchanged from ADR-0013: korin renders/announces; **stellar owns the feed data and
  the token derivation.** If korin (or a bot) consumes per-user feeds, it does so over stellar's public
  feed endpoint with the derived token — no new inbound surface on stellar beyond the feed route.

## Open questions (resolve before build)

1. Token algorithm + whether to include a rotation epoch in the path.
2. Feed route placement (`/api/users/:id/feed.xml?token=…` vs a token-only path that doesn't leak the
   numeric id) and rate-limiting (Golden Rule 5: automated access via the API only).
3. Exact feed schema (RSS vs Atom) and whether it reuses `announce.ts`'s renderer.
4. Whether "covert consumption" implies the feed should be unlisted/non-discoverable (token-only path),
   which argues against putting `:id` in the URL.
