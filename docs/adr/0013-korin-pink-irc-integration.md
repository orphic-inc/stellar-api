# ADR-0013: korin.pink IRC Integration Architecture (supersedes the in-repo IRC build)

**Status:** Accepted
**Date:** 2026-06-14
**Repos:** orphic-inc/stellar-api, obrien-k/korin-pink
**PRD:** [PRD-01 Community-Score](../prd/01-Community-Score.md) — IRCScore dimension (v0.1.x), [PRD-02 IRC & Announce](../prd/02-irc-and-announce.md)
**Supersedes:** [ADR-0011 — Delegated IRC authentication](0011-delegated-irc-authentication.md), [ADR-0012 — IRC activity rollup substrate](0012-irc-activity-rollup-substrate.md)

> **Renumbered from ADR-0005** (2026-06-14). The earlier draft was authored on a stale branch and collided with main's `0005-contribution-model-from-upload-form`. It was also written greenfield — as if no IRC build existed. Both are corrected here.

---

## Context

stellar-api first shipped IRC **in-repo**: a self-hosted Ergo IRCd authenticated by a delegated SASL callback into this API ([ADR-0011](0011-delegated-irc-authentication.md), `User.ircKey`/`announceKey`), with IRCScore computed from an in-repo `IrcActivity` rollup table upserted by an in-repo bot ([ADR-0012](0012-irc-activity-rollup-substrate.md)). That build merged to `main` via #143 (2026-06-13).

The project has since **pivoted IRC out of stellar-api into a dedicated external service, korin.pink** (`obrien-k/korin-pink`): irc-bridge daemon (TLS/SASL → Ergo, per-user metrics), wiki, and the `/irc/metrics` API. The motivation is operational separation — IRC infra (IRCd, bridge, wiki) lives on its own VPS and release cadence, decoupled from the core platform. This makes the in-repo IRC build (ADR-0011/0012) the **wrong layer**: stellar-api should _consume_ IRC signals from korin.pink, not _host_ the IRC substrate itself.

This ADR records that supersession and the integration design that replaces it. The remaining question is only how stellar-api acquires per-user IRC signals from korin.pink's irc-bridge and folds them into the read-time CRS aggregator ([ADR-0007](0007-crs-read-time-and-event-ledger.md)):

| Pattern            | Description                                                           | Tradeoff                                                                 |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Pull (polling)** | stellar-api polls `GET /irc/metrics` every N minutes                  | Simple; tolerates korin downtime; stale by up to one interval            |
| **Push (webhook)** | korin forwards each flush to stellar-api `POST /webhooks/irc-metrics` | More real-time; requires stellar reachable from korin; needs retry logic |

---

## Decision

1. **External korin.pink supersedes the in-repo IRC build.** ADR-0011 and ADR-0012 are superseded. stellar-api no longer hosts the IRCd auth seam or the `IrcActivity` rollup; korin.pink owns the IRC substrate and exposes signals over its API.

2. **Pull (polling).** stellar-api polls korin's `GET /irc/metrics` on a configurable interval (default 5 min via `KORIN_POLL_INTERVAL_MS`). The last payload is held in-process via `TtlCache` with TTL 2× the poll interval, so one missed poll doesn't evict valid data mid-read. Webhooks are not ruled out for a later version; at v0.1.x scale (single-server, 60s flush windows) the polling gap is immaterial and the simpler path wins.

---

## Rationale

- **Separation of concerns + blast radius.** IRC outages, IRCd upgrades, and spam-handling churn stay on korin.pink and can't take down or redeploy the core platform. ADR-0011's "single source of truth" concern is preserved at the new boundary: korin.pink owns IRC identity; stellar-api owns the Stellar account and maps to it by self-reported nick.
- **Polling tolerates korin downtime gracefully.** A missed poll leaves the cached window stale rather than losing data; a failed webhook would lose the window without retry logic — complexity unwarranted at this scale.
- **No inbound surface on stellar-api from korin.** korin lives on a separate instance; polling means stellar controls the connection.
- **Consistent with ADR-0007 (CRS computed on read).** IRCScore becomes a pure function of the cached `IrcUserMetrics` — no score column, no recompute job, same pattern as longevity/ratio/friends. This is why ADR-0012's durable `IrcActivity` rollup is no longer needed: the durable substrate now lives in korin.pink, and stellar reads a cached snapshot.

