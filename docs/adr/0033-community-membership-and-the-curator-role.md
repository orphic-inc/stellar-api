# Community membership is the role union; community staff becomes Curator

**Status: Accepted (2026-07-24).** Narrows the invariant of [ADR-0021](0021-community-leader-role.md) (Accepted, amended accordingly) and adopts the Axis-1/Axis-2 vocabulary of [ADR-0030](0030-private-community-announce-delivery.md) §Decision 2. Follows [#419](https://github.com/orphic-inc/stellar-api/issues/419), which landed the access half of this model. Revises one line of [PRD-08](../prd/08-collages-and-cover-art.md). Implementation tracked in [#422](https://github.com/orphic-inc/stellar-api/issues/422); paired UI work in stellar-ui#216. See [Acceptance note](#acceptance-note-2026-07-24).

## Context

#419 fixed a community staff member being unable to read the community they administer, by replacing `consumer ∪ contributor` with a shared role union — `consumer ∪ contributor ∪ staff` — behind `hasCommunityAccess`. That landed the correct predicate for **access**. It left two things it did not touch, and reviewing them together shows they are one problem.

**The read surface still says membership is consumption.** `GET /api/communities/:id` returns `consumers[]` and `_count.consumers`, and stellar-ui renders exactly those as the community's member roster: `CommunityPage.tsx:159` labels `_count.consumers` as "Members … total", `:180-182` iterates `consumers` as the Members list, and `:183-184` tags a row with a `Staff` chip when that user also appears in `staff[]`. Community staff is therefore modelled in the UI as an _attribute of a consumer_, so a staff member holding no `Consumer` row is absent from the member roster entirely. The same bug #419 fixed for access is still live for display, one layer up.

**Three write paths synthesize a `Consumer` row to paper over it.** `POST /api/communities`, `PUT /api/communities/:id` and `seedDefaultCommunity` each upsert a `Consumer` for the leader, holding ADR-0021's invariant `leaderId ⟹ user ∈ staff ∧ user is a Consumer`. ADR-0021 records why: "so existing staff-gated checks keep working with zero 'is staff OR is leader' special-casing." That reason is discharged — the checks now consult the union directly. What remains is a row asserting that the leader consumes releases, which may simply be false. `Consumer` is not a membership marker: it is the consumption identity, carrying `releases`, `contributions` and the download accounting the grant path lazily creates on first download (`downloads.ts:172`). Writing one to express "belongs to this community" is a category error that happens to make the roster render.

**And two different things are called staff.** `Community.staff[]` is a per-community relation. `permissions['staff']` is a site-wide rank capability, used across wiki, collages, and release moderation (`releaseWorkbench/authority.ts:37`). They meet in the same code path — a community staffer can now open the release workbench in their community while the moderation bit inside it comes from the site rank. The collision has already cost design work: ADR-0030 needed a dedicated "Two axes, kept apart" paragraph whose only job is stopping the site permission from leaking into a per-community membership union, and the bug #419 fixed was an Axis-1 relation being mistaken for not-membership.

The surface area is small enough to fix cheaply and will not stay that way. `Community.staff[]` is read in exactly one runtime file (`routes/api/communities/communities.ts`) and grants exactly four things: add/remove a member, add/remove staff, appear in `staff[]`, and now read access. Everything else in the community domain is gated by site rank permissions — contributions by `contributions_manage`, DNC by `dnc_manage`, releases by `communities_manage`.

## Decision

### 1. Membership is the role union; `Consumer` is one role within it

A member of a community is any user holding a per-community role relation: `consumer ∪ contributor ∪ curator` (with `leaderId` a distinguished element of `curator`). This is already what `communityRoleUnion` computes for access; it becomes the definition of membership, full stop.

`Consumer` keeps its own meaning — the user who consumes releases — and stops standing in for membership. Staff-shaped members are members without consuming, the same way site staff are members of the site without being defined by their downloads.

### 2. `Community.staff` is renamed **Curator**

`Community.staff[]` → `Community.curators[]` (Prisma relation `CommunityCurators`), `staffIds` → `curatorIds` in the create/update bodies, and `POST|DELETE /api/communities/:id/staff` → `/:id/curators`. "Staff" is reserved site-wide for the Axis-2 rank capability.

Curator is chosen over the alternatives on what the role actually does. **Moderator** collides with `forums_moderate` and implies policing powers curators do not hold. **Support** understates a role that controls who belongs. **Steward** carries no collision but reads as jargon. **Curator** is the word PRD-08 already uses in prose for the people who tend a community's contents; the residual overlap with "collage curator" is a difference of noun scope, not of concept.

This is a relation rename, not a permission — so ADR-0001 still holds. Curator checks stay relation checks paired with an exactly-named rank permission, exactly as `communities.ts:184` already does; no `isCurator()` role helper enters the permission layer.

### 3. The leader's `Consumer` upsert is removed; ADR-0021's invariant narrows

The invariant becomes `leaderId ⟹ user ∈ curators`. The three upserts at `communities.ts:353`, `communities.ts:432` and `bootstrap.ts:591` are deleted, and the curator path deliberately does **not** gain one. A leader or curator who also consumes releases acquires a `Consumer` row the normal way, through the download grant path.

The union already survives this unchanged: the leader is still connected to `curators`, so the `leaderId` arm of `communityRoleUnion` stays defensively redundant rather than becoming load-bearing.

### 4. `GET /:id` exposes members as the union, with a role per member

The detail response gains a `members` view derived from the union, each entry carrying which relations the user holds, replacing the `consumers[]`-plus-`Staff`-chip idiom the UI reconstructs today. This is the change that makes Decision 3 safe to ship: without it, removing the leader's `Consumer` row would delete the leader from the rendered roster.

**Browse keeps its cheap counts and stops calling them members.** `_count` on the list endpoint stays relation counts (`consumers`, `contributors`, `releases`) because a true union count is a per-row query and the list returns 25 rows. The honest fix on a list surface is the label, not the query: browse reports consumers and contributors as what they are, and the true member set is a detail-view concept.

### 5. Removing a member who is a curator is refused, not silently downgraded

`DELETE /:id/members/:userId` operates on the `Consumer` link. When the target holds a curator or leader role, it fails with a 409 naming the blocking role rather than partially removing them or silently stripping the role. Removing a curator is `DELETE /:id/curators/:userId`, and the leader is reassigned through `PUT /:id`. No route removes a role as a side effect of removing a membership.

`POST /:id/members` is unchanged: it means "add an ordinary joined-to-consume member", which is the one place a `Consumer` link is the honest representation.

## Consequences

- The member roster and count become truthful for curators, which is the display half of the bug #419 fixed for access.
- A cross-repo contract change: `staff`/`staffIds` → `curators`/`curatorIds`, the route rename, and the new `members` view. Precedent is ADR-0021's own `ownerId` → `leaderId`, absorbed on a stellar-ui `api.ts` resync. Pre-alpha, so no backfill.
- One migration. Prisma renames an implicit M:N table by dropping and recreating it, which would discard existing curator rows; the generated migration is hand-edited to `ALTER TABLE … RENAME` so the flagship community keeps its curator. (Losing them would be survivable pre-alpha — `seedDefaultCommunity` is idempotent — but silently discarding a relation is not a thing to do by default.)
- `search.ts:186` can sort communities by consumer count. It keeps working and keeps meaning consumers; it is not a member sort.
- PRD-08's single "CommunityLeaders/CommunityStaff" line is revised to "CommunityLeader/Curator".
- ADR-0030's Decision 2 vocabulary is unaffected in substance — the Axis-1 relation it names simply has a name that no longer collides with the Axis-2 permission it is being kept apart from.

## Alternatives rejected

- **Add a `Consumer` upsert to the curator path** (make every curator a consumer). Symmetric with the leader path and would have fixed #419 at the source, but it doubles down on the category error: it asserts consumption to express belonging, and it corrupts the consumer count and any future consumption-derived signal with users who never downloaded anything.
- **Drop the leader upsert and leave the read surface alone.** Cheapest change, and wrong: the leader silently disappears from the rendered member roster, trading a modelling error for a visible regression.
- **Keep "staff" for both concepts and disambiguate in prose.** This is the status quo, and ADR-0030 already paid for it once in a paragraph written solely to stop the two from being confused.
- **Compute a true member count on the browse list.** Rejected on cost: a per-row union count across a 25-row page, for a number that is decoration on a list surface.

## Acceptance note (2026-07-24)

Accepted with no change to the decisions. The review looked for a blocker and found none: unlike ADR-0030, this ADR has no cross-repo prerequisite — it is stellar-api-only plus a contract resync, and stellar-ui#216 is blocked _on_ it rather than the reverse. Two things it did turn up, both handled rather than deferred:

- **ADR-0021's Status line did not carry the amendment.** Decision 3 narrows an invariant of an Accepted ADR, and while ADR-0021's Decision bullet already recorded the narrowing inline, a reader checking its status would not have seen it. ADR-0021 is now marked amended at the header, and its Merge seam paragraph — which instructs `seedDefaultCommunity` to seed the flagship community as staff **and** consumer — points here for the removal.
- **Ordering against ADR-0030's remaining slices is a real cost, not a blocker.** `communityRoleUnion` currently names its third arm `staff`; Decision 2 renames it `curators`. ADR-0030 slice 4 (announce `target` + membership reconcile) composes that same fragment, so whichever of the two lands second rewrites the other's touch points. The cost is small and symmetric — the shared fragment is exactly what bounds it — so the order is a scheduling call for #422 and #328, not a design one.

## Cross-references

- **stellar-api:** ADR-0021 (invariant narrowed by Decision 3) · ADR-0030 (Axis-1/Axis-2 split, the shared role union) · ADR-0001 (relation checks paired with named rank permissions — unchanged) · PRD-08 (terminology revised) · #419 (the access half, landed).
- **stellar-ui:** the Members panel in `CommunityPage.tsx` and the count in `CommunityRow.tsx` consume the renamed contract and the new `members` view.
