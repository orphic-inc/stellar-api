# A contributor belongs to many communities; an upload requires membership

**Status: Accepted (2026-09-23).** Accepted as the gate on [#709](https://github.com/orphic-inc/stellar-api/issues/709). The grill outcome is [on the issue](https://github.com/orphic-inc/stellar-api/issues/709#issuecomment-5804443750). Builds on [ADR-0033 community membership and the curator role](0033-community-membership-and-the-curator-role.md), which defines membership as the role union, and [ADR-0036 release identity is community-private](0036-release-identity-is-community-private.md), whose §5 sets the status code. It does not edit ADR-0033. That record's premise, that each role is a per-community relation, was true of the design and false of the schema; this record corrects the schema to match the design. Unblocks [#700](https://github.com/orphic-inc/stellar-api/issues/700).

## Context

ADR-0033 defines a member of a community as anyone holding `consumer ∪ contributor ∪ curator`, and calls each of those "a per-community role relation". `Consumer` is one: one row per user, with an m:n `communities` relation. `Contributor` was not. It was one row per user (`userId @unique`) carrying a **single** `communityId`.

**The intended model was one-to-many.** Before `9be4ae5` (2026-03-04), `Contributor` was `userId` + `communityId` with no unique constraint on `userId`. That commit added the constraint, apparently so an `upsert` could key on `userId`. It was reverted the same day, then reintroduced by `d7d828e` (2026-04-21), and every later migration inherited it. Nothing recorded the change.

**The two writers disagreed about what the single column meant.**

- `createContributionSubmission` upserted with `update: {}`. The **first** community stuck, so a member's later uploads to other communities never made them a contributor there.
- `addContributionToRelease` upserted with `update: { communityId }`. That **moved** the role, so an upload to community B removed the member from community A.

Reproduced against the integration database, one member uploading into three closed communities ended with a single `Contributor` row pointing at B, and access to A was gone. That included access to their own releases and contributions there. This is the case the owner exception on `GET /contributions/:id` (#700) exists to paper over.

**Neither upload path checked access, and the role they wrote is part of the membership union.** `POST /contributions` checked only the approved domain and that the community existed. `POST /communities/:cid/releases/:rid/contributions` opened the release workbench with `requireCommunityAccess: false` and a hard-coded `canAttachContribution: true`. So **uploading into a private community made the uploader a member of it**, with read access to its whole catalogue. On the add-to-release path, all it took was a release id, and those are sequential.

**Admission conflated membership with consumption.** The only way to admit someone to a private community was `POST /communities/:id/members`, which writes a `Consumer`. ADR-0033 calls writing a `Consumer` "to express 'belongs to this community'" a category error.

## Decision

### 1. `Contributor` mirrors `Consumer`

`Contributor` keeps one row per user (`userId @unique`), drops `communityId`, and gains an m:n `communities` relation (`"CommunityContributors"`). `communityRoleUnion` reads `contributors: { some: { userId } }` on the community side unchanged, and it is now true for every community the member contributes to.

**Rejected: one row per pair** (`@@unique([userId, communityId])`). It would re-point `Contribution.contributorId` on every contribution to a per-community row, which changes values the contract already returns and makes the data repair far riskier. Mirroring `Consumer` keeps every `contributorId` and `_ReleaseContributors` link valid as it stands.

### 2. An upload requires membership, and a refusal is a 404

Both upload paths call `hasCommunityAccess` before writing anything. The gate lives in the module functions (`createContributionSubmission`, `addContributionToRelease`), because those are the only doors.

A refusal is the same `null`, and so the same 404, that each path already returned for a missing community or release. The add-to-release caller names a release id, which is search-shaped under ADR-0036 §5: a 403 would confirm that the probed id is real and private. The create caller names a community id, where `assertCommunityAccess`'s 403 would strictly be allowed. It gets the 404 too, because that costs nothing and keeps the two doors alike.

**Nothing that can answer differently runs before the gate.** The add-to-release path checked for a duplicate file format before any membership check, answering 409. A non-member could therefore probe release ids against a community that refuses duplicates, and a 409 confirmed that a private release existed and which file types it held. The security review of this change found it. The workbench now loads the release bound to both ids and runs the same gate first, so the 409 is reachable only by a member.

### 3. An upload records the role; it is never the way in

Both writers share one helper that upserts on `userId` and **connects** the community. It never moves or drops another community. Uploading to an open community records the role there too.

### 4. A curator admits a member as a consumer or a contributor

`POST /communities/:id/members` takes `role: 'consumer' | 'contributor'`, defaulting to `consumer` so a caller that sends no role sees no change. `DELETE /communities/:id/members/:userId` removes the member from **both** relations, in one transaction, and answers 404 only when they hold neither. This extends ADR-0033 §5 rather than breaking it: consumer and contributor are both membership roles, while curator and leader still refuse with 409 and go through their own routes.

`addMemberSchema` carries `role`. The curators route, which has no role to choose, gets its own `addCuratorSchema`; until this change the two routes shared one `{ userId }` schema.

### 5. The data repair keeps every membership a member could have had

The migration builds the join table **before** dropping the column, from two sources unioned together:

1. each contribution's release community, keyed by the uploader (a release with no community grants nothing);
2. the old `communityId`, so no current membership is lost.

Past uploads into a private community by a non-member cannot be told apart from legitimate ones, because nothing checked. They are kept as memberships for curators to review on the roster. The alternative, starting with no contributor memberships and making curators re-admit everyone, breaks every legitimate contributor on every deployment in order to catch escalations that may never have happened.

The repair was verified on a throwaway database seeded in the pre-migration shape. A member whose column had moved to B got A back from their contributions, a duplicate pair was deduped, a community-less release granted nothing, and a column-only member kept their community.

## Consequences

- **The escalation is closed.** Nobody becomes a member of a private community by uploading to it.
- **Uploading no longer costs a member their other communities.** After this change, a member loses access to their own contribution only when a curator removes them or a community closes. #700 re-asks its owner-exception question on that basis.
- **The contract gains `role`** on `POST /communities/{id}/members`, and a 404 description on both upload routes. No status code is new. stellar-ui pairs as [stellar-ui#373](https://github.com/orphic-inc/stellar-ui/issues/373): a role picker, and the upload refusal.
- **Everything that reads membership gets the corrected set** with an unchanged shape: the roster, the search and browse counts, and the ADR-0030 membership projection to korin, which reconciles on its next full sync.
- **Existing escalations persist** as memberships until a curator removes them. This is accepted, and recorded here so the reason survives.
- **The dev generator and e2e fixtures** move to the relation. The generator had the same first-community-only bug.
