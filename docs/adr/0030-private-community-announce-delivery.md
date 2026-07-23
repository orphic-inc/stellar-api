# ADR-0030: Access-gated announce delivery for private communities

**Status:** Proposed
**Date:** 2026-07-15
**Revised:** 2026-07-23 — grill pass corrected the delivery-leg premise, replaced the withdrawn ADR-0016 delta precedent with a full-set reconcile, unified the membership predicate, and split routing from ACL projection. See [Revision note](#revision-note-2026-07-23).
**Repos:** orphic-inc/stellar-api (membership + emit), obrien-k/korin-pink (channel ACL enforcement)
**Extends:** [ADR-0013 — korin.pink IRC integration](0013-korin-pink-irc-integration.md) (ownership split) · [ADR-0015 — verified IRC nick link](0015-verified-irc-nick-link.md) (§Scope names this as the deferred, unmodeled access-control feature)
**Serves:** [PRD-02 IRC & Announce](../prd/02-irc-and-announce.md)
**Origin:** #177. ADR-0015 retired the per-user `IRCKey`/`AnnounceKey` and mapped their four old jobs to replacements; three landed, and **private-community announce delivery** was explicitly deferred as "a separate, unmodeled access-control feature … tracked separately." This ADR models it.

---

## Context

The announce path is meant to be a public firehose: `announceJob` pushes every new Contribution to korin `POST /irc/announce`, and korin renders it for `#announce`. The only community signal on the wire is the RSS `<category>` string; nothing gates delivery. A **private** community's releases should reach **only that community's members** over IRC, not the public channel.

**A correction the original draft got wrong.** The draft assumed the public firehose already delivers to IRC and this feature merely _gates_ it. It does not. Tracing the path end-to-end: stellar's `publishAnnounceItem` POSTs the RSS, checks `res.ok`, and **discards the response body**; korin's `/irc/announce` parses the feed, renders one line, and **returns it to the caller** (`{ success, mode, artifact }`); nothing posts that line to any channel (the irc-bridge's only `client.say` calls are `!verify` replies and NickServ registration). The last mile — korin actually posting a rendered line into a channel — was never built, for the public case either. So this ADR is not "add a gate to working delivery"; the public delivery leg is a **prerequisite** that must land first (Decision 0).

This is greenfield on both sides, and that is the whole reason it is design-first:

- **stellar** has no privacy concept on `Community`. The model carries `registrationStatus` (`open`/`invite`/`closed`), `leaderId`, a `staff[]` relation, a `Consumer[]` membership relation, and `Contributor` — but no visibility flag, and `registrationStatus` gates _joining_, not _visibility_.
- **korin** models no channel ACL in its API, and does not yet deliver announces to any channel at all. Ergo/ChanServ can enforce per-channel membership/op at the ircd layer, but korin exposes no endpoint to gate an announcement to a private channel's members. Nick ownership is proven (ADR-0015), which is the identity substrate an ACL would stand on, but the delivery leg and the ACL itself do not exist.

So one prerequisite must be built and four things decided before the gated path: the privacy model, the membership source of truth, the announce contract extension, and — the crux — **who enforces the channel ACL**.

### Hard constraint (frames every decision)

This gates the **visibility of an announcement**, never content access. It must **never authorize a download** (ADR-0015; Golden Rule 3): consumption stays a session-authed, ratio-accounted grant, and the announce item stays notify-and-link (#136) — a plain link into the app, resolved by the normal authed grant. The gated channel controls who _sees the line_, nothing more. Key-authenticated content access over IRC is permanently designed out and is not reintroduced here.

---

## Decision

### 0. Prerequisite — build the public delivery leg first

Before any private gating, korin must actually deliver a rendered announce line into a channel — the public `#announce` case. This is a named blocker on the implementation epic, not part of the gating work: private routing is meaningless until _some_ channel delivery exists to route. The gated path (Decisions 3–4) is a routing choice layered on top of a working deliver-to-channel primitive; that primitive is built once, for `#announce`, and reused.

### 1. Privacy model — a dedicated `Community.visibility`

Add `Community.visibility` (`PUBLIC` | `PRIVATE`, default `PUBLIC`). Do **not** overload `registrationStatus`: "invite-only registration" and "private/hidden" are orthogonal (a community can have open registration but private announce, or vice versa), and conflating them repeats the overloaded-field trap. Only `PRIVATE` communities route announces to a gated channel; `PUBLIC` keeps the current `#announce` behaviour unchanged.

### 2. Membership source of truth — the existing relations, resolved in stellar, single predicate

Eligible viewers of a private community's announce = the **union of its existing role relations** — `Consumer[]` (the membership relation), `Contributor`, `staff[]`, and `leaderId` — intersected with **verified IRC links** (`ircNick`, ADR-0015). No new `CommunityMember` join table: introducing a parallel membership store is exactly the dual-source drift ADR-0010 warned against.

The union is strictly broader than the app's _current_ notion of "member of community X," which is consumers-only (the browse/list filter). A community staffer added via `POST /:id/staff` gets a `staff` connection but no `Consumer` row, so the two sets genuinely diverge. To avoid shipping a _second definition_ of membership — the same dual-source drift ADR-0010 warns against, just in code instead of a table — the union is defined **once** as a single exported predicate (a shared `isMember` where-fragment / `resolveCommunityMembers`), and the existing consumers-only browse filter is refactored to consume it. One definition, two call-sites. (Consequence: "my communities" browse widens to include staff/contributor-only members; owned in the implementation issue.)

### 3. Announce contract extension — an optional routing target, backward-compatible

Extend the `POST /irc/announce` body with an optional `target: { visibility, community, channel? }`. Omitted or `PUBLIC` ⇒ today's `#announce` path (no breaking change). `PRIVATE` ⇒ korin routes the rendered line to the community's gated channel instead of the firehose. The stellar side derives the target from the Contribution's community `visibility`. The channel is **korin-derived from the community id** (`#c-<id>`) — stable across community renames; `channel?` stays in the wire contract as a forward-compat slot for a future admin-bound channel, sent empty for now (no new stellar field beyond `visibility`).

`target` is **routing only**. It does not carry the member set — membership projection is a separate payload and endpoint (Decision 4), because the periodic reconcile has no announce to ride on.

### 4. ACL ownership — **stellar projects the full member set, korin enforces** (the crux)

Consistent with ADR-0013's non-overlapping ownership: **stellar owns "who may see community X" and korin owns the IRC substrate that enforces it.** stellar projects the **complete eligible verified-nick set** for a private community to korin via a dedicated `POST /irc/membership` (`{ community, nicks[] }`); korin translates it into Ergo/ChanServ channel membership (invite/op) and gates delivery, treating its channel ACL as a **disposable materialized view it overwrites** on each projection. stellar never runs IRC ACLs; korin never becomes a second source of truth — its copy is replaced, never diffed, and is reconstructed from stellar after any korin restart.

**Full-set reconcile, not deltas.** The projection is a full-set replace, driven by (i) a periodic reconcile job iterating `PRIVATE` communities (reuse `KORIN_POLL_INTERVAL_MS`) and (ii) a sync piggybacked on each private announce push. This deliberately **replaces** the delta-push posture the original draft borrowed from ADR-0016 `/ledger/sync`: that ADR is **Superseded and withdrawn** (2026-07-18), and even as-written it was never delta-only — deltas were paired with a full-snapshot reseed korin pulled on boot. A full-set reconcile is the honest form of "korin is never authoritative": there is no per-seam delta instrumentation to miss (membership here is _derived_ from ~8 scattered mutation points — member/staff/contributor add-remove, leader change, nick verify/re-verify/unverify, disable/ban, visibility flip — with no single choke-point), and it self-heals across korin restarts. The visibility-only hard constraint makes the small staleness window of a periodic reconcile costless: at worst a just-added member misses one announce line until the next tick, and even a mis-gated channel leaks only the _existence_ of a release, never access.

### 5. Permissions

Configuring a community's `visibility` rides the existing community-management authority — the community `leaderId`/`staff` for their own community, and site-staff via the existing data-driven `communities_manage` rank permission. The existing member/staff routes already gate on `communities_manage || admin || community-staff`, and a `visibility` toggle rides the same gate. No new permission key is expected; if one proves warranted it is a catalog addition (auto-surfaced in the UserRanks editor), decided at implementation time — not a new gating model.

---

## Rationale

- **Reuses ADR-0013's ownership split** rather than inventing a new one: membership authority stays in stellar (where the data lives), enforcement stays in korin (where the ircd lives).
- **No parallel membership store and no second definition** — one predicate, so no drift, the single most likely failure mode for this feature (ADR-0010).
- **Full-set reconcile over deltas** — no fragile per-seam instrumentation of a derived quantity, self-healing across restarts, and it stops leaning on a withdrawn precedent (ADR-0016).
- **Backward-compatible wire change** — public communities are untouched; only a `PRIVATE` community opts into gated routing.
- **Narrow reach is acceptable** — only nick-verified members populate `#c-<id>`, realistically a minority; in-app notify-and-link stays universal. The feature's job is preventing private releases from leaking into the _public_ channel, and that holds at any IRC-adoption level.
- **The hard constraint is structural**, not a runtime check: because the announce is notify-and-link and consumption is independently session-authed, even a mis-gated channel leaks at most the _existence_ of a release, never access to it.

---

## Consequences — implementation issues (gated on acceptance)

Filed separately; none built in this pass (#177 is design-only). Ordered by dependency:

1. **korin (prerequisite):** the public delivery leg — korin actually posts a rendered announce line into `#announce`. Blocks everything below; private routing has nothing to layer on until it exists (Decision 0).
2. **stellar:** `Community.visibility` field + migration (default `PUBLIC`). Independent, forward-safe.
3. **stellar:** the single membership predicate (union of role relations ∩ verified nicks) + refactor the consumers-only browse filter onto it + tests — one definition, two call-sites.
4. **stellar:** announce contract `target` (routing) derived from community visibility, plus the `POST /irc/membership` projection emit (full nick set) and the periodic reconcile job.
5. **korin (paired issue):** the `#c-<id>` channel-ACL receiver + Ergo/ChanServ enforcement (invite/op from the projected nick set, materialized-view overwrite each projection).
6. **stellar-ui:** a `visibility` toggle in the community manager (`CommunityManager.tsx`), gated by `communities_manage`.
7. **permission confirmation:** verify `communities_manage` + leader/staff covers visibility config; add a key only if warranted.

Until accepted and implemented, all announces remain public (current behaviour), and #177 stays the tracker for this design.

---

## Revision note (2026-07-23)

A grill pass against the code found the design resting on a false premise and a withdrawn precedent, and amended it:

- **Delivery leg is a prerequisite, not a given.** No code posts announce lines to any channel today; korin renders and returns, stellar discards. Added as Decision 0 / Consequence 1 and corrected in Context.
- **Full-set reconcile replaces delta-push.** ADR-0016 `/ledger/sync` — the cited precedent — is Superseded/withdrawn (2026-07-18) and was never delta-only. Decision 4 now projects the complete member set to a disposable korin materialized view via `POST /irc/membership`, on a periodic reconcile plus per-announce piggyback.
- **One membership predicate.** The eligibility union diverges from the app's consumers-only browse filter; both now consume a single exported predicate (Decision 2).
- **Routing split from ACL.** `target` on `/irc/announce` is routing only; the member set travels on its own endpoint (Decisions 3–4).
- **Channel identity fixed.** `PRIVATE` → korin-derived `#c-<id>`; `channel?` is an unused forward-compat slot; no new stellar field (Decision 3).
- **Narrow reach accepted; permissions confirmed** against the existing member/staff route gating (Rationale, Decision 5).

---

## Cross-references

- **stellar-api:** ADR-0013 (ownership split, extended) · ADR-0015 (§Scope charter; verified-nick identity substrate) · ADR-0010 (dual-source-of-truth failure mode this avoids) · ADR-0016 (Superseded/withdrawn — the delta-push posture originally mirrored here; replaced by full-set reconcile) · PRD-02 (IRC & Announce) · #136 (notify-and-link).
- **korin.pink:** the IRC substrate (Ergo/ChanServ) that would enforce the channel ACL, and the public delivery leg (Decision 0) — the paired implementation issue.
