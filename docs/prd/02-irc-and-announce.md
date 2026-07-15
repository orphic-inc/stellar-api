# PRD-02 — IRC & Announce

**Status:** Shipped via **korin.pink** ([ADR-0013](../adr/0013-korin-pink-irc-integration.md)) — stellar-api consumes IRC signals from the external service: it pulls per-nick metrics, computes IRCScore on read, resolves the nick↔account map, and pushes new Contributions to korin's announce. Nick ownership is now **verified** ([ADR-0015](../adr/0015-verified-irc-nick-link.md)). Outstanding: IRCScore magnitude pinning ([#141](https://github.com/orphic-inc/stellar-api/issues/141), HITL). · **Owner:** @obrien-k · **Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md)
**Decisions:** [ADR-0013 korin.pink IRC integration](../adr/0013-korin-pink-irc-integration.md), [ADR-0015 verified IRC nick link](../adr/0015-verified-irc-nick-link.md), [ADR-0007 CRS read-time + ledger](../adr/0007-crs-read-time-and-event-ledger.md). _Superseded by ADR-0013:_ [ADR-0011 delegated IRC authentication](../adr/0011-delegated-irc-authentication.md), [ADR-0012 IRC activity rollup substrate](../adr/0012-irc-activity-rollup-substrate.md).
**Numbering:** PRD-01 Community-Score · **PRD-02 IRC & Announce** · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · PRD-05 Rules & Governance · PRD-06 Ratio · PRD-07 Donations · PRD-08 Collages & Cover Art

