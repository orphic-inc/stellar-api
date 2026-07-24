# ADR-0030: Access-gated announce delivery for private communities

**Status:** Accepted
**Date:** 2026-07-15
**Revised:** 2026-07-23 — grill pass corrected the delivery-leg premise, replaced the withdrawn ADR-0016 delta precedent with a full-set reconcile, unified the membership predicate, and split routing from ACL projection. See [Revision note](#revision-note-2026-07-23).
**Revised:** 2026-07-24 — accepted after a second grill pass: delivery-leg prerequisite (korin-pink#70) landed, so Decision 0 is satisfied; the "single predicate" is narrowed to a single **role-union fragment** composed per call-site; site staff is stated out of the eligibility union; the `POST /irc/membership` wire contract is pinned; and the piggyback projection is best-effort (never gates the announce cursor). See [Revision note](#revision-note-2026-07-24).
**Revised:** 2026-07-25 — third grill pass: the role union has **four** call-sites, not two (two of them authorization gates), so the shared unit moves to a new `communityAccess.ts` module and `isCommunityMember` is renamed `hasCommunityAccess`; the field is renamed `announceVisibility` and stated never to gate access; Consequence 3 is extracted to #419 and lands ahead of the epic. See [Revision note](#revision-note-2026-07-25).
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

### 0. Prerequisite — build the public delivery leg first — **landed (korin-pink#70)**

Before any private gating, korin must actually deliver a rendered announce line into a channel — the public `#announce` case. This is a named blocker on the implementation epic, not part of the gating work: private routing is meaningless until _some_ channel delivery exists to route. The gated path (Decisions 3–4) is a routing choice layered on top of a working deliver-to-channel primitive; that primitive is built once, for `#announce`, and reused.

**Status: satisfied.** korin-pink#70 built the deliver-to-channel primitive — an `api → bridge` `POST /say { channel, message }`, an IRC-plain renderer beside `renderMinimalIrc`, connected-state tracking, and channel validation against the bridge's joined set (korin ADR-006). It was built so **stellar requires no change** for the public leg (`renderMinimalIrc` and the `/irc/announce` response shape untouched); durability rides stellar's existing at-least-once `runAnnounceCycle` cursor, and korin returns 503 (never a buffering 202) on failure. The private `#c-<id>` routing (Decisions 3–4) reuses this exact primitive.

### 1. Privacy model — a dedicated `Community.announceVisibility`

Add `Community.announceVisibility` (`PUBLIC` | `PRIVATE`, default `PUBLIC`). Do **not** overload `registrationStatus`: "invite-only registration" and "private/hidden" are orthogonal (a community can have open registration but private announce, or vice versa), and conflating them repeats the overloaded-field trap. Only `PRIVATE` communities route announces to a gated channel; `PUBLIC` keeps the current `#announce` behaviour unchanged.

**The field gates announce routing and nothing else — it must never enter an access check.** It is named `announceVisibility`, not `visibility`, for that reason: a column named `visibility` sitting beside a predicate named `hasCommunityAccess` (Decision 2) invites exactly the wiring that would convert a routing flag into an authorization gate, violating the hard constraint above (ADR-0015, Golden Rule 3). Access stays governed by `registrationStatus` + the role union; a `PRIVATE` community with `registrationStatus: open` remains readable by anyone. The seam in `communityAccess.ts` carries a comment stating the omission, and a test asserts the `PRIVATE` + `open` case stays public. Only the stellar column is renamed — the pinned wire contract keeps its `target: { visibility, … }` field name (Decision 3).

### 2. Membership source of truth — the existing relations, resolved in stellar, one shared role-union fragment

Eligible viewers of a private community's announce = the **union of its existing per-community role relations** — `Consumer[]` (the membership relation), `Contributor`, and `staff[]` — intersected with **verified IRC links** (`ircNick`, ADR-0015). No new `CommunityMember` join table: introducing a parallel membership store is exactly the dual-source drift ADR-0010 warned against.

**Two axes, kept apart.** Membership is an _Axis-1_ property — the per-community relations on the `Community` model. It is **not** the _Axis-2_ global capability: a site staffer (the `communities_manage` / `admin` rank permission) is not a "member" of every private community and does **not** enter the eligibility union. Site staff appears only as the permission gate on the visibility-toggle route (Decision 5); it never populates a `#c-<id>` channel. `leaderId` is a distinguished element of `staff[]`, not a separate set — ADR-0021 always folds the leader into `staff[]` (and upserts a `Consumer`), so the honest union is `consumer ∪ contributor ∪ community-staff`; `leaderId` is kept only as a **defensive, redundant** arm guarding against an ADR-0021 invariant violation, not as load-bearing membership.

**One role-union fragment, composed per call-site — not one predicate.** The eligibility set and the browse/list filter genuinely diverge, and forcing a single `where` object through both reintroduces a bug: the browse filter shows _every open-registration community to everyone_ (`registrationStatus.open`) and must not require a verified nick, while eligibility must exclude the `open` arm and _must_ intersect verified nicks. So the shared unit is only the **role-union where-fragment** (`consumer ∪ contributor ∪ community-staff`), exported once, with each call-site composing its own outer terms:

- browse (`GET /communities`): `OR: [ registrationStatus.open, roleUnion ]`
- the access gate (`hasCommunityAccess`): `open || roleUnion`
- announce eligibility: `AND: [ roleUnion, verifiedNick, announceVisibility PRIVATE ]`

**Four call-sites, not two.** A third grill pass (2026-07-25) found the union expressed in four places, not the two an earlier draft named — and two of them are **authorization gates**, not browse filters: `isCommunityMember` (`communities.ts:54`), serving `GET /:id`, `GET /:id/health`, `GET /:id/health/history` and `releaseBrowse.ts:25`, plus a byte-identical private duplicate at `releaseWorkbench/authority.ts:18` gating release edits. The shared fragment and the gate move to a new **`src/modules/communityAccess.ts`** (which later also holds this ADR's `communityAnnounceNicks`), and the duplicate folds into it — incidentally clearing `releaseBrowse.ts:5`, the only module→route import in `src/modules/`.

`isCommunityMember` is **renamed `hasCommunityAccess`** in the same move. ADR-0001 is not violated by the `staff` arm — that ADR governs the rank-permission map (Axis-2), while `Community.staff[]` is an Axis-1 relation, and `communities.ts` already pairs relation checks with exactly-named rank permissions in four places. But ADR-0001's deeper complaint does apply: one collapsed predicate standing in for several distinct authorizations. The four sites ask different questions — read a community, read its health, list its releases, **edit a release in it** — so widening a predicate named "member" would grant all four silently, the last being a write gate. The rename makes the widening legible at each site.

The existing browse filter is **not** consumers-only as an earlier draft stated — it already ORs `registrationStatus.open`, `consumers.some`, and `contributors.some` (`communities.ts`). Refactoring it to consume `roleUnion` adds the `staff` arm. (Consequence: "my communities" browse widens so a community's **staff-only** members — added via `POST /:id/staff` with no `Consumer` row — start seeing the communities they staff; this reads as a latent-bug fix, not a regression, and is flagged to stellar-ui as an intended behaviour change. The gate half of the same bug is sharper: such a member can administer a community's roster today but gets a 403 reading it. Owned in #419.)

### 3. Announce contract extension — an optional routing target, backward-compatible

Extend the `POST /irc/announce` body with an optional `target: { visibility, community, channel? }`. Omitted or `PUBLIC` ⇒ today's `#announce` path (no breaking change). `PRIVATE` ⇒ korin routes the rendered line to the community's gated channel instead of the firehose. The stellar side derives the target from the Contribution's community `announceVisibility` (Decision 1) — note the wire field stays `visibility`; only the column is renamed. The channel is **korin-derived from the community id** (`#c-<id>`) — stable across community renames; `channel?` stays in the wire contract as a forward-compat slot for a future admin-bound channel, sent empty for now (no new stellar field beyond `announceVisibility`).

`target` is **routing only**. It does not carry the member set — membership projection is a separate payload and endpoint (Decision 4), because the periodic reconcile has no announce to ride on.

### 4. ACL ownership — **stellar projects the full member set, korin enforces** (the crux)

Consistent with ADR-0013's non-overlapping ownership: **stellar owns "who may see community X" and korin owns the IRC substrate that enforces it.** stellar projects the **complete eligible verified-nick set** for a private community to korin via a dedicated `POST /irc/membership` (`{ community, nicks[] }`); korin translates it into Ergo/ChanServ channel membership (invite/op) and gates delivery, treating its channel ACL as a **disposable materialized view it overwrites** on each projection. stellar never runs IRC ACLs; korin never becomes a second source of truth — its copy is replaced, never diffed, and is reconstructed from stellar after any korin restart.

**Full-set reconcile, not deltas.** The projection is a full-set replace, driven by (i) a periodic reconcile job iterating `PRIVATE` communities (reuse `KORIN_POLL_INTERVAL_MS`) and (ii) a sync piggybacked on each private announce push. This deliberately **replaces** the delta-push posture the original draft borrowed from ADR-0016 `/ledger/sync`: that ADR is **Superseded and withdrawn** (2026-07-18), and even as-written it was never delta-only — deltas were paired with a full-snapshot reseed korin pulled on boot. A full-set reconcile is the honest form of "korin is never authoritative": there is no per-seam delta instrumentation to miss (membership here is _derived_ from ~8 scattered mutation points — member/staff/contributor add-remove, leader change, nick verify/re-verify/unverify, disable/ban, visibility flip — with no single choke-point), and it self-heals across korin restarts. The visibility-only hard constraint makes the small staleness window of a periodic reconcile costless: at worst a just-added member misses one announce line until the next tick, and even a mis-gated channel leaks only the _existence_ of a release, never access.

**No eager per-seam projection; removals ride the tick.** None of the ~8 mutation points (including a `PUBLIC→PRIVATE` flip and a ban/unverify) triggers an eager projection — that is exactly the fragile per-seam instrumentation the full-set posture exists to avoid. A removed member keeps channel membership for at most one `KORIN_POLL_INTERVAL_MS` tick; because the constraint is visibility-only, the worst case is a just-removed member seeing _the existence_ of one release for ≤ one tick, never access. The periodic tick plus the pre-announce piggyback already cover the flip case (no private line can route to a channel before the piggyback that precedes it freshens the ACL).

**Piggyback ordering is best-effort, never a gate.** On a private announce in `runAnnounceCycle`, the membership projection is _attempted before_ the line is routed, so the first announce after a membership change lands in a fresh `#c-<id>`. But projection and delivery are independent failure domains sharing one ordered cursor: if the `POST /irc/membership` fails, the announce **still goes out** (logged, not held). Gating the announce on projection success would let a single membership-endpoint outage wedge the entire ordered announce firehose — public included — and it contradicts the visibility-only tolerance that already makes a stale ACL costless; the next periodic tick self-heals the ACL, and korin-pink#70 already accepts a duplicate line.

**The `POST /irc/membership` wire contract (pinned).**

```
POST /irc/membership
Header: x-pull-key: <KORIN_PULL_KEY>     # same outbound stellar→korin credential publishAnnounceItem already sends
Body:   { "community": <numeric Community.id>, "nicks": [<verified ircNick>, ...] }
```

- **Identifier** is the numeric `Community.id`; korin derives `#c-<id>` from it (stable across renames) — never a name/slug.
- **`nicks`** is the _full_ eligible verified-nick set every projection; korin overwrites its channel ACL from it (materialized view, never diffed).
- **Empty set** (`nicks: []`) is projected verbatim — korin overwrites the ACL to empty; in-app notify-and-link is unaffected. No special-casing a memberless private community.
- **Failure posture** differs from announce: a full-set reconcile is idempotent, so on a non-2xx stellar does **not** hold a cursor — it logs and lets the next periodic tick re-project. stellar ignores the response body (mirroring how it discards the `/irc/announce` response); an applied-count echo is a korin-side observability nice-to-have, not required.

### 5. Permissions

Configuring a community's `announceVisibility` rides the existing community-management authority — the community `leaderId`/`staff` for their own community, and site-staff via the existing data-driven `communities_manage` rank permission. The existing member/staff routes already gate on `communities_manage || admin || community-staff`, and an `announceVisibility` toggle rides the same gate. No new permission key is expected; if one proves warranted it is a catalog addition (auto-surfaced in the UserRanks editor), decided at implementation time — not a new gating model.

---

## Rationale

- **Reuses ADR-0013's ownership split** rather than inventing a new one: membership authority stays in stellar (where the data lives), enforcement stays in korin (where the ircd lives).
- **No parallel membership store and no second definition** — one shared role-union fragment composed per call-site, so no drift, the single most likely failure mode for this feature (ADR-0010).
- **Full-set reconcile over deltas** — no fragile per-seam instrumentation of a derived quantity, self-healing across restarts, and it stops leaning on a withdrawn precedent (ADR-0016).
- **Backward-compatible wire change** — public communities are untouched; only a `PRIVATE` community opts into gated routing.
- **Narrow reach is acceptable** — only nick-verified members populate `#c-<id>`, realistically a minority; in-app notify-and-link stays universal. The feature's job is preventing private releases from leaking into the _public_ channel, and that holds at any IRC-adoption level.
- **The hard constraint is structural**, not a runtime check: because the announce is notify-and-link and consumption is independently session-authed, even a mis-gated channel leaks at most the _existence_ of a release, never access to it.

---

## Consequences — implementation issues (gated on acceptance)

Filed separately; none built in this pass (#177 is design-only). Ordered by dependency:

1. **korin (prerequisite) — DONE (korin-pink#70):** the public delivery leg — korin posts a rendered announce line into `#announce`. Was the blocker on everything below; now satisfied (Decision 0).
2. **stellar:** `Community.announceVisibility` field + migration (default `PUBLIC`). Independent, forward-safe.
3. **stellar — extracted to #419, lands ahead of the epic:** the shared role-union fragment (`consumer ∪ contributor ∪ community-staff`, `leaderId` defensive-redundant) in a new `communityAccess.ts`, the `isCommunityMember` → `hasCommunityAccess` rename, the `releaseWorkbench/authority.ts` duplicate folded in, and the browse filter refactored to compose the fragment (`OR: [ open, roleUnion ]`) + tests. Owns both halves of the widening — browse (staff-only members appear) and the gate (staff-only members stop 403ing). No schema change and no korin dependency, which is why it ships standalone.
4. **stellar:** announce contract `target` (routing) derived from community visibility, plus the `POST /irc/membership` projection emit (full nick set) and the periodic reconcile job.
5. **korin (paired issue):** the `#c-<id>` channel-ACL receiver + Ergo/ChanServ enforcement (invite/op from the projected nick set, materialized-view overwrite each projection).
6. **stellar-ui:** an `announceVisibility` toggle in the community manager (`CommunityManager.tsx`), gated by `communities_manage`.
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

## Revision note (2026-07-24)

A second grill pass against the code accepted the ADR and tightened four things:

- **Prerequisite landed → accepted.** korin-pink#70 shipped the deliver-to-channel primitive (built so stellar needs no change for the public leg). Decision 0 is satisfied; Status flips Proposed → Accepted.
- **"Single predicate" → one role-union _fragment_, composed per call-site.** The prior wording oversold a shared `where`. The two call-sites genuinely diverge — browse ORs `registrationStatus.open` and needs no verified nick; eligibility excludes `open` and intersects verified nicks — so only the role-union fragment (`consumer ∪ contributor ∪ community-staff`) is shared; each side composes its own outer terms. Corrected the "consumers-only browse filter" claim (the real filter already ORs open + consumers + contributors).
- **Two axes stated explicitly.** Membership is Axis-1 (per-community relations); site staff (`communities_manage`/`admin`) is Axis-2 (a config permission) and is **out of the eligibility union** — it never populates `#c-<id>`. `leaderId` is defensive-redundant (leader ⊆ staff per ADR-0021).
- **`POST /irc/membership` contract pinned** (numeric `Community.id`, full verified-nick set, `x-pull-key` auth, idempotent no-cursor-hold, empty set verbatim), and the piggyback projection made **best-effort** — attempted before routing but never gating the shared announce cursor.

---

## Revision note (2026-07-25)

A third grill pass tested one question — does the role-union fragment's `staff` arm apply only to the browse filter, or also to the authorization gate — and amended four things:

- **Four call-sites, not two, and two of them are authorization gates.** Beyond the browse `where` fragment, the union is expressed as `isCommunityMember` (serving community detail, health, health history, and `releaseBrowse`) plus a byte-identical private duplicate in `releaseWorkbench/authority.ts` gating release edits. The staff arm applies to all of them: a staff-only member (added via `POST /:id/staff`, which never upserts a `Consumer` — unlike the leader path, which holds ADR-0021's invariant) can administer a community's roster today but gets a 403 reading the community, its health, its releases, or editing a release in it.
- **`isCommunityMember` → `hasCommunityAccess`, in a new `communityAccess.ts`.** ADR-0001 is not violated by the staff arm (that ADR governs the Axis-2 rank-permission map; `staff[]` is an Axis-1 relation, and the codebase already pairs the two correctly), but its deeper complaint — one collapsed predicate standing in for several distinct authorizations — is real, so the rename ships with the widening rather than after it. The move also clears the only module→route import in `src/modules/`.
- **`visibility` → `announceVisibility`, and stated never to gate access.** Named for what it gates, so the routing flag cannot be mistaken for an authorization input; defended by a comment at the seam and a test asserting a `PRIVATE` + `open`-registration community stays readable by a non-member. The pinned wire contract is unchanged.
- **Consequence 3 extracted to #419**, landing ahead of the epic — no schema change, no korin dependency — with a paired stellar-ui heads-up (stellar-ui#215) on the browse-widening.

---

## Cross-references

- **stellar-api:** ADR-0013 (ownership split, extended) · ADR-0015 (§Scope charter; verified-nick identity substrate) · ADR-0010 (dual-source-of-truth failure mode this avoids) · ADR-0016 (Superseded/withdrawn — the delta-push posture originally mirrored here; replaced by full-set reconcile) · PRD-02 (IRC & Announce) · #136 (notify-and-link).
- **korin.pink:** the IRC substrate (Ergo/ChanServ) that would enforce the channel ACL, and the public delivery leg (Decision 0) — the paired implementation issue.
