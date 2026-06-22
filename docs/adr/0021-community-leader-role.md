# CommunityLeader: a first-class, single-holder community leader pointer

**Status: Accepted.** Serves [PRD-08 collages & cover art](../prd/08-collages-and-cover-art.md) (the sole `CommunityLeader` mention); reuses the `communities_manage` gate from [ADR-0001 granular permission checks](0001-granular-permission-checks.md). Resolves #216. Ships the leader _model_; the Requests → new-community flow that will consume it is deferred (see below).

## Context

PRD-08 names `CommunityLeader`/`CommunityStaff` as the curators of a community, but "CommunityLeader" was never modeled — it appeared exactly once, in PRD-08 prose. The `Community` model had no owner/leader field. The only expression of ownership was a convention in `POST /api/communities`: the owner was connected to the `staff` `User[]` relation **and** upserted as a `Consumer`. That convention cannot distinguish the founding leader from any other staff member — there is no "this specific user leads this community" pointer.

This blocks the intended Requests interaction: a Request that creates/seeds a new community should, on fulfillment, make the requester that community's leader (`requester = CommunityLeader`). With no modeled leader, the relationship can't be represented or enforced on the staff+consumer convention alone.

The design was grilled before any schema. The crux: keep the change minimal and honest (solve the actual "no founder pointer" problem) without speculatively building a role system or coupling a structural migration to unpinned scoring.

## Decision

Add a **scalar, nullable leader pointer** to `Community`, leaving `staff` untouched:

```prisma
leaderId Int?
leader   User? @relation("CommunityLeader", fields: [leaderId], references: [id])
// + @@index([leaderId]); back-relation User.communitiesLed
```

Settled properties:

- **Scalar FK, single leader.** Not a typed-membership join model (`CommunityMember{role}`) and not a flagged-staff sidecar. There is no existing role-enum membership pattern (`staff` is a plain implicit M:N; `Consumer`/`Contributor` are satellites), so a scalar is the smallest change that solves the stated problem. Single leader; succession is reassignment. If leadership later becomes genuinely multi-holder or role-graded, scalar → join migrates without data loss.
- **Leader is a superset of staff.** The invariant `leaderId ⟹ user ∈ staff ∧ user is a Consumer` is enforced in every write path, so existing staff-gated checks keep working with zero "is staff OR is leader" special-casing. The pointer is purely _additional_.
- **Nullable, recoverable.** Disabling a user does **not** auto-null the pointer (users are soft-deleted, never hard-deleted — auto-nulling would lose provenance and a disabled user can be re-enabled). The FK is `ON DELETE SET NULL` only as a backstop for the rare hard delete.
- **Transfer = reassignment via `PUT /communities/:id`.** The update route accepts `leaderId`; setting it re-runs the superset invariant. Already `communities_manage`-gated — no new permission surface. When `staffIds` is also supplied (it _replaces_ the whole staff set), the new leader is folded back in to preserve the invariant.
- **Audited.** Every leader set/change emits `audit(..., 'community.leader.set', 'community', id, { leaderId, previousLeaderId? })`, so a future succession policy has history to read.
- **Naming: `ownerId` → `leaderId`.** The `POST /communities` body param is renamed. "Owner" was always a fiction with no backing field; there is one concept here and it gets one honest name. Pre-alpha + the gated OpenAPI contract means the rename rides along with stellar-ui's `api.ts` resync.

Write paths enforcing the invariant on trunk today: **`POST /communities`** and **`PUT /communities/:id`**.

## Explicitly deferred

- **The Requests → new-community flow is not built here, and #216's "blocks Requests" premise is currently unrepresentable.** A `Request` is a _release_ request inside an existing community: `communityId` is required and points to an existing community, `type` is a `ReleaseType` (no "Community" type), and it's filled by a `Contribution`. There is no new-community request type and no community-creation fulfillment path (the logic lives in `requestLifecycle.ts`, not the `requests.ts` that #216/CLAUDE.md name). The "requester becomes leader on fulfillment" hook is deferred to whenever that flow is actually designed (pairs with stellar-ui #100). This ADR ships the leader model that flow will later consume.
- **No leadership CRS dimension.** PRD-01/PRD-08 imply leaders carry curation weight, but a CRS dimension is a _scoring_ decision (registry entry + magnitude pinning, HITL) that must be grilled separately. `leaderId` is the substrate a future dimension reads; this is the pipe, not the water.
- **No succession _policy_.** Auto-promotion on leader disable, leader-initiated handoff with acceptance, etc. are out of scope. The audit trail is the foundation a later policy builds on.

## Merge seam

`seedDefaultCommunity()` does not exist on trunk — it arrives via the unmerged `feat/golden-rules-surfacing` branch (seeds the flagship community as staff+consumer). **When that branch merges, the seed must also set `leaderId = ownerUserId`** to make the SysOp the flagship community's leader and hold the invariant. This is the third write path named in #216; it is documented here rather than built because it isn't on trunk yet.

## Consequences

- Communities gain a representable, settable, transferable leader distinct from staff — closing #216's actual blocker.
- One small migration (nullable FK + index); no backfill (pre-alpha).
- The OpenAPI contract changes (`ownerId` → `leaderId`); stellar-ui absorbs it on its next `api.ts` resync.
- A clean substrate seam for the deferred leadership CRS dimension and succession policy.

## Alternatives rejected

- **Typed membership join model (`CommunityMember{userId, communityId, role}`)** — the right eventual shape if communities grow a real role system, but a speculative rewrite of how `staff` works everywhere. YAGNI; migrate later if needed.
- **Flagged staff (sidecar marker on a staff join)** — keeps the founder/staff ambiguity #216 set out to kill.
- **Keep `ownerId` distinct from `leaderId`** — reintroduces the same can't-tell-founder-from-staff ambiguity.
- **Build the leadership CRS dimension now** — couples a structural migration to an unpinned scoring decision; exactly how scoring gets decided by accident.
- **Build the new-community-request flow now** — a whole unbuilt feature, not a Phase 0 enabler.