> Lean PRD. Covers **IRC + Announce together** (they share the korin.pink integration seam); **Donations are split into their own PRD** (overlaps [#62](https://github.com/orphic-inc/stellar-api/issues/62)). IRC conduct rules live in [PRD-05](05-rules-and-governance.md) (IRCRules / [#126](https://github.com/orphic-inc/stellar-api/issues/126)); this PRD covers what stellar-api owns, not the rule prose and not the IRC infrastructure (which is korin.pink's).

## Problem

Stellar is a content-tracker-lineage community: members want a real-time **social hub** and a **release-announce channel** — the out-of-band firehose of new Contributions (the torrent-announce stand-in, Golden Rule 3). The IRC network itself (IRCd, bridge, web client, wiki) is operationally distinct from the core platform — different VPS, different release cadence — so it is **not** hosted in stellar-api. What stellar-api owns is the _integration_: turning IRC activity into reputation, mapping nicks to accounts, and feeding the announce channel.

## Architecture (decided — ADR-0013)

The IRC substrate lives in an **external service, `obrien-k/korin-pink`**, on its own VPS and release cadence. stellar-api **consumes** IRC signals across a fixed wire contract — it never hosts an IRCd, a bot, or a bouncer.

- **korin.pink owns the substrate and raw signals** — the Ergo IRCd, the irc-bridge daemon (TLS/SASL → Ergo), the wiki/web surface, and per-user metrics `{messageCount, presenceSeconds, channelCount, channels, window}`. It does **not** compute IRCScore.
- **stellar-api owns the IRCScore formula, the nick↔account map, and the release data.** IRCScore is computed read-time from korin's raw signals; `User.ircNick` is the (verified) mapping; Contributions are the announce source.
- **Ownership is non-overlapping by design.** The first integration cut under-specified direction and ownership, producing a circular IRCScore claim and an over-removed announce path; ADR-0013 §Integration contract is the source of truth for the wire shape and is mirrored in korin.pink's own docs.

## Integration contract (the wire seam)

Five flows, each fails closed until its key is set. Keys: `KORIN_API_URL` / `KORIN_PULL_KEY` (stellar→korin, both directions of stellar-initiated calls) and `STELLAR_SERVICE_KEY` (korin→stellar Bearer).

| Flow             | Direction                | Endpoint                                        | Auth                            | Lives in                                      |
| ---------------- | ------------------------ | ----------------------------------------------- | ------------------------------- | --------------------------------------------- |
| IRC metrics      | **stellar pulls korin**  | `GET {KORIN_API_URL}/irc/metrics`               | `x-pull-key: KORIN_PULL_KEY`    | `irc.ts` poll client + `ircJob.ts` cache      |
| Release announce | **stellar pushes korin** | `POST {KORIN_API_URL}/irc/announce`             | `x-pull-key: KORIN_PULL_KEY`    | `announce.ts` + `announceJob.ts`              |
| nick → account   | **korin calls stellar**  | `GET /api/users/by-irc-nick/:nick`              | `Bearer STELLAR_SERVICE_KEY`    | `user.ts` / route + `serviceAuth.ts` gate     |
| link nick        | self/korin               | `PUT /api/users/:id/irc-nick` `{ircNick}`       | Bearer (or session, self/admin) | profile/user route — creates a **Nick Claim** |
| verify nick      | **korin calls stellar**  | `POST /api/users/irc-nick/verify` `{nick,code}` | `Bearer STELLAR_SERVICE_KEY`    | `ircNick.ts` (ADR-0015)                       |

The metrics pull is cached in-process (TTL 2× poll interval); both stellar→korin calls present `KORIN_PULL_KEY`; all korin→stellar calls are Bearer `STELLAR_SERVICE_KEY` and gated by `serviceAuth.ts` (fails closed when unset).

## Identity — the verified nick link (ADR-0015)

A member's IRC identity is a single unique, nullable field: **`User.ircNick`**. There are **no per-user IRC secrets** — the old `IRCKey` / `AnnounceKey` pair was retired with the in-repo build and is **not** revived (ADR-0015 §Scope). Ownership is **proven**, not self-asserted, via a challenge/nonce handshake:

1. **Claim (Stellar):** `PUT /api/users/:id/irc-nick {ircNick}` creates a **Nick Claim** — the asserted nick plus a single-use **Verification Code** (8-char, 30-min expiry). It does **not** yet write `User.ircNick`. A claim reserves nothing; multiple members may claim the same nick.
2. **Prove (IRC):** the member sends `!verify <code>` in a **private query** to the bridge bot, from the claimed nick.
3. **Relay (korin → Stellar):** the bridge → korin → `POST /api/users/irc-nick/verify {nick, code}` (Bearer `STELLAR_SERVICE_KEY`), a synchronous stateless pass-through so the bot can reply.
4. **Confirm (Stellar):** on a matching, unexpired `(fromNick, code)`, the claim is promoted to a **Verified IRC Link** (`ircNickVerified = true`, `ircNick` set, code cleared).
5. **Gate:** only a Verified IRC Link credits IRCScore or resolves through `GET /by-irc-nick/:nick`.

The security boundary is the `(fromNick, code)` binding plus Ergo's `force-nick-equals-account`: a leaked code is useless to anyone who can't already present it _as that nick_. Admins may set/clear a nick but cannot mint verified status (verification asserts Ergo-control). See [ADR-0015](../adr/0015-verified-irc-nick-link.md) for the full threat model, the no-lockout decision, and the retired-keys mapping.

## Announce

stellar-api **pushes** each new Contribution to korin; there is no in-repo RSS feed, no per-user feed key, and no bot worker.

- **`announceJob.ts`** runs a cursor over new Contributions and, for each, builds a one-item RSS artifact and `POST`s it to `{KORIN_API_URL}/irc/announce` (`announce.ts`), authenticated by `KORIN_PULL_KEY`. korin renders the newest artifact to `#announce`. This **reverses the direction** of the superseded in-repo AnnounceKey-gated feed — stellar emits, korin delivers.
- **Delivery shape (#136): notify-and-link.** The announce item carries a plain link into the app (the release page), never a tokenized one-shot URL. The download still resolves to a session-authed, ratio-accounted grant; the link only saves a click. This is why **key-authenticated access to content over IRC is deliberately not reintroduced** (Golden Rule 3).
- **`!commands` / bot automation** live in korin.pink and reach back through the public/service API only (Golden Rule 5: automation via the API).

## IRCScore (CRS dimension)

`IRCScore` is a bounded CRS **Dimension Scorer** (PRD-01) computed **on read** from korin's last polled flush window — no stored score, no in-repo activity table (ADR-0007 holds; the superseded `IrcActivity` rollup is gone). The pure scorer is `getIrcScore` in `src/modules/irc.ts`, reading the window cached by `ircJob.ts`.

```
IRCScore = activity × consistency × channelQuality        (then clamped to the dimension cap)
activity       = log1p(messageCount)  / log1p(ACTIVITY_REF)   → [0, 1]
consistency    = min(presenceSeconds / windowDuration, 1)     → [0, 1]
channelQuality = log1p(channelCount)  / log1p(CHANNEL_REF)    → [0, 1]
```

Anti-farming is structural: log-scaling on message count gives hard diminishing returns, `consistency` rewards sustained presence over one-session marathons, and `channelQuality` (also log-scaled) defeats single-channel spamming. The reputation registry applies the per-dimension cap (`IRC_CAP` = **2**, pinned 2026-06-23 — deliberately thin until real IRC traffic exists) so IRC can never dominate the CRS. `ACTIVITY_REF` = 50 and `CHANNEL_REF` = 5 are likewise pinned. The channel-weight **mechanism** ([#141](https://github.com/orphic-inc/stellar-api/issues/141)) now ships: `channelQuality` reads an `effectiveChannels` count that a `KORIN_CHANNEL_WEIGHTS` map (JSON `{"#channel": weight}`) can re-weight per channel. The map is **empty by default — behaviour-identical to raw channel counting** — and pinning actual weights remains the one **HITL/TBD** magnitude, deferred until there is real multi-channel traffic to calibrate against.

## Concept → code (descent map)

| Concept                            | Lives in                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| IRC substrate (IRCd, bridge, wiki) | **external** — `obrien-k/korin-pink` (not stellar-api) ([ADR-0013](../adr/0013-korin-pink-irc-integration.md))   |
| `User.ircNick` (verified link)     | `prisma/schema.prisma` — unique, nullable; written only on verified promotion                                    |
| Nick claim + verify                | `src/modules/ircNick.ts` + `POST /api/users/irc-nick/verify` ([ADR-0015](../adr/0015-verified-irc-nick-link.md)) |
| IRC metrics pull + cache           | `src/modules/irc.ts` (poll client) + `src/modules/ircJob.ts` (poll job)                                          |
| `IRCScore` dimension               | `src/modules/reputation.ts` registry entry → `getIrcScore` pure scorer (`irc.ts`)                                |
| Announce push                      | `src/modules/announce.ts` + `src/modules/announceJob.ts` → korin `POST /irc/announce`                            |
| nick → account resolve             | `GET /api/users/by-irc-nick/:nick`, Bearer-gated (`serviceAuth.ts`)                                              |
| Service keys                       | `KORIN_API_URL` / `KORIN_PULL_KEY` / `STELLAR_SERVICE_KEY` (`modules/config.ts`)                                 |
| IRCRules (conduct)                 | [PRD-05](05-rules-and-governance.md) + [#126](https://github.com/orphic-inc/stellar-api/issues/126) (HITL)       |

## Status — what shipped

- ✅ **korin.pink integration** — metrics pull + in-process cache, IRCScore read-time scorer registered into the CRS, announce push, and the Bearer-gated `by-irc-nick` / `reputation` inbound calls (ADR-0013; in-repo build #134–140 shipped-then-superseded, removed via #148/#150).
- ✅ **Verified nick link** — challenge/nonce claim → `!verify` → `POST /irc-nick/verify` → promotion; only verified links credit IRCScore or resolve (ADR-0015; #175).
- ✅ **IRCScore magnitudes** — cap pinned at **2** and `ACTIVITY_REF` = 50 / `CHANNEL_REF` = 5 confirmed (2026-06-23); the channel-weight **mechanism** (config-driven `KORIN_CHANNEL_WEIGHTS`, neutral empty default) shipped with test coverage. ⏳ Only the actual weight **values** remain, deferred until real multi-channel traffic exists ([#141](https://github.com/orphic-inc/stellar-api/issues/141), HITL).

## Open questions

- **Channel-weight map values** — the mechanism ships (config-driven `KORIN_CHANNEL_WEIGHTS`, neutral empty default); pinning the actual per-channel weights is the one IRCScore magnitude still TBD (cap and refs pinned 2026-06-23), deferred until real multi-channel traffic exists to weight (#141). korin exposes no canonical channel-list endpoint today — the de-facto channels are the bridge join set (`#announce,#stellar,#korin`).
- **IRCScore teeth (positive reinforcement) — noted 2026-06-13, not scoped.** Today IRCScore only feeds CRS as substrate. The intended downstream: high scorers _earn capability_ — rights to create official channels, moderation in specific community channels — administered via the **Staff Toolbox** / **Community Toolbox** (see [PRD-01 → Future direction: making CRS bite](01-Community-Score.md)). Privilege-granting, never a download gate.
- **Periodic re-verification.** Verified links don't expire in v1 (ADR-0015); a member abandoning a nick later re-registered by someone else is an accepted narrow window. Re-verification cadence is a future option.

## Resolved decisions

- **Announce delivery shape (#136, 2026-06-13): notify-and-link-into-the-app.** The announce item carries a plain link to the release page, not a one-shot tokenized URL — no token-mint/expiry/replay surface. The download still resolves to a session-authed accounted grant; the link only saves a click.
- **Nick ownership is proven, not self-reported (ADR-0015).** ADR-0013 shipped self-reported `ircNick` and deferred verification to "v0.2.x"; ADR-0015 pulled it forward to close the IRCScore-harvest hole via challenge/nonce rather than reviving delegated SASL.
- **The keys stay retired (ADR-0015 §Scope).** `IRCKey` / `AnnounceKey` each conflated jobs now served without a secret: identity → the Verified IRC Link; announce attribution → public metadata on the announce item; crediting on consumption → the session-authed accounted download (unchanged); private-community announce delivery → a separate, unmodeled access-control feature tracked elsewhere.
