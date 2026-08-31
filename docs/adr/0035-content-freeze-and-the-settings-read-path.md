# Content freeze is one stored flag with a derived mount barrier

**Status: Proposed (2026-08-31).** Design record for [#344](https://github.com/orphic-inc/stellar-api/issues/344); **whether to build the feature at all is still open.** The decisions below are settled _conditionally_ — they are what the implementation should do **if** it happens, not a commitment that it will. Read the blast radius in Context first: this closes the content half of the site, and that is a product call, not a technical one. Nothing here is implemented. Follows [ADR-0022 install state is a recorded fact](0022-install-state-recorded-fact.md) directly — the same recorded-fact / derived-representation split, applied to a flag that differs from install in the one way that matters: it is reversible. Relates to [ADR-0018 development lifecycle and the API/UI contract gate](0018-development-lifecycle-and-contract-gate.md) (this ADR is that gate firing) and [ADR-0001 granular permission checks](0001-granular-permission-checks.md) (the barrier is a lifecycle gate, deliberately outside the permission graph).

## Context

An operator standing up a Stellar instance may not want the content half at all. The expected flow is a SysOp deciding, **before opening the site**, that this deployment is a forums-and-community instance rather than a contribution tracker. Flipping it on a live site is supported but secondary.

The product decisions were settled in #344 and are not reopened here: the gated surfaces go **hard off** (503, not empty lists), **downloads are included**, and there is **no staff bypass**. Worth restating what that adds up to, because the name understates it: this is not "contributions are paused", it is "the content half of the site is closed". Forums, messages, staff inbox, profiles, wiki and collages stay up; everything touching the contribution graph does not — including the pending contribution queue, which no one, staff included, can work until the flag comes back off.

The interesting problem is not the gate. It is **where the gate reads from**.

`getSettings()` (`src/modules/settings.ts:17`) is a `prisma.siteSettings.upsert`, not a read. It is written that way so the singleton row materialises lazily on first access, which is right for the call sites it has today — a handful of admin and install paths. Put it on a barrier that fires for every request across seven route families and it becomes a **write-capable round trip on the hot path of most of the API**. That is the real cost of this feature, and it is why an otherwise unremarkable boolean earns an ADR.

The obvious cache is the wrong one. `installState.ts:21-24` caches only the positive and says why: _"install is irreversible in normal operation, so once installed we latch and skip the DB. The negative is never cached."_ That asymmetry is load-bearing there — it is exactly what makes explicit invalidation unnecessary when `POST /install` stamps. A **bidirectionally toggleable** flag inverts the assumption on both sides: neither value is permanent, so neither can be latched, and the absence of a cached negative can no longer serve as the invalidation. Reusing that module would be borrowing its shape while discarding the reasoning that justifies it.

## Decision

Record one fact, read it without writing, cache it with a real invalidation, and gate at the mount.

1. **One stored truth: `SiteSettings.contentDisabled Boolean @default(false)`** on the existing `id: 1` singleton (`prisma/schema.prisma`, `model SiteSettings`), with a dated migration directory (closest precedent: `20260718000000_default_registration_closed`).

   Named `contentDisabled`, not `contributionsDisabled`. The flag gates downloads, top10, requests, artists and communities as well as contributions; a name that says "contributions" would describe a fifth of its blast radius and mislead every future reader deciding whether it is safe to flip. The name is settled **before** the migration lands deliberately — renaming afterwards is a migration plus a cross-repo contract change.

   The 503 envelope follows the field, not #344's original sketch:

   ```
   503 { contentDisabled: true, msg: '…' }
   ```

2. **The barrier is a mount-level gate, mirroring the install gate.** `src/app.ts:130` is the codebase's only runtime-read barrier and is the template — `app.use('/api', …)`, 503 with a typed envelope, mounted after the exempt routers. The freeze barrier registers **after** the install gate and the write limiter, so an uninstalled instance still answers "not installed" and rate limiting still applies first.

   It covers **six** prefixes — one fewer than #344's seven-router table, not more:

   | prefix               | covers                                                                         |
   | -------------------- | ------------------------------------------------------------------------------ |
   | `/api/requests`      | the requests family                                                            |
   | `/api/communities`   | communities **and** `/api/communities/:communityId/dnc`, which sits beneath it |
   | `/api/contributions` | the contributions family **and** `downloadsRouter`'s two access routes         |
   | `/api/artists`       | the artists family                                                             |
   | `/api/top10`         | top10, including snapshot creation                                             |
   | `/api/downloads`     | `downloadsRouter`'s reverse route — **the prefix #344's table omits**          |

   Two corrections to #344 are folded into that table, and they pull in opposite directions.

   #344 warns that `downloadsRouter`'s bare `/api` mount (`src/app.ts:165`) means "a prefix-based barrier does not cleanly cover it — gate inside the router, or move the mount". That is not the case. Express matches middleware by **path**, not by owning router, so a barrier registered on `/api/contributions` before that mount intercepts `/api/contributions/:id/access` regardless of which router would have served it. The genuine finding is narrower: the router spans two families, and the second — `/api/downloads/:grantId/reverse` — needs a prefix that appears nowhere in the issue. No router surgery and no mount move.

   In the other direction, `dnc` needs no entry of its own: `/api/communities/:communityId/dnc` is beneath `/api/communities`, so the communities prefix already covers it. Listing it separately would be harmless but misleading — it would imply the barrier depends on mount order, which it does not.

   The barrier is order-independent in that sense, but the **existing** router registrations are not, and inserting middleware must not disturb them: `dncRouter` still registers after `communitiesRouter`, and `artist.ts`'s static segments (`/vanity-house`, `/history/:artistId`, `/similar`, `/alias`, `/tag`) still precede its `/:id` patterns.

   A router-level barrier is also the only uniform cover for `requests.ts`, whose `GET /` and `GET /:id` are **unauthenticated** and whose permission checks happen inside handlers via `loadPermissions` rather than as middleware. There is no per-route hook that reaches all of it.

3. **The gate's read is a read.** The barrier does not call `getSettings()`. It gets a **read-only accessor** — a `findUnique` on the singleton — because the upsert's laziness buys nothing on this path: post-install the row is guaranteed to exist, created by `seedAll` and stamped by `markInstalled`. `getSettings()` keeps its current semantics for its current callers; nothing else changes behaviour.

   This is the decision the feature actually turns on. A barrier that writes on every read is not a barrier, it is a throughput regression with a boolean attached.

4. **Cached with explicit invalidation on write.** The accessor is memoised through the existing `TtlCache` (`src/lib/ttlCache.ts`) as a module-level singleton, following the `top10Cache` pattern. Two mechanisms, doing different jobs:

   - a **short TTL** as the backstop, bounding staleness if a write path is ever missed;
   - an **explicit `delete(key)` from `updateSettings()`**, so a staff toggle takes effect on the next request rather than whenever the TTL happens to lapse.

   Nothing in this codebase invalidates a cache on write today, which makes this the genuinely new mechanism here and **the part of the change most worth reviewing**. The TTL is not the correctness story — the invalidation is; the TTL only limits the damage when the invalidation is wrong. A staff member flipping the flag and watching the site not change for thirty seconds would reasonably conclude the feature is broken.

   Note `TtlCache` is string-keyed with a generic value (`get<T>` / `set<T>` / `delete`), not the generic `TtlCache<K,V>` `AGENTS.md` describes. For a single constant key that is immaterial, but the description is wrong and should not be trusted as a spec.

5. **No staff bypass, downloads included** — as decided in #344, restated here because it is the part most likely to be softened later by someone who finds it inconvenient. The flag is absolute. If the blast radius turns out to be wrong for the intended trigger, the place to revisit is the **downloads decision**, not the barrier.

6. **`rankProgressionJob` pauses with the flag; the other six jobs continue.**

   All seven start together behind an existing `DISABLE_BACKGROUND_JOBS !== '1'` guard (`src/app.ts:233`) — worth noting as precedent that job startup is already conditional, so this is a second condition rather than a new idea. (#344 counts six; `startAssetSweepJob` has since been added.)

   - **`rankProgressionJob` pauses.** It promotes and demotes on contribution counts that can no longer change. Continuing to run it means demoting members for inactivity they are _barred_ from remedying, and notifying them about it — a punishment for the operator's decision, delivered to the wrong party.
   - **`statsJob` continues.** The flat line is true. A gap in the series is harder for a later reader to interpret than a flat stretch, and it would be indistinguishable from an outage. Recording that nothing happened is the accurate record of a period in which nothing happened.
   - **`linkHealthJob` continues** — health data staying fresh through a freeze is desirable, and rechecking links is not a content mutation.
   - **`announceJob` idles naturally** (no new contributions to push), and **`ircJob`**, **`donorExpiryJob`** and **`assetSweepJob`** are unaffected: none reads the contribution graph as its trigger.

7. **A launch-checklist advisory** while the flag is on, following `getSetupChecklist` (`src/routes/api/install.ts:74`) — items are `{id, message}` filtered against `dismissedLaunchChecklist`. An operator who freezes a site before launch and forgets is the failure this prevents, and it is the same failure the `registrationStatus === 'closed'` item already guards against.

## Consequences

- **Four shapes must change with the schema or they drift silently.** `DEFAULTS` (`src/modules/settings.ts:7`), the Zod schema (`src/schemas/settings.ts:3`), **both** OpenAPI shapes (`src/lib/openapi.ts` — the `SiteSettings` response object and the PUT body), and the harness mock (`src/test/apiTestHarness.ts`). Nothing enforces their agreement; each is a hand-maintained copy of the same row.

- **Two of those are already stale, and one is a live contract bug.** The `SiteSettings` response schema omits `dismissedLaunchChecklist` and `installedAt`; the PUT body omits `dismissedLaunchChecklist` — **which `updateSettingsSchema` actually accepts**. stellar-ui generates its types from this spec, so a valid request is currently inexpressible downstream. Fixing this belongs in the implementation pass, because a fifth field added to an already-wrong shape compounds it.

- **`POST /api/install/checklist/:id/dismiss` hand-rolls its own upsert** (`src/routes/api/install.ts:125`) enumerating fields explicitly rather than calling `updateSettings`, with `as never` casts on both branches. A new field carrying a Prisma default is safe there — the `create` branch cannot fire post-install — but the casts mean **TypeScript will not catch it if that assumption ever stops holding**. It is also a second write path that must invalidate the cache, or a dismissal will serve stale settings.

- Gating `/api/top10` stops snapshot **creation**, not merely its display: `createSnapshot` has exactly one production caller, the admin-gated `POST /api/top10/snapshot` (`src/routes/api/top10.ts:133`), and no background job invokes it.

- The barrier adds one cached read to seven route families and, on a cache miss, one `findUnique`. Compared with today's alternative — an upsert per request — this is the difference between the feature being viable and not.

- Flipping the flag back off restores every surface with no restart, which is the property the positive-only latch would have destroyed.

- A migration adds one boolean with a default. No backfill: `false` is the correct value for every existing row, and it is what an instance that has never heard of this flag already behaves as.

## Deferred / out of scope

- **The stellar-ui half** — hiding gated nav entries, the site-wide freeze banner, and the admin toggle on `SiteSettingsPage.tsx` carrying the "freezes existing content" warning before the change commits. Filed separately and cross-referenced. It is a **hard dependency of the chosen semantics, not a follow-up**: without it, gated links 503 and the site reads as broken rather than closed, which is precisely the outcome "hard off" was chosen to avoid.
- **The warning copy itself** — drafted in #344, finalised with the UI change that displays it.
- **Per-surface granularity.** This is one flag, not seven. If an operator ever wants forums-plus-requests-but-no-downloads, that is a different feature with a different shape, and splitting later is cheaper than guessing the axes now.
- **A scheduled or timed freeze.** The flag is set by a person and cleared by a person.
