# Contribution is a composable package; content identity is a shallow ReleaseGroup; community attribution stays on the Release

**Status: Accepted (2026-09-09).** Accepted as the gate on [#265](https://github.com/orphic-inc/stellar-api/issues/265), whose implementation follows this contract rather than preceding it. The v1 sub-decision left open below is **resolved** — see Decision 2 and Consequences. Builds on [ADR-0008 contribution-metadata-satellites](0008-contribution-metadata-satellites.md) (the type-agnostic Contribution Spine), [ADR-0017 CommunityScore](0017-communityscore-crs-dimension.md), [ADR-0019 lifetime link-health](0019-lifetime-link-health-crs-dimension.md), and [ADR-0002 community-health-pulse](0002-community-health-pulse.md). Surfaced by the stellar-ui Collages work (cross-community "same album" resolution) and the long-term packaged-Contribution vision.

## Context

Two pressures meet at the same seam.

**1. The Collages seam.** A `Release` is community-scoped (`Release.communityId`), addressable only under `/communities/:id/releases/:id`; a `Collage` is global, and a `CollageEntry` is keyed `@@unique([collageId, releaseId])`. So "the same album" curated in two communities is two unrelated `Release` rows, and a collage cannot dedup them — it points at one community's row, or shows both as separate entries. There is no album-level identity above `Release`.

**2. The packaged-Contribution vision.** The `Contribution` Spine (ADR-0008) is already the type-agnostic published unit — "a Release is the primary Contribution type." Today it is **1:1** with its content (one release/edition) — a degenerate one-item package using the release as its container. The long-term intent is a Contribution **composed of multiple** content items, possibly cross-type: an indie bundle (music video + DVD + album), or a game published itch.io-style. **No v2 packaging is built now**; the question this ADR settles is what must be true _now_ so v2 is not a painful retrofit.

**The constraint that disciplines both: Releases are private to their Community.** A `Release` belongs to a Community, and a user with no access to that Community cannot see its Releases at all. This is an access-control invariant, not a convenience — it forecloses the tempting "globalize the content so collages can dedup it" move. Content cannot leave its Community. Whatever album-level identity we add has to bridge community-private rows **without** exposing one community's catalogue to outsiders.

**The attribution invariant.** Every community-scoped mechanic derives community via `Contribution → release.communityId → community`:

- **CommunityScore** (ADR-0017/#76) — quality-graded contribution count _per community_; `reputation.ts` skips a contribution whose `release.communityId` is null.
- **Community health pulse** (ADR-0002) — `linkHealth.ts` queries `where: { release: { communityId } }`.
- **Lifetime link-health** (ADR-0019), **contribution moderation** (community-nested routes + `communities_manage`), and the planned per-community **DNC** blocklist ride the same chain.

Because content stays community-scoped, this invariant is _not_ under threat — it is something to **preserve**, not repoint. The expensive-to-reverse decision is narrower than it first appeared: how to add cross-community identity **without** globalizing content and **without** leaking private catalogues through that identity.

## Decision

1. **ReleaseGroup — a shallow, global identity node.** Introduce a content-catalogue identity that groups Releases that are "the same album/work," independent of any community. It carries _identity only_ — canonical title/artist/year and the set of member Release IDs — **never** Editions, Contributions, files, or any catalogue content. Content stays on the community-scoped `Release`. Collages and search resolve "the same thing" on the ReleaseGroup; they then render the _Releases_ the viewer can actually access. (The legacy tracker's "group"; MusicBrainz's "release group." **Not** "Work" — that is the composition, a different concept.)

2. **Resolution is access-filtered; ReleaseGroup never widens visibility.** A ReleaseGroup edge is a dedup hint, not a grant. When a collage or search result resolves to a ReleaseGroup, the member Releases are filtered to those the viewer may see; a viewer never learns that community B also catalogues this album unless they already have access to B. A ReleaseGroup with no viewer-visible Releases is **omitted, not shown as a placeholder** — the stricter of the two leak-safe postures, and it applies in both places the question arises: a direct read of the group answers **404**, and a collage **drops the entry** rather than rendering identity-only. Those are two surfaces, so both are stated; answering only one is what left this open through two sessions. Once resolution yields the viewer-visible Releases, each Release's editions and rip-quality render via the release-scoped contributions read (#129 / the UI `EditionStack`): ReleaseGroup supplies the cross-community _identity_, that read supplies the per-Release _edition/quality_ — the two halves the legacy album loader fused into one call.

3. **Community attribution stays on the Release — unchanged.** `CommunityScore`, the community health pulse, contribution moderation, and the planned DNC keep reading `Contribution → release.communityId`. ReleaseGroup adds an identity edge _above_ the Release; it does not move attribution off it. No reputation/health read is repointed.

4. **The Contribution stays the Spine and is modelled as composable.** Keep ADR-0008's type-agnostic Spine. Model its link to content as a relationship that can grow **1 → N** (a `ContributionItem` seam), while v1 **enforces exactly one item in application logic**. Do not introduce a permanent 1:1 `Contribution.releaseId` foreign key or `@@unique` that a v2 migration must tear out. A future multi-item package still attributes through the community-scoped Releases its items point at — packaging composes content, it does not globalize it.

## v1 scope — build now vs defer

**Build now (scaffolding that is expensive to retrofit):**

- **`ReleaseGroup` identity node + nullable `Release.releaseGroupId`** — this was conditional on v1 Collages needing cross-community dedup, with "accept per-community duplicates" as the standing alternative. **Accepting this ADR takes the build branch** (#265); the alternative is retained at the end of this document as the road not taken, not as an open option.
- **Access-filtering at the resolution boundary** — the one genuinely load-bearing rule: any code that walks Release → ReleaseGroup → sibling Releases must apply the viewer's community access filter at that hop. Designing the resolver access-filtered from the first line is far cheaper than auditing for leaks after collages ship.

**Defer to v2 (do not build now):**

- Multi-item packages — keep the one-item rule enforced.
- Cross-type bundles and the package-composition UI/logic.
- Any cross-community content sharing — explicitly out of scope; the access invariant forbids it.

**Nothing to do (invariant preserved):**

- CommunityScore, pulse, link-health, moderation, DNC reads — they keep riding `release.communityId` and are untouched by this ADR.

## Implementation contract (#265)

Settled on acceptance. Each of these was reached by checking the codebase rather
than the 2026-07-04 blueprint, and several correct it — recorded because the
blueprint is the artefact a future reader will find first.

1. **The resolution boundary is a `where` fragment, not a gate.** Use
   `communityReadableWhere` from `modules/communityAccess.ts`, in exactly the
   shape `routes/api/search.ts` already uses:

   ```ts
   OR: [{ communityId: null }, { community: communityReadableWhere(viewerId) }];
   ```

   Not `hasCommunityAccess` — that module's own doc comment draws the line:
   _"A search filters where a browse refuses… Making search do the same would
   turn every query into an existence oracle for private communities."_ A
   ReleaseGroup spans communities by definition, so resolving its members is
   search-shaped. (The blueprint said `isCommunityMember`, which is both the
   pre-rename name **and** the browse-shaped gate.)

2. **No staff bypass on the resolver.** The filter applies to every caller and
   the `404` is unconditional. `communityAccess.ts` contains no `hasPermission`
   today, and no community-scoped release read — search, requests, browse —
   bypasses the filter for staff. A bypass here would be the first, introduced
   on the newest leak surface. Whether a merge/split moderator needs wider
   visibility is a question for those verbs, not for the read.

3. **The write refuses where the read filters,** which is the same distinction
   one level up. `PUT /communities/:communityId/releases/:releaseId/group` names
   one community in its path, so it is browse-shaped: `assertCommunityAccess`,
   answering `403`. You may only group releases you can already reach. Creating
   an empty group is open to any authenticated member; the destructive verbs
   (merge/split) stay gated.

4. **Group identity is a normalized unique key, so duplicates are impossible
   rather than merely repairable.** `ReleaseGroup.identityKey String @unique`,
   derived from `lower(trim(title))`, `artistId` and `year` by one module
   function, with create implemented as find-or-create against it. A plain
   `@@unique([title, artistId, year])` would not do: Postgres treats NULLs as
   distinct, and **Prisma 6.19.3 rejects `nullsNotDistinct`** (verified against a
   scratch model), so artist-less and year-less groups would still accrete — as
   would `Greatest Hits` beside `greatest hits`, since this repo has no `citext`
   and does case-insensitivity at query time. Duplicate-group accretion is the
   debt #265 exists to pay down; a constraint that only catches the easy half
   leaves merge doing work the schema should prevent.

5. **The group cites its artist; it does not copy the name.**
   `ReleaseGroup.artistId Int?` referencing `Artist`, recorded in the **NOT
   FILTERED** half of that model's doc comment — the half for "a citation of the
   artist as author of a work that still exists," alongside release credits.
   Not an `artistName` string: `Release` has carried no artist column since #72,
   which replaced `Release.artistId` with role-based `ReleaseArtist` credits and
   derives the display field at read time. The schema comment requires any new
   Artist relation to say which half it joins; this says it.

6. **`CoverArt` and `GroupLog` are rewritten with real foreign keys** in the same
   migration that introduces `ReleaseGroup`, rather than left as the FK-less
   legacy stubs beside it. Both are provably empty — nothing in the tree has ever
   written either table — so this costs nothing and buys a coherent topology:
   the model and everything referencing it land together, and the curation verbs
   then ship as pure application code with no migration of their own.
   `GroupLog.communityId` is dropped: a group spans communities, so a
   community-scoped log row on it is a category error.

## Consequences

- Collages gain a clean dedup key (`ReleaseGroup`) without forcing content global and without weakening community privacy.
- The reputation/health invariant is preserved as-is — no migration of attribution, no risk of zeroing CommunityScore or orphaning the pulse.
- A new leak surface is created and must be defended: ReleaseGroup edges cross community boundaries, so every resolver that follows them is access-control-sensitive. This is the cost of the dedup key, accepted deliberately and localized to the resolution boundary.
- One new structural seam (`ContributionItem`) is introduced lazily for v2; v1 runtime behaviour is unchanged (always one item).
- ~~Open sub-decision for v1~~ — **resolved on acceptance**: a ReleaseGroup with no viewer-visible Releases is omitted. A direct read answers `404`; a collage drops the entry. See Decision 2.

## Alternatives rejected

- **Anchor attribution on the Contribution and globalize content** (the earlier draft of this ADR): repointed CommunityScore/pulse/moderation off `release.communityId` onto a Contribution-owned community, to survive content going global. Rejected once the Release-privacy invariant was made explicit: content never goes global, so there is nothing to survive — the repoint is unnecessary work that also discards the natural `release.communityId` anchor.
- **Promote Contribution to a global identity and drop its community** (naïve "deep"): the stress-test showed this zeroes CommunityScore and orphans the community pulse — regresses shipped CRS dimensions. Also incompatible with Release privacy.
- **Globalize content (shared Editions/Contributions across communities) so collages dedup the rows directly**: violates the access invariant — a non-member would reach another community's catalogue through the shared content. Rejected outright.
- **Make `Release` itself global, community as a placement**: enormous blast radius across CommunityScore (0017), link-health (0019), CommunityLeader (0021), and the community-nested contribution routes — and it breaks Release privacy. Rejected in favour of keeping Releases community-owned and private.
- **No ReleaseGroup; accept per-community duplicates in collages**: the genuine fallback if v1 Collages can live with duplicate entries. Cheaper now, but leaves "same album" unresolvable across communities and is the thing v2 packaging would have to retrofit. **Not taken** — acceptance chose the build branch. Recorded because it stayed live through two drafts and is the option to revisit if the identity layer proves more expensive than the duplicates it removes.
