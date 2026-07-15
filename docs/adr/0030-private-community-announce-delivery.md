# ADR-0030: Access-gated announce delivery for private communities

**Status:** Proposed
**Date:** 2026-07-15
**Repos:** orphic-inc/stellar-api (membership + emit), obrien-k/korin-pink (channel ACL enforcement)
**Extends:** [ADR-0013 — korin.pink IRC integration](0013-korin-pink-irc-integration.md) (ownership split) · [ADR-0015 — verified IRC nick link](0015-verified-irc-nick-link.md) (§Scope names this as the deferred, unmodeled access-control feature)
**Serves:** [PRD-02 IRC & Announce](../prd/02-irc-and-announce.md)
**Origin:** #177. ADR-0015 retired the per-user `IRCKey`/`AnnounceKey` and mapped their four old jobs to replacements; three landed, and **private-community announce delivery** was explicitly deferred as "a separate, unmodeled access-control feature … tracked separately." This ADR models it.

---

## Context

Today the announce path is a single public firehose: `announceJob` pushes every new Contribution to korin `POST /irc/announce`, which renders it into `#announce`. The only community signal on the wire is the RSS `<category>` string; nothing gates delivery. A **private** community's releases should reach **only that community's members** over IRC, not the public channel.

This is greenfield on both sides, and that is the whole reason it is design-first:

- **stellar** has no privacy concept on `Community`. The model carries `registrationStatus` (`open`/`invite`/`closed`), `leaderId`, a `staff[]` relation, a `Consumer[]` membership relation, and `Contributor` — but no visibility flag, and `registrationStatus` gates _joining_, not _visibility_.
- **korin** models no channel ACL in its API. Ergo/ChanServ can enforce per-channel membership/op at the ircd layer, but korin exposes no endpoint to gate an announcement to a private channel's members. Nick ownership is proven (ADR-0015), which is the identity substrate an ACL would stand on, but the ACL itself does not exist.

So four things must be decided before any code: the privacy model, the membership source of truth, the announce contract extension, and — the crux — **who enforces the channel ACL**.

### Hard constraint (frames every decision)

This gates the **visibility of an announcement**, never content access. It must **never authorize a download** (ADR-0015; Golden Rule 3): consumption stays a session-authed, ratio-accounted grant, and the announce item stays notify-and-link (#136) — a plain link into the app, resolved by the normal authed grant. The gated channel controls who _sees the line_, nothing more. Key-authenticated content access over IRC is permanently designed out and is not reintroduced here.

---

## Decision

### 1. Privacy model — a dedicated `Community.visibility`

Add `Community.visibility` (`PUBLIC` | `PRIVATE`, default `PUBLIC`). Do **not** overload `registrationStatus`: "invite-only registration" and "private/hidden" are orthogonal (a community can have open registration but private announce, or vice versa), and conflating them repeats the overloaded-field trap. Only `PRIVATE` communities route announces to a gated channel; `PUBLIC` keeps the current `#announce` behaviour unchanged.

### 2. Membership source of truth — the existing relations, resolved in stellar, single-sourced

Eligible viewers of a private community's announce = the **union of its existing role relations** — `Consumer[]` (the membership relation), `Contributor`, `staff[]`, and `leaderId` — intersected with **verified IRC links** (`ircNick`, ADR-0015). No new `CommunityMember` join table: introducing a parallel membership store is exactly the dual-source drift ADR-0010 warned against. A single stellar resolver computes the eligible verified-nick set on demand; stellar remains the sole authority for "who belongs."

### 3. Announce contract extension — an optional target, backward-compatible

Extend the `POST /irc/announce` body with an optional `target: { visibility, community, channel? }`. Omitted or `PUBLIC` ⇒ today's `#announce` path (no breaking change). `PRIVATE` ⇒ korin routes the rendered line to the community's gated channel instead of the firehose. The stellar side derives the target from the Contribution's community `visibility`.

### 4. ACL ownership — **stellar projects membership, korin enforces** (the crux)

Consistent with ADR-0013's non-overlapping ownership: **stellar owns "who may see community X" and korin owns the IRC substrate that enforces it.** stellar projects the eligible verified-nick set to korin (event-driven on membership/visibility change, mirroring the ADR-0016 `/ledger/sync` posture — push deltas, do not have korin cache a second copy it can drift from); korin translates that into Ergo/ChanServ channel membership (invite/op) and gates delivery. stellar never runs IRC ACLs; korin never becomes a second source of truth for membership. The projection is the seam, and keeping it delta-pushed from the single stellar authority is what prevents the ADR-0010 failure mode.

### 5. Permissions

Configuring a community's `visibility` rides the existing community-management authority — the community `leaderId`/`staff` for their own community, and site-staff via the existing data-driven `communities_manage` rank permission. No new permission key is expected; if one proves warranted it is a catalog addition (auto-surfaced in the UserRanks editor), decided at implementation time — not a new gating model.

---

## Rationale

- **Reuses ADR-0013's ownership split** rather than inventing a new one: membership authority stays in stellar (where the data lives), enforcement stays in korin (where the ircd lives).
- **No parallel membership store**, so no drift — the single most likely failure mode for this feature (ADR-0010).
- **Backward-compatible wire change** — public communities are untouched; only a `PRIVATE` community opts into gated routing.
- **The hard constraint is structural**, not a runtime check: because the announce is notify-and-link and consumption is independently session-authed, even a mis-gated channel leaks at most the _existence_ of a release, never access to it.

---

## Consequences — implementation issues (gated on acceptance)

Filed separately; none built in this pass (#177 is design-only):

1. **stellar:** `Community.visibility` field + migration (default `PUBLIC`).
2. **stellar:** membership resolver module (union of role relations ∩ verified nicks) + tests — the single source of truth.
3. **stellar:** announce contract extension (`target` on the push) + deriving it from community visibility, and the membership-projection emit (delta push to korin).
4. **korin (paired issue):** the channel-ACL receiver + Ergo/ChanServ enforcement (the gated channel, invite/op from the projected nick set).
5. **stellar-ui:** a `visibility` toggle (and any announce-channel affordance) in the community manager (`CommunityManager.tsx`), gated by `communities_manage`.
6. **permission confirmation:** verify `communities_manage` + leader/staff covers visibility config; add a key only if warranted.

Until accepted and implemented, all announces remain public (current behaviour), and #177 stays the tracker for this design.

---

## Cross-references

- **stellar-api:** ADR-0013 (ownership split, extended) · ADR-0015 (§Scope charter; verified-nick identity substrate) · ADR-0010 (dual-source-of-truth failure mode this avoids) · ADR-0016 (`/ledger/sync` delta-push posture mirrored by the membership projection) · PRD-02 (IRC & Announce) · #136 (notify-and-link).
- **korin.pink:** the IRC substrate (Ergo/ChanServ) that would enforce the channel ACL — the paired implementation issue.
