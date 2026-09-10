# Group dedup is a read-time projection, not a schema constraint

**Status: Accepted (2026-09-10).** Accepted as the gate on [#605](https://github.com/orphic-inc/stellar-api/issues/605), whose implementation follows this contract rather than preceding it — the posture [ADR-0023](0023-contribution-package-and-releasegroup-identity.md) took on #265 and [ADR-0036](0036-release-identity-is-community-private.md) took on #607. It answers the one question ADR-0036 deferred in terms: whether `CollageEntry`'s `@@unique([collageId, releaseId])` should also dedup at _entry_ time. Builds on ADR-0023 (the identity node itself) and ADR-0036 (the site-wide visibility rule and the `numVisibleEntries` field). Blocked by [#613](https://github.com/orphic-inc/stellar-api/issues/613), which makes the entry order deterministic — the representative rule below is meaningless without it.

## Context

`ReleaseGroup` shipped with #265 and **nothing consumes it**. ADR-0023 built it as the dedup key for collages and search, and its Context states the problem unchanged:

> So "the same album" curated in two communities is two unrelated `Release` rows, and a collage cannot dedup them — it points at one community's row, or shows both as separate entries.

ADR-0036 then settled two things this document depends on and does not revisit. A group with no viewer-visible member is **omitted**, not rendered identity-only, and that rule now binds every release read rather than only the group resolver. And `GET /collages/:id` gained `numVisibleEntries` (`routes/api/collages.ts:489`), added in anticipation of this issue precisely so the collapse would not invent a second answer to the same question.

Four facts from the code decided the rest, and three of them were not knowable from either prior ADR.

**Merge repoints group membership outside collages entirely.** `mergeReleaseGroups` moves releases between groups with a bare `updateMany` on `Release.releaseGroupId` (`modules/releaseGroup.ts:330`). It has no knowledge of collages and no reason to acquire any.

**Grouping is opt-in, manual, and never backfilled.** `Release.releaseGroupId` is nullable, nothing on the release-create path assigns it, and `test/factories.ts:523` says so explicitly. A group edge exists only where a member went and made one through `PUT /communities/:communityId/releases/:releaseId/group`.

**`distinct` cannot express the dedup, and fails in the widening direction.** Postgres groups NULLs together under `DISTINCT` and `DISTINCT ON`, unlike the `UNIQUE` constraint whose opposite behaviour ADR-0023 Decision 4 already documents. Measured against a seeded development database: `findMany({ distinct: ['releaseGroupId'] })` returned **1 row for 101 releases**, because every ungrouped release shares `NULL`. All three existing `distinct:` uses in this repository are on non-nullable foreign keys.

**The group panel is not merely unconsumed — it is unreachable.** The release detail read exposes neither `releaseGroupId` nor group identity, and `GET /release-groups/:id` requires an id that no release-facing surface hands out. stellar-ui could not render that panel today even if it were written.

## Decision

### 1. No dedup at entry time, because a group-level refusal is an existence oracle

`CollageEntry` keeps `@@unique([collageId, releaseId])` exactly as written. `POST /:id/entries` gains nothing: no group check, no second uniqueness test, no schema change.

The reason is access control rather than cost. A caller may add release X only because ADR-0036 §5 let them see it. If the collage already holds release Y in a private community they do not belong to, and X and Y share a group, then a group-level `409` tells that caller a release they cannot see exists, in a community they are not in, and that someone curated it into this collage. That is the disclosure `resolveGroupForViewer`'s unconditional `404` exists to prevent, arriving through a write instead of a read.

A viewer-scoped refusal — dedup only against entries this caller can see — leaks nothing and was live through the design. It is rejected as a **false guarantee**: two members with different memberships get different answers for the same add, so it cannot be described to a client as a rule, and merge invalidates it afterwards regardless.

The read-time collapse has neither problem, because it only ever collapses rows the viewer can already see.

### 2. The collapse is a projection, and every underlying row stays addressable

`GET /collages/:id` collapses `entries` to one row per group. The representative is the first entry under `[{ sort: 'asc' }, { id: 'asc' }]`, and it gains two additive fields:

- `group: { id, title, artist, year, image }`
- `groupedWith: [{ id, releaseId, communityId, title, userId, addedAt }]` — the entries it absorbed

Both are additive, so no existing consumer breaks.

Nothing is dropped, and that is the load-bearing property rather than a nicety. `DELETE /:id/entries/:releaseId` is keyed on a **release id**, and its permission is per row — the collage owner, _the adder of that particular entry_, or staff (`routes/api/collages.ts:825`). Two entries that collapse into one can have two different adders. A lossy collapse would leave an entry its own adder could neither see nor delete, and a reorder could not name it either, since `PUT /:id/entries` addresses entries by `CollageEntry.id`. Curation would be destroyed by a read — the failure ADR-0036 §7 refuses in the migration direction, arriving by another route.

Because every row survives, **the delete, permission and reorder paths need no change at all**.

A read performs no write. Absorbed entries keep their `sort` values untouched.

### 3. Identity inlines; membership does not

Every entry whose release has a group carries `group`, **whether or not it collapsed**. Otherwise the same release renders one way to a viewer who can see a sibling and another way to a viewer who cannot, and the label becomes a function of the reader's memberships rather than of the album.

This leaks nothing. Seeing a release already entitles a viewer to its group's identity: `resolveGroupForViewer` returns exactly `{ id, title, artist, year }` to anyone who can see a single member, which this viewer can. The **sibling list** is the part that must stay behind the resolver, and it does — `groupedWith` is not membership, it is the subset of _this collage's already-filtered entries_ that share a group.

`image` is the group's oldest `CoverArt`, and null when the group has none. `CoverArt` carries no primary flag, so "oldest" is a new rule and is stated here rather than left implicit; `listGroupCovers` already orders `[{ addedAt: 'asc' }, { id: 'asc' }]`, so this reuses an ordering rather than inventing one. Clients fall back to `release.image`, which #605 describes as the release-local fallback and which stays in the response untouched.

The release detail read inlines the same projection from **one shared helper**, which closes the unreachable-panel gap. One expression rather than three agreeing ones is the ADR-0036 §2 lesson applied to a projection instead of a predicate; the failure mode is milder here — a drifted label rather than a leak — but the cure costs the same.

### 4. Search annotates; dedup gets a group-shaped endpoint of its own

`GET /search/releases` keeps its pagination, its `total` and its ordering, and gains only the additive `group` annotation. A duplicate is then **labelled** as the same album rather than removed.

It does not collapse, and no in-page dedup is applied. Collapsing a fetched page after `skip`/`take` makes `total` and `totalPages` overstate, makes page sizes vary, and still shows a group twice when its members straddle a page boundary. A count that disagrees with the list it counts is the defect ADR-0036 §6 spent a decision avoiding.

Honest dedup instead gets `GET /search/release-groups`, paginating over `ReleaseGroup` where `releases: { some: <filters ∧ releaseVisibleToViewer(viewerId)> }` and attaching the visible members. Counts and paging are correct because the group **is** the row. Two limits are accepted and stated up front rather than discovered: it returns only grouped releases, and it can order by group fields or `releases._count` — not by `consumers` or `contributors`, since Prisma cannot order a parent by a to-many relation's scalar.

`$queryRaw` with a synthetic key (`DISTINCT ON (COALESCE(release_group_id, -id))`) would be complete and correctly paginated. It is rejected because it restates the **viewer-scoped** access predicate in SQL. ADR-0036 §2 permitted raw SQL for top10 specifically because the chart predicate is viewer-independent and static; the reasoning it gave against restating an access rule in SQL — that no type and no spec can hold the two expressions together — applies here undiminished.

### 5. `numVisibleEntries` is the collapsed count

It is the length of the array it sits beside, after filtering **and** after collapsing. `numEntries` keeps its single meaning everywhere: the true total, the browse sort key, and the quantity the per-collage quota is enforced against.

This is what ADR-0036 §6 reserved the field for, and the reason it is not two fields. The rendered list falls short of `numEntries` for two reasons now — hidden entries and collapsed ones — and a reader has no interest in the split.

### 6. The parked checker's trigger fired, and is declined a second time

ADR-0036 §8 declined a structural leak checker and named its own trigger: _"A global release surface added later with no filter reintroduces the class, and no gate reports it… the first new leak surface is the trigger to revisit it."_

`GET /search/release-groups` is that surface. The trigger has fired, and the checker is **declined again**, in favour of an integration test. This is recorded as a second deliberate declination rather than left to look like an oversight, because a parked gate whose trigger has fired and gone unremarked is how a rule stops being enforced quietly.

The guard is `src/integration/collageGroupCollapse.integration.ts`, and its load-bearing assertion is that `groupedWith` never carries a sibling the viewer cannot see. The precedent is good: `top10Chart.integration.ts` caught what no unit specification structurally could, since #608 survived a release because a mock cannot fail on a column that does not exist.

The cost is unchanged from ADR-0036 and is restated because it has now been paid twice: nothing re-derives the count of unfiltered surfaces, and the ninth will not announce itself either.

## Consequences

- **A collage's rendered length now varies for two reasons rather than one.** Membership already made it viewer-dependent; grouping makes it depend on curation performed elsewhere, by people with no relationship to the collage. A collage owner can watch their entry count fall without touching it, because someone merged two groups.
- **`groupedWith` is safe only because it is derived from an already-filtered set.** It is not independently gated, and it must never be built from anything but the entries the visibility filter returned. The doc comment on the shared projection says so; if a future caller assembles it from a wider query, it becomes a leak with no test failing.
- **A reappearing sibling lands at a stale `sort`.** After a split, or when a viewer joins a community, an entry that was absorbed or hidden re-enters the list at whatever position it last held, which may interleave oddly until someone reorders. Normalizing sorts on reorder was considered and rejected: it would rewrite another member's curation position, silently, on rows the caller never saw and could not name.
- **Search returns the same album more than once, by design.** #605's title asks for dedup in search and this document gives it a separate endpoint instead. `/search/releases` is honestly paginated and honestly duplicated; the alternative was a dishonest count.
- **Group cover art acquires a canonical rule with no schema support.** "Oldest cover wins" is a read-time convention, not an `isPrimary` flag, so it cannot be curated. The first request to choose a different cover is the trigger to add the flag.
- **The dedup covers a sparse and growing subset.** Grouping is manual and never backfilled, so on a fresh install this feature does nothing visible. That is not a defect; it is the shape ADR-0023 chose, and the collapse degrades to today's behaviour exactly.

## Alternatives rejected

- **`@@unique([collageId, releaseGroupId])` with the pointer denormalized onto `CollageEntry`.** The database-enforced version of Decision 1, and #605's own framing of the question. Rejected three times over: it leaks, because the refusal cannot be viewer-scoped; merge would have to delete collage entries to keep the constraint satisfiable, which ADR-0036 §7 refuses; and the denormalized pointer needs maintaining on every group verb, in a codebase whose own lesson is that denormalized pointers are not covered by a soft delete.
- **A viewer-scoped courtesy `409` at add time.** Refuse only when the caller can see the sibling. Leaks nothing, and stayed live to the end. Rejected under Decision 1 as a rule that cannot be stated to a client and that merge invalidates from outside.
- **Collapse the fetched search page.** One line, and dishonest in three separate ways. Recorded because it is the obvious move.
- **Annotate the release read with `releaseGroupId` alone**, leaving stellar-ui to fetch the panel. Keeps every byte of group identity behind the single resolver. Rejected as a round trip bought with nothing, since the viewer's entitlement to the identity is already established by their seeing the release.
- **Lossy collapse.** The cleanest response shape, and it strands an entry its own adder cannot delete. See Decision 2.
- **Earliest `addedAt` as the representative.** Stable against reordering and independent of #613 — but the collage owner could then no longer position a collapsed row at all, since the sort they set on the representative would be ignored.
- **A structural leak checker.** See Decision 6. Costed in ADR-0036's own Alternatives rejected and still ready; declined on the same grounds a second time.

## Deferred / out of scope

- **`CoverArt.isPrimary`.** Decision 3 picks the oldest cover as a read-time convention. A curated primary cover is a schema change and belongs to whoever asks for it.
- **The `createdAt` tiebreak sweep.** [#613](https://github.com/orphic-inc/stellar-api/issues/613) covers ordering columns a human or a seed assigns, where collisions are structural. The 72 single-field `orderBy` expressions ordering on timestamps are a larger and weaker question — ties there are incidental, though rows written inside one transaction can share a timestamp, which is a plausible source of integration-test flake.
- **Dead ordering columns.** `BookmarkRelease.sort`, `BookmarkCommunity.sort` and `Donation.rank` are `@default(0)` columns that nothing orders by. Recorded in #613 and left alone.
- **The `#603` rename** — `groupId` meaning a `Release` rather than a `ReleaseGroup` — is untouched here and grows slightly more confusing as `group` enters three response shapes with the correct meaning.
- **Stylesheet, wiki and forum surfaces** take no group. Only releases have one.
