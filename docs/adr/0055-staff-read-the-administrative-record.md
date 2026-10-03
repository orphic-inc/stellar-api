# Staff read the administrative record; a report opens the release it concerns

**Status: Accepted (2026-10-02).** Decided in the grill on [#902](https://github.com/orphic-inc/stellar-api/issues/902). It answers the question [ADR-0036](0036-release-identity-is-community-private.md) left to "the moderation verbs, not the read", and keeps that ADR's rule, and [ADR-0023](0023-contribution-package-and-releasegroup-identity.md)'s, that the access predicate has no staff bypass.

## Context

A community's access rule is `open || role union` ([ADR-0033](0033-community-membership-and-the-curator-role.md)), stated once in `modules/communityAccess.ts`. About 25 files read through it: community reads, release browse and detail, search, downloads, feeds, notifications, Top 10, bookmarks, collages, comments and profiles. It holds no permission check, so staff are members like anyone else.

That left staff responsible for communities they could not see:

- `PUT` and `DELETE /communities/{id}`, and `POST /communities/{id}/releases`, are gated on `communities_manage` alone. Staff could write to a closed community they hold no role in, but `GET /communities/{id}` answered `403`.
- Community Manager listed through `GET /communities`, the member browse, so a closed community never appeared there at all.
- The pending leader offer ([ADR-0053](0053-community-leadership-curator-authority-and-handoff.md) §8) and the leadership log ([ADR-0054](0054-product-history-gets-a-dedicated-log.md) §4) inherited the same `403`.
- A report against content in such a community could not be acted on: its release page answered `403`. The staff queue still linked to it, since staff links skipped every visibility check. (This ADR first said the queue built them through `releaseVisibleTo(staff)` and so showed no link; #905 found otherwise.)

The legacy implementation has no communities, so there is no parity to keep.

## Decision

### 1. No staff bypass at the access predicate

`communityAccess.ts` keeps no permission check. A bypass there would reach every contents read at once: staff would download from closed communities, and find their releases in search, feeds, notifications and Top 10. Each grant below is made at a named surface, for a named permission.

### 2. Staff read every community's administrative record

A community's **administrative record** is what Community Manager edits, and its people: the row and its settings, leader, curators, the members roster, the pending leader offer and the leadership log. Holders of `communities_manage` or `admin` read it for every community.

Its **contents** stay member-only: releases, contributions and their downloads, requests, comments and the health pulse.

- **`GET /communities/manage`** lists every community for staff, with the member browse's projection. `GET /communities` stays the member browse, for staff too: widening it would put communities in front of staff that they cannot use as members, including in the release browse's community filter.
- **`GET /communities/{id}`** and **`GET /communities/{id}/leadership-log`** admit staff through an explicit arm at those two call sites. They already return the record and nothing else, so a second detail route would only duplicate the contract.

### 3. A report opens the release it concerns

A holder of `reports_manage` reads **the page of the release a report concerns** while that report is `Open` or `Claimed`: the release detail and its contributions list. A report concerns a release when it targets the release, one of its contributions, or a comment in the thread of either. The report queue's source link follows the same rule: a link into a release page appears only when the page will open for that staff member, as a member or through an open report.

That read gets each contribution's `downloadUrl` as an empty string. The URL is the download without the grant's debit, and the grant here is to look.

> **Amended 2026-10-03 ([#908](https://github.com/orphic-inc/stellar-api/issues/908)).** That read no longer carries `downloadUrl` at all. #908 removed it from the contributions list for every reader, so there is nothing left for this read to blank.

Nothing else opens: no download, no other release, and no search, feed, notification or Top 10 entry. Resolving the report ends the grant. Editing the release still goes through the workbench's own gate. Comments on requests and on communities are left out until a report needs them.

A report is a request for staff to look at one thing, so it is the narrowest grant that lets them do it. It is built in [#905](https://github.com/orphic-inc/stellar-api/issues/905).

## Consequences

- Community Manager can list and edit every community (stellar-ui#475). The offer note and the leadership history work for staff everywhere, so ADR-0053 §8's and ADR-0054 §4's interim notes now point here.
- `communityAccess.ts` stays the single, permission-free statement of membership access. A future staff need gets its own named surface, as here.

## Alternatives rejected

- **A staff bypass on the predicate.** It grants far more than reading, and overturns ADR-0023 and ADR-0036 to do it.
- **No change.** Staff could write to communities they could not see, and reports in closed communities could not be acted on.
- **Widen `GET /communities` for staff.** The browse leads into contents, which staff still cannot open.
- **A snapshot of the reported item in the queue,** instead of the report-scoped read. Enough to judge, not enough to act: fixing metadata needs the page.
