# Community leadership: the leader appoints curators, and hands off by offer

**Status: Accepted (2026-10-02).** Decided in the grill on [#219](https://github.com/orphic-inc/stellar-api/issues/219). It builds the succession policy that [ADR-0021](0021-community-leader-role.md) deferred, and replaces the peer-curator model that [ADR-0033](0033-community-membership-and-the-curator-role.md) §5 recorded as unintended.

## Context

ADR-0021 gave a community a single leader pointer, `leaderId`, and kept the leader a curator. It deferred a succession policy by name: handoff with acceptance, and what happens when a leader is disabled.

Until this ADR, the leader held no power a curator lacked. Both curator routes gated on "staff, or any curator", so curators were peers: any curator could add or remove any other. #891 found that this let a curator remove the leader from the curators, and fixed that case alone. Kai then stated the intended model: only a community's leader adds or removes curators.

#892 made the leader clearable. A clear removes the leader's curator role, because a leader cleared without a successor is being demoted. A handoff leaves the outgoing leader a curator.

## Decision

### 1. The leader appoints curators; staff keep the override

`POST /communities/:id/curators` and `DELETE /communities/:id/curators/:userId` pass for `communities_manage` or `admin`, or for this community's leader. A curator who is not the leader gets `403`.

Staff keep the override. An open community may have no leader (#892), and then nobody else could change its curators. Every other community write is already staff's.

Admitting and removing members stays a curator power.

### 2. A curator may step down

`DELETE /:id/curators/:userId` also passes when `userId` is the caller. That is a resignation, not a power over someone else. The leader still gets #891's `409`, removing themselves included: a leader hands off or is cleared first.

### 3. A leader hands off by offer; the successor accepts

The leader offers leadership to one named user. Only when that user accepts does `leaderId` move, and the outgoing leader stays a curator. The successor can decline, and the leader can withdraw. A staff `PUT /communities/:id` still reassigns at once.

Acceptance is required because leadership carries duties, and nobody should have it put on them by another member.

### 4. Offers go to a current curator

The successor must be an enabled curator of the community, and not the leader. A leader who wants a non-curator to succeed appoints them first: two steps, each visible. Nobody can be offered leadership out of the blue.

### 5. One offer at a time, lapsing lazily

The pending offer is two nullable columns on `Community`: `leaderOfferToId` (a foreign key to `User`) and `leaderOfferedAt`. A new offer replaces the old one. The audit log, not a table, holds offer history.

An offer is treated as absent, with no sweep job, when:

- it is more than 7 days old;
- the successor is no longer an enabled curator;
- the leader who made it is no longer the leader, or is disabled.

Accept checks every one of these. Withdraw, decline, accept, and any staff `PUT` that changes `leaderId` clear the offer.

### 6. Notifications for offer, accept and decline

Three `NotificationType` values, each with `page: communities`, `pageId` the community, and `actorId` whoever acted:

- `community_leader_offered` goes to the successor;
- `community_leader_accepted` goes to the outgoing leader;
- `community_leader_declined` goes to the leader who made the offer.

A withdrawal, a lapse and a staff reassign notify no one.

### 7. A disabled leader keeps the pointer

Nothing happens automatically when a leader is disabled. ADR-0021's reason stands: most disables are temporary, and re-enabling restores everything. An offer from a disabled leader lapses (§5). Staff reassign or clear by hand. Nothing alerts them for now.

### 8. The pending offer is shown to its parties

`GET /communities/:id` carries `leaderOffer: { to: { id, username }, offeredAt } | null`. It is non-null only for the leader, the named successor, or a viewer holding `communities_manage`, and only while the offer is live. Other curators see the outcome when `leaderId` changes, not the leader's intent beforehand.

### 9. The flow is audited, and shown elsewhere

Offer, accept, decline and withdraw are audited as `community.leader.offer`, `.accept`, `.decline` and `.withdraw`, alongside the existing `community.leader.set`. A history surface is [#897](https://github.com/orphic-inc/stellar-api/issues/897). No route reads the audit log yet, so serving it is a decision of its own.

## Consequences

- Curator authority ships in [#895](https://github.com/orphic-inc/stellar-api/issues/895): §1 and §2. A curator who is not the leader loses add and remove-other, which is a contract change.
- The handoff ships in [#896](https://github.com/orphic-inc/stellar-api/issues/896): §3 to §8. It needs a migration for the two offer columns and the three notification types.
- stellar-ui follows with stellar-ui#457 and stellar-ui#458.

## Alternatives rejected

- **The leader alone appoints curators, with no staff override.** A leaderless open community would have no way to change its curators.
- **A leader hands off at once, with no acceptance.** It puts leadership on someone without their consent.
- **Staff alone reassign leaders.** A leader would need a Staff PM to step down.
- **Offers to any member, or to any user.** Wider than the need, and it opens a nuisance path.
- **An offer table.** It is only worth having for several offers at once or an offer history. The audit log covers history.
- **A sweep that expires offers.** Invites need one to refund a lapsed invite. An offer has nothing to refund, so a lazy check suffices.
- **Automatic succession on disable**, by clearing or promoting the longest-serving curator. Clearing loses the pointer on a temporary disable, and nothing records curator tenure.
