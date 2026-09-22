# Contribution notification filters

**Status: Accepted (2026-09-22).** Accepted as the gate on [#263](https://github.com/orphic-inc/stellar-api/issues/263). #263 carried a July blueprint; it was regrilled against current source and the legacy implementation, and the outcome is [on the issue](https://github.com/orphic-inc/stellar-api/issues/263#issuecomment-5783942816). This record supersedes the blueprint on every point where they differ. [#663](https://github.com/orphic-inc/stellar-api/issues/663) builds the per-filter Member Feed on it ([ADR-0014](0014-per-user-contribution-feed.md)). ADR-0048 is left for #596.

## Context

A member saves a named filter, and each new contribution that matches it becomes a **hit** they can read, catch up on and clear. This is the legacy implementation's torrent notification system, which its users relied on for discovery.

**The July blueprint was stale on four facts.** `isCommunityMember` no longer exists; access is `releaseVisibleTo` ([ADR-0036](0036-release-identity-is-community-private.md)). Tag names now have one canonical form ([ADR-0047](0047-a-tag-name-has-one-canonical-form.md)). The feed half moved to #663. Media lives on `Edition`, not `Release`.

**The legacy implementation differs from the blueprint in five ways,** each read from `upload_handle.php`, `notify_handle.php` and `torrents/notify.php`:

- It stored one hit per (user, torrent), recording whichever filter matched first, while still populating every matching filter's own feed.
- Its `NewGroupsOnly` meant the first upload in the group to match _the filter's_ format and bitrate, not the first upload in the group.
- Its `ExcludeVA` did two things. It skipped uploads with more than two main-class artists, and it ignored matches through a guest-class credit.
- It gated the feature on a permission, with no count cap, and required a label and at least one set field, counting a flag as a field.
- Opening the hits page marked everything shown as read, and its "clear all old" deleted read hits only.

**Stellar's artists are global rows with ids**, where the legacy implementation matched artist names with `LIKE`.

## Decision

### 1. Schema

`NotificationFilter` holds a label, `artistIds Int[]`, `tags` and `notTags` (canonical names), `communityIds Int[]`, enum arrays for `releaseTypes`, `releaseCategories`, `fileTypes`, `bitrates` and `media`, nullable `fromYear` and `toYear`, and three flags. `NotificationFilterHit` holds `filterId` (cascade), a denormalized `userId`, `contributionId` (cascade) and `readAt`, unique on `(filterId, contributionId)`.

Every list reads "empty, or the contribution has one of these". **A contribution missing a value** — no bitrate, no media — **matches only a filter that leaves that list empty**, as in the legacy implementation. The year range matches the release year **or** the edition year. The legacy `RecordLabels` column is dropped: its matcher did not read it.

### 2. Artists are matched by id

A filter stores artist ids and matches them against the release's `ReleaseArtist` credits. Soft-deleted artists are refused on write. A rename keeps matching, which name matching could not.

The grill also settled on resolving ids through `ArtistAlias.redirectId`. **Building it showed that step would be wrong:** nothing in the codebase resolves a redirect, credits keep the original id, and the dev-tools generator writes self-redirects. Resolving the filter's id would make it miss the credits it was written for, so no resolution is done.

The cost of matching by id is that a member cannot pre-watch an artist who is not on the site yet. A tag covers that case.

### 3. One row per filter, counted per contribution

Three filters catching one upload store three rows, so each filter's own view and #663's feed are complete. **Everything member-facing counts and lists contributions:** the unread badge is `COUNT(DISTINCT contributionId)`, and the combined list shows the upload once, naming every filter that caught it. Reading it there marks every row. A per-filter catch-up marks only that filter's rows, so the upload stays unread in the combined view while another filter still holds it.

The legacy shape of one row per (user, torrent) was rejected: the second filter's membership would be lost, and #663 needs it.

### 4. `newReleasesOnly` means the first _matching_ contribution

A filter with the flag matches unless an earlier contribution on the same `Release` already satisfied **this filter's** `fileTypes` and `bitrates`. So "new only, `flac`" fires on the first `flac` contribution of an album that already had three MP3s, which is what the legacy flag was used for.

The scope is the `Release`, not the `ReleaseGroup`. Group-wide "earlier" would depend on releases in communities the member may not be able to see (ADR-0036).

### 5. The artist flags are split

- `excludeCompilations` skips a release with more than two distinct main-class artists (`Main`, `Composer`, `Conductor`, `DJ`).
- `mainCreditsOnly` matches `artistIds` only through a main-class credit, so Guest, Remixer, Producer and Arranger do not count.

These are the legacy threshold and role split. The legacy implementation put both behind one checkbox named for only the first; here each flag says what it does.

### 6. The rank column is the only gate

`UserRank.notificationFilterLimit Int? @default(0)` uses `assetLimit`'s semantics:

- `0` means the rank cannot use filters. Every filter route answers **403**, not only create.
- `null` means unlimited.
- N is the cap. Creating a filter beyond it answers **400**.

There is no permission key, so there are not two levers that could disagree. Matching also skips owners whose rank is at `0`. A rank lowered to a positive limit below a member's current count keeps their existing filters; only new ones are refused. Staff ranks are seeded `null` by `bootstrap.ts`, and member ranks start at `0` until staff opt a class in, the same inert-by-default rollout as the invite handout.

The asset upload answers 400 for a rank at `0`. This answers 403, because the refusal is about who the caller is, not what they sent.

The allowance runs in each handler rather than as middleware, because no route-gate kind in `lib/routeGate.ts` describes it. Each operation therefore declares its 403 by hand. That is #558's hazard in miniature: a gate the contract cannot see.

### 7. A filter needs a label and one set field

The label is 1–100 characters. A flag counts as a set field, so a deliberate "every new release" filter is legal, as it was in the legacy implementation. Only a filter with nothing set is refused. Validity is checked **after** tags are normalized, so tags that normalize away leave nothing behind.

Each list is capped at 100 entries. That cap bounds the cost of matching, not the member's allowance.

### 8. Matching runs after commit, and applies access

`scheduleFilterMatching` runs from both `createContributionSubmission` and `addContributionToRelease`, beside the existing link check, through `runInBackground`. A matching failure is logged; it cannot roll back or fail an upload.

The matcher does its work in four steps. The first query pre-filters with Postgres array operators (`isEmpty OR hasSome` on artists, tags and communities) and excludes the uploader, disabled accounts and ranks at `0`. `notificationFilterMatch.ts` then applies the rest of the predicate as a pure function. `newReleasesOnly` reads the release's earlier contributions only when a surviving filter has the flag. Finally, `releaseVisibleTo(userId)` is applied per surviving member. The cost is proportional to matching filters, not to members times filters.

### 9. Reads are explicit, and apply access again

`GET` has no side effects. Hits are marked read by contribution, optionally narrowed to one filter. Catch-up covers every filter or one. The bulk `DELETE /hits` removes **read hits only**, the legacy "clear all old", so one click cannot wipe unseen matches. `DELETE /hits/:contributionId` removes a contribution's hits in any state.

Every hit read applies `releaseVisibleTo(userId)` again. A member who loses access to a community stops seeing its hits, and the rows stay, so regaining access brings them back.

Hit routes address a **contribution**, not a hit row, because that is the identity the member-facing list shows.

**No new `NotificationType`.** Hits are their own satellite with their own count. Writing them into `Notification` as well would make a per-filter catch-up disagree with the notification's read state.

## Consequences

- **Eleven new operations** are added under `/api/notification-filters`, plus a staff read at `GET /api/users/:id/notification-filters` (`users_edit`, not subject to the member's own allowance). The rank editor gains `notificationFilterLimit`.
- **Nothing happens until staff opt a rank in.** On an existing install, staff ranks also sit at `0` until `/install` or `db:seed` reconciles them. The migration only adds the column, as the `assetLimit` migration did.
- **#663** reads one filter's own rows through the Member Feed's existing rules.
- **[#695](https://github.com/orphic-inc/stellar-api/issues/695)**, found during the regrill: the existing `artist_release` notification reaches subscribers who cannot see the release. This work does not fix that. Filter hits apply access at both ends.
- **Uploader-targeting is not built.** The legacy `Users` field needed an uploader privacy flag Stellar does not have (ADR-0046). It stays registered in #301.
- **Hits are not pruned.** Neither the legacy implementation nor this pruned them; a retention sweep would be its own decision.