---

## IRCScore formula

```
IRCScore = activity × consistency × channelQuality   (scaled to IRC_CAP = 2)

activity       = log1p(messageCount)     / log1p(ACTIVITY_REF=50)   → [0, 1]
consistency    = presenceSeconds / windowDurationSeconds             → [0, 1]
channelQuality = log1p(effectiveChannels) / log1p(CHANNEL_REF=5)    → [0, 1]
```

`IRC_CAP` was pinned at **2** (2026-06-23, PRD-02 — deliberately thin until real IRC traffic exists); the earlier `6` here was superseded and is corrected. `effectiveChannels` is `channelCount` by default; a configured `KORIN_CHANNEL_WEIGHTS` map (#141) instead sums per-channel weights over the joined channel list — the map is empty (behaviour-identical to the raw count) until real multi-channel traffic exists to calibrate it. Log-scaling on message and channel counts prevents volume abuse; the product of three `[0,1]` factors bounds the dimension before the registry cap. Absence of an IRC nick earns 0 — IRC presence is optional, absence is not penalised.

---

## Nick → account mapping

Users link their Ergo nick to their Stellar account via `PUT /api/users/:id/irc-nick`, stored as `User.ircNick` (unique, nullable). Ownership is user-managed — Stellar trusts the self-reported nick and does not validate SASL credentials (that responsibility moved to korin.pink's irc-bridge, replacing ADR-0011's delegated callback). For v0.1.x this is acceptable; v0.2.x may add verification via a SASL challenge through the irc-bridge.

> **Amended by [ADR-0015](0015-verified-irc-nick-link.md) (2026-06-17).** The deferred verification is pulled forward to v0.1.x — but via a challenge/nonce `(fromNick, code)` proof relayed through the bridge, **not** a SASL challenge and **not** ADR-0011's delegated SASL. A self-reported nick is now a _Nick Claim_ (reserves nothing, credits nothing); only a verified _Verified IRC Link_ sets `ircNick`, credits IRCScore, and resolves via `by-irc-nick`. See the new `verify nick` flow in the Integration contract below.

---

## Migration / reconcile (in-repo → external)

The reconcile lands as part of the `feat/korin-pink` integration onto `main`. Net effect: **keep main's non-IRC work; replace main's IRC layer with korin's.**

**Schema (`prisma/schema.prisma`)**

- **Remove** `model IrcActivity` (ADR-0012 rollup) and its `User.ircActivity` relation.
- **Remove** `User.ircKey`, `User.announceKey` (ADR-0011 in-repo credentials).
- **Add** `User.ircNick String? @unique`.
- **Keep main's** `communityPass` removal (#134) and the `ReleaseFile` music-model satellite (#72/#74) — those are unrelated to IRC; korin's stale-branch versions of them lose.
- New migration (run via `prisma migrate dev` — interactive TTY required):

  ```sql
  -- ADR-0013: korin.pink external IRC supersedes the in-repo build.
  -- Table is mapped to "users"; reverses 20260613000000 + 20260613000001.
  DROP TABLE "irc_activity";
  DROP INDEX "users_ircKey_key";
  DROP INDEX "users_announceKey_key";
  ALTER TABLE "users" DROP COLUMN "ircKey",
  DROP COLUMN "announceKey";
  ALTER TABLE "users" ADD COLUMN "ircNick" TEXT;
  CREATE UNIQUE INDEX "users_ircNick_key" ON "users"("ircNick");
  ```

  Committed as `prisma/migrations/20260614000000_korin_pink_supersede_irc/`. Run `prisma migrate dev` (interactive TTY) to apply / verify against the schema.

**Code — merge conflicts (6).** Rebasing `feat/korin-pink` onto `main` surfaces exactly six conflicting files. Three are clean side-takes (korin wins); three are genuine hand-merges where a naive side-take loses non-IRC work:

| File                             | Resolution                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/config.ts`          | Take korin — drop the `irc` `{ botToken, saslSecret }` block, keep `korin` `{ apiUrl, pullKey, pollIntervalMs }`.                                                                                                   |
| `src/modules/reputation.ts`      | Take korin (4 hunks) — `ircScorer` reads `getIrcScore(ircNick)` from `irc.ts`, `ircNick` in `DimensionInput`, drop the `prisma.ircActivity` query. Self-consistent: imports `./irc`, defines `IRC_CAP = 2` locally. |
| `src/modules/reputation.spec.ts` | Take korin — its tests cover the external IRCScore; main's cover the deleted in-repo scorer (~166 lines, effectively two different files).                                                                          |
| `prisma/schema.prisma`           | **Hand-merge** — main's `User` model (no `communityPass` per #134, no `ircKey`/`announceKey`) **+** korin's `ircNick String? @unique`. korin's branch still carries `communityPass`; a blind take reintroduces it.  |
| `package.json`                   | **Hand-merge** — main's `version` + `prepare: husky install` **+** korin's `db:seed-wiki` script.                                                                                                                   |
| `CHANGELOG.md`                   | **Hand-merge** — keep main's structure/entries; rewrite korin's `[0.5.61]` entry for the _external_ korin.pink (it currently cites the to-be-deleted `irc.ts`/`ircJob.ts` and the old "ADR-0005" → now ADR-0013).   |

**Code — in-repo IRC subsystem to delete (#143).** These carry **no conflict markers** — they simply don't exist on korin's side, so the rebase won't flag them. They must be removed by hand and the suite kept green:

- **Routes:** `src/routes/api/irc.ts`, `src/routes/api/announce.ts`, `src/routes/api/keys.ts`, `src/routes/internal/ircSasl.ts`.
- **Modules:** `src/modules/ircScore.ts`, `ircActivity.ts`, `ircAuth.ts`, `announceFeed.ts`, `keys.ts`.
- **Middleware / lib:** `src/middleware/sharedSecret.ts`, `src/lib/secureCompare.ts` (consumed only by `sharedSecret` + `ircAuth`, both removed — safe to drop).
- **Schemas:** `src/schemas/irc.ts`, `src/schemas/announce.ts`.
- **Tests:** `src/irc.spec.ts`, `src/ircSasl.spec.ts`, `src/ircScore.spec.ts`, `src/keys.spec.ts`.
- **Wiring to scrub:** route registration in `src/app.ts`; entries in `src/lib/openapi.ts`; IRC helpers in `src/test/apiTestHarness.ts` and `src/test/factories.ts`.

**Code — config / env.**

- `src/modules/config.ts`: per the conflict table above (`irc` → `korin`).
- `.env.default`: `KORIN_API_URL`, `KORIN_PULL_KEY`, `KORIN_POLL_INTERVAL_MS` (already added on the fork); drop `STELLAR_IRC_BOT_TOKEN`/`STELLAR_IRC_SASL_SECRET`.

> **Gate.** The excision must end with the full pre-commit gate green — `format → lint → tsc --noEmit → test`. The Jest suite is the real safety net for the subsystem removal; deletions that leave dangling imports/registrations surface there.

**Docs**

- Flip [ADR-0011](0011-delegated-irc-authentication.md) and [ADR-0012](0012-irc-activity-rollup-substrate.md) `Status:` → `Superseded by ADR-0013 (2026-06-14)`.
- PRD-02 IRCScore section points to korin.pink as the wired source; PRD-03 IRC Mutual-Mention × Friends negative vector depends on korin-pink open question #6 (irc-bridge pairwise mention tracking) — out of scope here, tracked separately.

---

## Consequences

- `KORIN_API_URL` and `KORIN_PULL_KEY` must be set for IRC scoring to activate; if unset, `ircJob` logs a warning and skips — the scorer returns 0 gracefully.
- `User.ircNick` is a unique index; conflicting claims return HTTP 409.
- The `TtlCache` is per-process; multi-instance deployments each poll independently (Redis is the upgrade path).
- The in-repo IRC build (#143) is effectively reverted at the IRC layer. Its commit history stays on `main`; this ADR is the record of why it was superseded rather than extended.
- korin-pink's flush window (`FLUSH_INTERVAL_MS`, 60s) sets signal granularity; stellar's poll interval (`KORIN_POLL_INTERVAL_MS`, 5min) sets freshness. IRCScore reflects the most recent completed flush window at CRS read time.

---

## Integration contract (v0.1.x — bidirectional, corrected 2026-06-15)

> This section is the **single source of truth** for the stellar-api ↔ korin.pink
> wire contract. It was added after the first cut left ownership and direction
> under-specified, producing a circular IRCScore claim and an over-removed
> Announce path. korin.pink mirrors this in `docs/CLAUDE.md` (§Stellar Integration
> Contract), `docs/domain.md`, and `docs/CONTEXT.md` (open question #1 → resolved).

**Ownership (no overlap):**

- **korin.pink owns the IRC substrate and raw signals** — Ergo, the irc-bridge, and per-user `{messageCount, presenceSeconds, channelCount, channels, window}`. It does **not** compute IRCScore.
- **stellar-api owns the IRCScore formula, the nick↔account map, and the release data.** IRCScore is computed read-time from korin's raw signals (`src/modules/irc.ts`); `User.ircNick` is the mapping; contributions are the announce source.

**Flows (direction is fixed):**

| Flow             | Direction                | Endpoint                                       | Auth                                        | Notes                                                                                                                                                                                              |
| ---------------- | ------------------------ | ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IRC metrics      | **stellar pulls korin**  | `GET {KORIN_API_URL}/irc/metrics`              | `x-pull-key: KORIN_PULL_KEY`                | Payload `{users:[{nick,presenceSeconds,messageCount,channelCount,channels,windowStart,windowEnd}],lastFlushAt}`, ms epochs, keyed by **nick**. Cached in-process (TTL 2× interval).                |
| Release announce | **stellar pushes korin** | `POST {KORIN_API_URL}/irc/announce`            | `x-pull-key: KORIN_PULL_KEY`                | Body `{xmlPayload(RSS), templateType:'minimal', environment:{osc8}}`. One contribution per POST; korin renders the newest artifact to `#announce`. Reverses the superseded AnnounceKey RSS _feed_. |
| nick → account   | **korin calls stellar**  | `GET /api/users/by-irc-nick/:nick`             | `Authorization: Bearer STELLAR_SERVICE_KEY` | Returns `{id, username, ircNick}`; 404 if unlinked/disabled.                                                                                                                                       |
| link nick        | **korin calls stellar**  | `PUT /api/users/:id/irc-nick` body `{ircNick}` | Bearer (or session, self/admin)             | Field is `ircNick` (not `nick`); path is `/api`-prefixed.                                                                                                                                          |
| reputation read  | **korin calls stellar**  | `GET /api/users/:id/reputation`                | `Authorization: Bearer STELLAR_SERVICE_KEY` | CRS by id; self-serve view stays `/api/profile/me/reputation`.                                                                                                                                     |

**Rejected:** korin pushing metrics to a stellar `/reputation/irc-metrics` receiver (the orphaned `lib/stellar.ts` push path). Pull is the one model; the push client is removed from korin.

**Keys (each path fails closed until set):** `KORIN_API_URL`/`KORIN_PULL_KEY` (stellar→korin, both directions of stellar-initiated calls); `STELLAR_SERVICE_KEY` (korin→stellar bearer). korin's env names the same secrets `STELLAR_API_URL` / `STELLAR_PULL_KEY` (== `KORIN_PULL_KEY`) / `STELLAR_API_KEY` (== `STELLAR_SERVICE_KEY`).
