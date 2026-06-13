# PRD-02 — IRC & Announce

**Status:** Draft · **Owner:** @obrien-k · **Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md)
**Decisions:** [ADR-0011 delegated IRC authentication](../adr/0011-delegated-irc-authentication.md), [ADR-0012 IRC activity rollup substrate](../adr/0012-irc-activity-rollup-substrate.md), [ADR-0007 CRS read-time + ledger](../adr/0007-crs-read-time-and-event-ledger.md), [ADR-0009 dependency/infra discipline](../adr/0009-fork-workflow-and-dependency-discipline.md)
**Numbering:** PRD-01 Community-Score · **PRD-02 IRC & Announce** · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · PRD-05 Rules & Governance · PRD-06 Ratio

> Lean PRD. Covers **IRC + Announce together** (they share the credential + delivery substrate); **Donations are split into their own PRD** (overlaps [#62](https://github.com/orphic-inc/stellar-api/issues/62)); **RSS/XML feeds are a fast-follow slice** here (they reuse the announce substrate). IRC conduct rules live in [PRD-05](05-rules-and-governance.md) (IRCRules / [#126](https://github.com/orphic-inc/stellar-api/issues/126)); this PRD builds the feature, not the rule prose.

## Problem

Stellar is a content-tracker-lineage community: members want a real-time **social hub** and a **release-announce channel** — the out-of-band firehose of new Contributions (the torrent-announce stand-in, Golden Rule 3). Neither exists. The feature was deferred pending a per-user IRC credential and its pairing with a release-feed credential, both of which touch the Contribution/Community model and are net-new on `User`.

## Architecture (decided)

- **Self-hosted modern IRCd (Ergo) + a web client (The Lounge).** Ergo collapses IRCd + accounts/SASL + always-on/bouncer into one component; The Lounge gives web-only members access and is the donor-bouncer surface (donor perks → the split-off Donations PRD). Matrix was considered and set aside (IRC authenticity for a content-tracker-lineage site).
- **IRC is its own top-level section**, not a forum sub-area — gated on accepting the IRCRules ([PRD-05](05-rules-and-governance.md)) and having an **IRCKey** set.
- **Infra** lives in stellar-compose as new pinned services (Ergo + bot + The Lounge), per [ADR-0009](../adr/0009-fork-workflow-and-dependency-discipline.md) dependency discipline.

## Identity — the two keys

Two per-user credentials, **net-new** on `User` (the vestigial `communityPass` field is dropped in the same migration). Stored as unique, lazily-generated, rotatable 32-char URL-safe tokens.

- **`AnnounceKey`** — authenticates the **Release-Announce Feed** (RSS + IRC announce): *receiving* the stream of new Contributions. It **never** authenticates a download — release consumption stays a session-authed accounted grant through the Ratio Mechanism. Rotating it dead-links the prior feed URL.
- **`IRCKey`** — authenticates **IRC identity** (the SASL secret). Validated by **delegated auth**: Ergo calls an internal stellar-api endpoint per login; this API is the single source of truth, no credential mirror in the IRCd ([ADR-0011](../adr/0011-delegated-irc-authentication.md)). Rotating it drops any always-on session.
- **Paired:** to receive personalized release announcements **pushed over IRC** a member needs both (IRCKey = who you are on IRC; AnnounceKey = authorized to receive the feed).

## Announce

A **Node bot/worker** in stellar-compose bridges this API and the network:

- **Announce relay** — stellar-api emits a new-Contribution event → the bot relays to `#announce` and to the per-member feed; gated by AnnounceKey. Reuses the existing `announcements` surface.
- **`!commands`** — `!stats` / `!enroll` / support, backed by the public API with a scoped token (Golden Rule 5: automation via the API only).
- **Activity capture** — the bot upserts the **IRC Activity Rollup** (below). It does **not** store message content — counts only.

## IRCScore (CRS dimension)

`IRCScore` is a bounded CRS **Dimension Scorer** (PRD-01) over **message** activity — presence/idle never counts ([ADR-0012](../adr/0012-irc-activity-rollup-substrate.md)). Durable substrate is the **`IrcActivity` rollup** (one row per member × channel × day of message counts), computed on read over a trailing **90-day** window — no stored score (ADR-0007 rule 1 holds).

```
IRCScore = CAP × (1 − exp(−(weightedVolume × consistency) / TAU))
weightedVolume = Σ_channel  min(msgs_per_day, DAILY_CAP) × channelWeight     (over the window)
consistency    = distinctActiveDays / windowDays      // active day = ≥ MIN_MSGS messages
```

Anti-farming is structural: the per-channel/day cap defeats flooding, `consistency` defeats one-session marathons, `channelWeight` defeats spamming low-value channels. Magnitudes (`CAP`/`TAU`/`DAILY_CAP`/`MIN_MSGS`/weights) are **HITL/TBD**, hand-pinned like every other CRS magnitude.

## Concept → code (descent map)

| Concept | Lives in / will live in |
|---|---|
| IRCKey + AnnounceKey | **net-new** on `User` (`prisma/schema.prisma`); drop vestigial `communityPass` |
| Delegated SASL validation | **net-new** internal endpoint — [ADR-0011](../adr/0011-delegated-irc-authentication.md) |
| Release-Announce Feed (RSS + IRC) | net-new feed route, AnnounceKey-gated, reusing `announcements` |
| Announce relay + `!commands` bot | **net-new** worker in stellar-compose |
| `IrcActivity` rollup | **net-new** table + bot upsert — [ADR-0012](../adr/0012-irc-activity-rollup-substrate.md) |
| `IRCScore` dimension | `src/modules/reputation.ts` registry entry (pure scorer) + `DimensionInput` window fetch |
| Infra (Ergo + bot + The Lounge) | **stellar-compose** — pinned services per [ADR-0009](../adr/0009-fork-workflow-and-dependency-discipline.md) |
| IRCRules (conduct) | [PRD-05](05-rules-and-governance.md) + [#126](https://github.com/orphic-inc/stellar-api/issues/126) (HITL) |

## Red-green descent targets

1. **`IRCKey` + `AnnounceKey` on `User`** — unique, generate/rotate endpoints, drop `communityPass`. The documented blocker; everything hangs off it.
2. **Delegated SASL-validate endpoint** — internal, network-scoped; Ergo's auth callback (ADR-0011).
3. **Release-Announce Feed** — AnnounceKey-gated feed of new Contributions (IRC announce relay first; **RSS/XML fast-follow** reusing the same substrate).
4. **`IrcActivity` rollup + bot upsert** — messages-only, `user×channel×day` (ADR-0012).
5. **`scoreIrcActivity(rows, weights, window)`** — pure, table-driven, unit-tested against fixtures **before** any IRC infra; then register `IRCScore` into the CRS registry.
6. **The Lounge / bouncer** — web client surface; donor perks defer to the Donations PRD.

## Open questions

- Greenfield network, or is there an existing IRC network / nick reservations to migrate?
- `IRCScore` magnitudes + the channel-weight map — TBD with the other CRS magnitudes (HITL, like #121/#122/#126).
- **IRCScore teeth (positive reinforcement) — noted 2026-06-13, not scoped.** Today IRCScore only feeds CRS as substrate. The intended downstream: high scorers *earn capability* — rights to create new official channels, moderation in specific community channels — administered via the **Staff Toolbox** / **Community Toolbox** (see [PRD-01 → Future direction: making CRS bite](01-Community-Score.md)). Privilege-granting, never a download gate.

## Resolved decisions

- **Announce delivery shape (#136, 2026-06-13): notify-and-link-into-the-app.** The announce item carries a plain link into the app (the release page), not a one-shot tokenized URL — no new token-mint/expiry/replay surface. The download still resolves to a session-authed accounted grant; the link only saves a click.
