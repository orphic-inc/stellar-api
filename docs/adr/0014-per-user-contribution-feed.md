# ADR-0014: Member Feed — per-member RSS read with a derived token, never a minted secret

**Status:** Accepted (2026-09-17). Proposed 2026-06-16 as a per-user _contribution_ feed; widened on acceptance to the **Member Feed** of [#262](https://github.com/orphic-inc/stellar-api/issues/262), whose grill answered all four open questions below and settled what the proposal left out. See [Acceptance note](#acceptance-note-2026-09-17).
**Date:** 2026-06-16 (proposed), 2026-09-17 (accepted)
**Repos:** orphic-inc/stellar-api, orphic-inc/stellar-ui
**PRD:** [PRD-02 IRC & Announce](../prd/02-irc-and-announce.md) (amended to match)
**Relates to:** [ADR-0013 — korin.pink IRC Integration](0013-korin-pink-irc-integration.md), [ADR-0015 — Verified IRC nick link](0015-verified-irc-nick-link.md), [ADR-0011 — Delegated IRC authentication](0011-delegated-irc-authentication.md) (superseded), [ADR-0007 — CRS read-time + event ledger](0007-crs-read-time-and-event-ledger.md), [ADR-0036 — Release identity is community-private](0036-release-identity-is-community-private.md), [ADR-0001 — Granular permission checks](0001-granular-permission-checks.md)

> **Cross-reference — [ADR-0015](0015-verified-irc-nick-link.md).** This ADR and 0015 are siblings of the same discipline: neither mints a new stored per-user secret. The "covert consumption via a per-user token" job here is the legitimate descendant of the retired **AnnounceKey** (one of the four jobs ADR-0015 decomposes) — served by a _derived_ token, not a stored key.
>
> **Amended 2026-09-17.** The proposal added: "If a per-user feed ever needs to gate _private_-community content, it stands on ADR-0015's Verified IRC Link (identity), not on a token." That does not survive contact with the design. A feed reader is not on IRC, so an IRC identity cannot be presented by it. The token answers only **which member** is reading; **what** that member may read is the same community-access rule every other surface applies (`releaseVisibleTo`, ADR-0036). Private-community content is gated by membership, exactly as on the release pages.

---

## Context

A _global_ release-announce flow already exists: `src/modules/announce.ts` renders an RSS payload that
korin pushes to `#announce` (the `POST {KORIN_API_URL}/irc/announce` flow in ADR-0013's contract).
That is **push** delivery to IRC. Nothing lets a member **pull** the same stream, or a personal slice
of it, into a feed reader.

The legacy implementation this project descends from did ship pull feeds, and they are worth reading
for what they got right and wrong:

- a **derived** token, `md5(userId · server_secret · passkey)`, recomputed on every request — never stored;
- revocation for free, because resetting the passkey changed the token;
- per-member feeds that were the ones actually used: notification filters and bookmarks;
- items whose links were **tokenized download URLs**, carrying the passkey into every feed reader.

This **reopens a concern two prior ADRs deliberately closed.** ADR-0011 introduced a per-user
`announceKey` (and `ircKey`) credential; ADR-0013's migration **deleted both** to eliminate a second
credential store — the project's most expensive recurring failure mode is _a second source of truth
drifting from the first_ (the `develop ↔ main` divergence behind ADR-0010). A new per-user feed secret,
mirrored into another datastore and rotated independently, would reintroduce exactly that drift.

And it meets two rules that did not exist when this was proposed:

- **Every member surface is behind a session** (`AGENTS.md`). A feed reader cannot send a cookie.
- **Delivery is notify-and-link** (#136). An item links into the app; consuming a release stays a
  session-authed, ratio-accounted download.

## Decision

Ship the **Member Feed**: a per-member RSS 2.0 feed, authenticated by a **derived** token in the query
string, whose items only ever link into the app. It is a new domain term, distinct from the pushed
**Release-Announce Feed**, and the one named exception to "every member surface is behind a session".

### 1. The token is derived, and revoked by a counter

```
token = hex(HMAC-SHA256(STELLAR_FEED_SECRET, "feed:" + userId + ":" + feedTokenEpoch)).slice(0, 32)
```

- Recomputed on every request and compared with `crypto.timingSafeEqual`. Nothing secret is stored.
- **Per-member revocation** is `User.feedTokenEpoch Int @default(0)`. A counter is not a secret, so
  derive-don't-mint holds; bumping it makes every URL the member has handed out 404.
- **Site-wide revocation** is rotating `STELLAR_FEED_SECRET`. It is its own secret, not derived from
  `STELLAR_AUTH_JWT_SECRET`, so a feed leak can be answered without logging every member out.
- **The secret is optional.** Unset, every feed route 404s. Operators opt in, as with the other
  optional integrations (ADR-0013).
- The password is deliberately **not** an input. A member who wants a fresh feed URL should not have
  to change their password, and a login credential has no business inside a URL that reaches logs.

### 2. The URL carries the id, and the token in the query

```
GET /api/feeds/<name>.xml?user=<id>&token=<hex>
```

- An HMAC cannot be inverted, so a token-only path would need a stored token→user lookup: the minted
  secret this ADR rejects. The id is in the URL, and ids are not secret; member profiles expose them.
- The token is in the **query**, not the path. The request logger records `req.path`, so the token
  stays out of the api's own logs. nginx's default `combined` log records the full request line, so it
  does reach the proxy log; rotation is the remedy, and Sentry scrubs `token` from request data.
- Secret unset, bad token, unknown user and **disabled** user all answer the **same 404**. A feed URL
  cannot confirm that an id exists.
- Checks run token → `disabled` → per-member rate limit → filter validation, so an unauthenticated
  caller never sees a `400` describing the filter vocabulary.

### 3. The catalog (v1)

| feed                | reads                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `contributions.xml` | newest 50 contributions; optional `?community=&tag=&format=&bitrate=`, one value each, AND-combined, tags alias-resolved |
| `mine.xml`          | the owner's own contributions                                                                                            |
| `news.xml`          | site news                                                                                                                |
| `bookmarks.xml`     | new contributions on bookmarked releases, and on releases crediting a bookmarked artist in **any** role; de-duplicated   |

- Every contribution feed reads through `releaseVisibleTo(owner)`. A feed shows the owner exactly what
  the release pages would show them, and a contribution in a community they have left drops out.
- Filters are query params, not a catalog of named feeds. They cover every legacy category feed and
  more with one route. `BookmarkCommunity` is served by `?community=`, not by `bookmarks.xml`.
- A `community` the owner cannot see yields an empty feed, not an error.

### 4. Items notify and link — they never download

- **Contribution items** use the announce item shape, the same stream delivered two ways: title
  (`Artists — Title [type]`), link to `/releases/:id`, guid `stellar-contribution-<id>`
  (`isPermaLink="false"`), `pubDate`, the community as `category` — plus the uploader as
  `dc:creator`. Every contribution surface already projects the uploader to any viewer who can see the
  release; paranoia settings govern stats, not upload attribution.
- **News items** carry the body rendered through `renderSiteBBCode` with the feed owner as viewer, the
  one sanctioned transcription path (#398), so `[mature]` gating follows the owner's setting. The link
  is `${siteUrl}/#news-<id>`, guid `stellar-news-<id>`.
- **No item carries a download or tokenized URL.** This is the legacy implementation's one real
  mistake, and the reason #136 exists.
- `escapeXml` and a generic channel renderer are extracted from `announce.ts` into the feed module;
  `renderAnnounceRss` keeps its signature and its bytes, because korin parses them.

### 5. Reads are not cached in-process; two limiters bound them

- **No in-process cache.** Every read is per-owner, and `?tag=` is free text, so a cache key would be
  caller-chosen — and `TtlCache` has no size bound (#662). Responses send
  `Cache-Control: private, max-age=300` instead.
- **`feedAuthLimiter`** — per IP, counting **failures only**: brute force and junk-token floods, without
  throttling legitimate polling.
- **`feedLimiter`** — per **validated member**, across all their feeds. It bounds each member's DB cost
  however many filtered URLs they subscribe, and an aggregator polling many members from one IP is not
  penalised.
- Both are **new limiter instances**, never a re-mount of an existing one (#560: one instance twice on a
  request counts it twice). An over-limit feed is a bare `429`.

### 6. Settings and rotation

- `GET /api/profile/me/feeds` answers `{ enabled: false }` or
  `{ enabled: true, feeds: { contributions, mine, news, bookmarks } }` as **complete URLs**. The api owns
  the URL shape; there is no bare token field to copy by mistake. Session-required, `no-store`.
- `POST /api/profile/me/feed-token/rotate` bumps the member's epoch and answers the same shape.
- `POST /api/users/:id/feed-token/rotate` lets staff revoke a leaked feed, behind a new
  **`users_edit_reset_feeds`** (ADR-0001: name the exact permission). It takes a required `reason` for
  the audit row and an optional `message` sent as a System PM, as #636's staff writes do. **Staff never
  see a member's feed URLs.**
- Both rotations share one module function and write a `feed_token_rotated` audit row whose meta
  records self or staff.

## Rejected

- **A stored `feedKey`/`announceKey` per user.** The mirror ADR-0013 removed.
- **Reusing an existing credential** (the proposal's option B). A session cannot be presented by a feed
  reader, and `STELLAR_SERVICE_KEY` is service-to-service, not per member.
- **Deriving from the password hash.** Couples a login credential to a URL, and makes "new feed URL"
  cost a password change.
- **Deriving the feed secret from the JWT secret.** Rotation of either would force rotation of both.
- **Legacy-style named category feeds** (`…_flac`, `…_lossless24`). A fixed catalog of combinations that
  still cannot express community or tag.
- **An in-process cache.** See §5.

## Consequences

- **Feed content is a pure projection** of existing contribution, bookmark and news state, computed on
  read (ADR-0007) — no new durable rollup.
- **The token is bearer-grade.** Anyone holding a URL reads that member's feeds, which show no more
  than the release pages already show that member. Rotation is the remedy for a leaked URL.
- **Two AGENTS.md rules gain a named exception**: feed routes need no session, and answer
  `application/rss+xml` rather than JSON.
- **korin's role is unchanged.** korin renders and announces; stellar owns the feed data and the token
  derivation. Nothing new is inbound on stellar beyond the feed routes.
- **One new column** (`feedTokenEpoch`), **one new env var**, **one new permission**. The permission is
  a JSON rank key, so it needs no migration; the staff rank seeded by `bootstrap.ts` carries it.

## Not done

- **Per-filter feeds** (`filter/:id.xml`) — blocked by #263, tracked in #663. The legacy implementation's
  filter feeds were among its most used, which is why this is recorded rather than dropped.
- **Blog and forum feeds.** No demand; a forum feed would also need `minClassRead` per owner.
- **A news archive page.** Only the latest five news items render in the UI, so only those feed links
  land on their item (stellar-ui#348). Older links land on the homepage.
- **Multi-value and OR filters.** Additive later without breaking a URL.
- **Content freeze.** [ADR-0035](0035-content-freeze-and-the-settings-read-path.md) is Proposed and
  unbuilt. If it is built, the contribution feeds join its barrier and `news.xml` does not.

## Acceptance note (2026-09-17)

Accepted after the #262 grill, which checked the proposal and #262's July blueprint against source and
against the legacy implementation. The proposal's decision — derive, don't mint — stands unchanged.
What changed is scope and detail.

**The four open questions, answered:**

1. _Token algorithm and rotation epoch_ — §1. HMAC-SHA256 with a per-member epoch column and its own
   server secret. The epoch is not in the path.
2. _Route placement and rate limiting_ — §2 and §5. `/api/feeds/<name>.xml?user=&token=`, two limiters.
3. _RSS vs Atom, and reuse of `announce.ts`_ — RSS 2.0, sharing the extracted renderer (§4).
4. _Unlisted, token-only path_ — not achievable without a stored secret (§2). The id is in the URL; the
   token is what authenticates.

**What the July blueprint on #262 got wrong,** each found by reading source rather than trusting it:

- `CONTEXT.md` and PRD-02 still said "no in-repo feed, no per-user feed key"; both are amended with this.
- `isCommunityMember` no longer exists; access is `releaseVisibleTo` (ADR-0036).
- A `TtlCache` keyed per feed name cannot serve access-filtered reads, and the class is unbounded (#662).
- `/filter/:filterId.xml` has nothing to read until #263 lands.

**Delivered in three PRs:** this record with its CONTEXT, PRD-02 and AGENTS.md amendments; the token,
settings and rotation routes; the feeds themselves.
