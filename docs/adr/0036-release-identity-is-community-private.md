# Release identity is community-private, and staff curation is what publishes it

**Status: Accepted (2026-09-09).** Accepted as the gate on [#607](https://github.com/orphic-inc/stellar-api/issues/607), whose implementation follows this contract rather than preceding it — the same posture [ADR-0023](0023-contribution-package-and-releasegroup-identity.md) took on #265. This ADR **extends** ADR-0023 Decision 2 from the group resolver to every release read site-wide; it does not edit that document, which stays a dated record of what was decided for #265. Builds on [ADR-0033 community membership and the curator role](0033-community-membership-and-the-curator-role.md) and [ADR-0030 private-community announce delivery](0030-private-community-announce-delivery.md) (the `communityRoleUnion` that defines membership) and [ADR-0001 granular permission checks](0001-granular-permission-checks.md) (there is no staff bypass here either). Unblocks [#605](https://github.com/orphic-inc/stellar-api/issues/605); subsumes [#608](https://github.com/orphic-inc/stellar-api/issues/608) into its first slice.

## Context

ADR-0023 states the invariant plainly, as an access-control rule rather than a convenience:

> A `Release` belongs to a Community, and a user with no access to that Community cannot see its Releases at all… Content cannot leave its Community.

**Every community-nested route honours that. No global route does.** A route that names a community in its path inherits a gate from the path. A route that does not — a collage, a profile, a chart, the homepage — had nothing to inherit, and there was no shared rule for it to reach for. So each such surface was written to whatever its author reached for, and most reached for nothing.

The sweep behind #607 found seven surfaces serving release identity to authenticated callers with no membership: the collage entry read and the entry-add write (`routes/api/collages.ts:401`, `:212`), the recent-contributions block on every profile page (`modules/profile.ts:358`, called unconditionally at `:939`), `GET /random/release` (`routes/api/random.ts:18`), both halves of `GET /home/featured` (`routes/api/home.ts:25`, `:41`), the bookmark write and its list (`routes/api/bookmarks.ts:148`, `:103`), and the collage-shelf cover URLs on a profile (`modules/profile.ts:437`).

The profile one needs no crafted id at all. It is a profile page.

**Four green gates are not evidence about any of this.** `openapi:completeness` (#474) asks whether a route is registered. `openapi:auth-coverage` (#494) asks whether a gated route documents the 401/403 its middleware answers — and these routes are all gated with `requireAuth`; they answer `200` with the wrong rows. The #509 route-authorization audit asked whether a route is reachable **anonymously**, and all six of its findings now carry `requireAuth`. `prisma:guard-coverage` (#564) asks whether a constraint violation is translated, not whether the row should have been reachable at all. This is the next axis along: authenticated, but not a member.

**The question was genuinely open, because the codebase asserted both answers.** `search.ts` filters release rows out of results for non-members. `profile.ts` shows the same rows to the same viewer on a profile page. Both shipped, neither annotated, and the difference between them was not a considered one.

Two further facts shaped the decisions below.

**The rule already exists in three expressions, and one of them cannot be a Prisma fragment.** Only four files import `communityReadableWhere`. `releaseGroup.ts` carries the most correct version, `releaseVisibleToViewer`, whose own doc comment says it must not drift from `search.ts`'s copy and leans on a spec to enforce that. `routes/api/communities/artist.ts:337` hand-rolls a third copy. And `modules/top10.ts` builds its ranking in `$queryRaw`, which no `WhereInput` can reach.

**`Release.communityId` is nullable, and a bare relation filter excludes a null relation.** `releaseGroup.ts` documents the trap; `artist.ts:368` is caught in it, filtering `release: { communityId: { in: accessibleCommunityIds } }` and so silently dropping community-less releases from every artist discography. The rule fails closed there, which is why it went unnoticed — the visible symptom of a fail-closed access bug is nothing.

## Decision

### 1. Identity is private, not merely content

A release's **identity** — title, artist, year, cover — is private to its Community, exactly as its **content** is: contributions, files, download grants. All seven surfaces above are defects.

The alternative was live and coherent: draw the boundary at content, let identity be member-visible site-wide, and amend ADR-0023's wording. It is rejected because that wording is load-bearing for code shipped a week earlier. `resolveGroupForViewer` answers `404` for a group with no viewer-visible member specifically so it cannot serve as an existence oracle for private catalogues. If identity were public, that resolver would be defending a fact the rest of the site gives away for free, and the leak surface ADR-0023 accepted deliberately would have been accepted for nothing.

### 2. Two predicates, named apart, in the module named for access

`releaseVisibleToViewer` moves from `modules/releaseGroup.ts` to `modules/communityAccess.ts`, beside `communityReadableWhere`, together with a merging wrapper for callers that have already built a `where`. `search.ts`'s `scopedToReadableCommunities` and `artist.ts`'s hand-rolled copy collapse onto it. The drift spec then has nothing left to guard, because there is one function rather than three agreeing ones.

There are **two** predicates, and they are named apart because reaching for the wrong one fails silently — it returns rows, just the wrong set:

| predicate                          | means                                 | callers                                                                                            |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `releaseVisibleToViewer(viewerId)` | visible to **this viewer**            | collages, bookmarks, profile, random, search, release groups, community browse, artist discography |
| the publicly-chartable predicate   | in **no** community, or an `open` one | top10, the vanity-house slot                                                                       |

Both carry the `{ communityId: null }` arm, for the reason `artist.ts` demonstrates by omitting it.

**`top10` stops using `$queryRaw`** so that it consumes a fragment like everything else rather than restating an access rule in SQL, where no type and no spec could hold the two together. #608 forces that rewrite regardless: all three branches (`modules/top10.ts:195`, `:218`, `:248`) select and join `releases.artistId`, a column migration `20260609171357_music_model_release_files` dropped when #72 replaced it with role-based credits.

### 3. A site-wide chart contains only public communities

Top 10 ranks over releases whose community is `open` or null. Releases in a `PRIVATE` community are excluded **for everyone, including that community's own members**, who see their own rankings through the community-scoped surfaces instead.

This is a **product decision, not a security one**, and it is recorded as such because a future reader will otherwise try to derive it from the access rule and fail. Both viewer-scoped alternatives break what a ranking claims to be. Renumbering per viewer means "the #1 release this week" stops being a fact the site can state, and two members comparing charts are comparing different objects. Preserving the global rank numbers and leaving gaps — ranks 1, 3, 7 — hands a non-member an exact count of how many hidden releases outrank what they can see, which is a sharper disclosure than the titles would have been.

A single global answer also keeps the cache and the history honest without redesigning either: `top10Cache` keys on the query alone, and stored `Top10SnapshotEntry` rows stay renderable as written.

### 4. Staff curation is an act of publication, enforced at set time

Album of the Month is chosen by a person, not computed. Featuring a release **publishes its identity**, and that is enforced by refusing the choice rather than by filtering the result: `POST /announcements/album-of-month` rejects a release outside a public community with a `400`.

Read-time filtering was the obvious move and is worse. It empties the homepage slot with no explanation and no one accountable for it — for non-members under a viewer-scoped rule, or for everybody under the chart rule. Refusing at set time puts the decision in front of the staff member making it, at the moment they make it.

Two pre-existing faults fall to the same check. `FeaturedAlbum.groupId` carries **no foreign key** to `Release`, so a dangling feature is already possible and the expression at `routes/api/home.ts:38` resolves to null for it, with no message anywhere. That field is also [#603](https://github.com/orphic-inc/stellar-api/issues/603)'s rename territory — a `groupId` that names a Release, not a `ReleaseGroup` — which this ADR flags and deliberately leaves alone.

The vanity-house slot is **not** curation. It is a query for the most recently updated release credited to a `vanityHouse` artist, so it takes the chart predicate.

`GET /random/release` is viewer-scoped. It has no cache and no ranking, so §3's reasoning does not reach it, and a member being unable to draw their own community's releases from their own random pool would be a loss with nothing bought.

### 5. A write refuses a release it cannot see with the same 404 as one that does not exist

`POST /collages/:id/entries` and `POST /bookmarks/releases/:releaseId` answer **404 with the message they already use for a missing release**. The two cases stay indistinguishable from outside.

Neither caller names a community. Both name a **release id**, which makes them search-shaped rather than browse-shaped, and `communityAccess.ts` already draws that line: `assertCommunityAccess` answers `403` because the caller asked about a specific community and is owed a straight answer, whereas making a search do the same "would turn every query into an existence oracle for private communities." A `403` here would confirm that the probed id is real and private. It also matches `resolveGroupForViewer`, which established the posture for exactly this shape.

No new status appears on either operation: both already answer `404` for a genuinely missing release, `collages.ts:212` directly and `bookmarks.ts:148` through its #564 `P2003` guard, which sends the same `Release not found`.

**The bookmark route is a toggle, and only its create arm is gated.** `POST /bookmarks/releases/:releaseId` deletes an existing bookmark before it reaches the create. Decision 7 leaves rows in place, so a member who bookmarked a release and later lost access to its community must still be able to remove that bookmark; checking visibility before the toggle branches would trap them with a row they can neither see nor delete. The check belongs on the create arm alone.

These two writes are the sharper half of #607. A filtered read leaks what the caller could reach anyway; a write that accepts an unreachable id lets the caller **choose** what to pull across the boundary — and in the collage case, publish it to everyone who opens that collage.

### 6. `numEntries` keeps its meaning; the detail read gains a visible count

`numEntries` stays the true total of a collage's entries everywhere. It is a **sort key** on the browse list, so a per-viewer value could not serve without a correlated subquery per row, and it is the quantity the per-collage quota is enforced against (`routes/api/collages.ts:225`).

`GET /collages/:id` gains an **additive** count of the entries this viewer can see. Purely additive, so no existing consumer breaks; stellar-ui renders it above the list it describes.

A bare count is deliberately not treated as identity. A non-member learns that a collage holds entries they cannot see, and learns nothing about what they are — which is the same trade §3 refused only because a rank _position_ carries more than a total does.

**This field is also #605's.** When a release group collapses several entries into one, the rendered list falls short of `numEntries` for the same arithmetic reason, and it should not grow a second answer to one question.

### 7. Rows already written are left in place

No migration and no deletion. `CollageEntry` and `BookmarkRelease` rows pointing at private-community releases are not malformed — they are rows nobody filtered on read. A hidden entry **reappears** if that viewer later joins the community, which is correct rather than residue. Purging would destroy curation that may have been added by someone who legitimately could see it, evaluate membership at migration time for a thing that changes, and drag `numEntries` recomputation along with it.

### 8. No new gate

The seven surfaces are fixed and covered by unit specs asserting **the query, not the payload**. No structural checker, no shrink-only baseline, no behavioural leak suite.

This departs from the lesson #564 set — ship the rule as a checker before fixing anything — and it is recorded as a departure rather than an oversight. The cost is stated in Consequences. It takes no position on [#596](https://github.com/orphic-inc/stellar-api/issues/596), which remains the open question of whether `src/modules/` gets guard-coverage enforcement.

## Consequences

- **Some responses become viewer-dependent that were not.** Two members open the same profile and see different recent contributions; two members open the same collage and see different entry lists. This is the intended meaning of Decision 1, and it is worth stating because it makes those responses uncacheable by any shared key and makes bug reports about them harder to reproduce.
- **`GET /random/release` can now find nothing** for a viewer whose accessible communities hold no releases, where previously it drew from the whole table. Its existing empty answer covers this; it will simply be reached more often.
- **The homepage can be missing its Album of the Month**, exactly as today, but the failure now happens at set time with a message rather than at read time in silence.
- **A private community's releases disappear from the site chart, for its own members too.** Decision 3 is the one choice here that a member could reasonably experience as a regression, and the community-scoped surfaces are the answer to give them.
- **`artist.ts` gains releases it was wrongly hiding.** Collapsing its hand-rolled filter onto the shared predicate restores community-less releases to artist discographies — a behaviour change in the widening direction, arriving inside a change whose every other effect narrows.
- **Nothing prevents the eighth surface.** This is the accepted cost of Decision 8. #607's own diagnosis is that this rule lived in nobody's head; afterwards it lives in this document and two doc comments, and the count of unfiltered surfaces is re-derived by nothing. A global release surface added later with no filter reintroduces the class, and no gate reports it.
- **`releaseGroup.ts` loses its drift spec and its most-cited doc comment**, both moving to `communityAccess.ts` with the predicate. The #265 code keeps its behaviour exactly; only the import moves.

## Alternatives rejected

- **Content is private, identity is not.** Titles, artists and covers member-visible site-wide, with the boundary at contributions, files and grants. Six of the seven surfaces would have been correct as written and `search.ts` the outlier to reconcile. Rejected under Decision 1: it requires amending an ADR accepted the same day, and it strands `resolveGroupForViewer`'s non-oracle `404` as a defence of nothing. It would also make a `PRIVATE` community's catalogue browsable one title at a time.
- **Split the boundary: aggregate versus attributable.** Identity visible in aggregate surfaces (chart, random, stats) but not attributable ones ("this album is in that community", "this member contributed it"). Genuinely coherent, and Decision 3 lands close to where it would have. Rejected as a _stated rule_ because it is a third thing to write down and police, and because these projections already emit `communityId` — so an "aggregate" surface would have had to stop, which is a response-shape change the split was supposed to avoid.
- **A structural checker on the #564 model.** A pure checker plus CLI plus shrink-only baseline listing all seven with reasons, shipped red and burned down. Recommended during the grill and declined on cost. It is the option to revisit the first time an eighth surface appears — which is the event Decision 8 accepts.
- **Purge the planted rows in a migration.** Rejected under Decision 7: irreversible, disproportionate to a read bug, and wrong about rows that were never invalid.
- **A staff bypass on the viewer predicate.** Never seriously live, and recorded because it is the thing a reader will reach for the first time a moderator cannot see something. `communityAccess.ts` contains no permission check at all, no community-scoped release read in this codebase has a bypass, and ADR-0023 already refused to make this the first. Whether a moderator needs wider visibility is a question for the moderation verbs, not for the read.

## Deferred / out of scope

- **Aggregate counts stay global.** `prisma.release.count()` in `modules/stats.ts` and `routes/api/stats.ts` reports a site-wide total. A total is not an identity disclosure, and scoping it per viewer would make the site's own statistics unstateable.
- **Self-scoped reads are untouched.** `routes/api/notifications.ts:128` hydrates release titles for the caller's own notifications, and `getRecentSnatches` (`modules/profile.ts:921`) is already gated to owner-or-staff. Neither crosses between members.
- **Staff-only projections are untouched.** `modules/reports.ts:135`, `:201` select `release.communityId` to build a deep link in the staff queue, and emit no identity.
- **Internal reads have no response path**: `linkHealth.ts`, `reputation.ts`, `announce.ts` — the last governed by ADR-0030 rather than by this document.
- **The `#603` rename** — `groupId` meaning a `Release` in `FeaturedAlbum` and the community routes — is flagged by Decision 4 and left to its own issue.
- **#605's dedup design** is unblocked by this ADR, not settled by it. What remains there is whether `CollageEntry`'s `@@unique([collageId, releaseId])` should also dedup at _entry_ time, which is a schema question this document does not reach.
