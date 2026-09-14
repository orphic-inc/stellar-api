# Every account has an invite-tree row

**Status: Accepted (2026-09-14).** Accepted as the gate on [#633](https://github.com/orphic-inc/stellar-api/issues/633), whose implementation follows this contract, the posture [ADR-0041](0041-an-invite-lapses-and-is-returned.md) took on #627. It records the decisions from the grill on that issue, [recorded on the issue](https://github.com/orphic-inc/stellar-api/issues/633#issuecomment-5672128601).

## Context

**Nothing wrote `InviteTree`.** `registerUser` marked an invite `accepted` but recorded no edge. The only writers were the devTools generator, the e2e seed and tests, so on a real instance every reader of the table read nothing:

- the CRS `invite` dimension (`reputation.ts`);
- Contagion's walk up the tree (ADR-0004 §3);
- the member subtree view;
- the staff invite-tree list.

Seeded dev data hid it.

**`Invite` has no link to the user who accepted it**, only `email`. Four facts make the link recoverable anyway:

- `changeEmail` is the only writer of `User.email`.
- It has written a `UserEmailHistory` row (`oldEmail`, `newEmail`) since the commit that introduced it.
- An `accepted` invite is never reused (ADR-0041 §5 reuses only lapsed rows).
- `Invite.createdAt` is the exact send time. Before ADR-0041, `expires` was always the send time plus 30 days, and its migration recovered `createdAt` from that.

The legacy implementation wrote the relationship at registration too, as a plain inviter column plus a pre-ordered tree row. It gave members nobody invited no tree row.

## Decision

### 1. `InviteTree` is the source of truth, written at registration

Invite registration nests `inviteTree: { create: { inviterId } }` into the `user.create` that runs inside the registration transaction. `inviterId` comes from the invite row the pre-check read. The accept claim that follows (ADR-0041 §3) guarantees it is the same row, because a reused row has a new key and the old key's claim fails. A lost claim rolls the edge back with the user.

Replacing the table with `Invite.inviteeId` was rejected. Every reader, both recursive walks, the generator, the seed and the staff list's response shape would have been rewritten, for a relationship `InviteTree` already stores and indexes. Deriving the tree at read time by email was rejected because every level of every walk would repeat the email-history reconstruction.

### 2. Every account has exactly one row

A member nobody invited has a row with `inviterId: null`. That covers open registration, staff `createUser`, `/install`'s founding SysOp and the System user. So "no row" can only mean corrupt data, never "not invited".

This departs from the legacy implementation, and it is the stronger invariant. The cost is that the staff list now has to filter (Decision 5), and every account-creation path has to remember the row (Decision 3).

### 3. The rule is enforced in TypeScript, by a structural spec

All six `user.create` sites nest the row: `registerUser`, `createUser`, `/install`, `seedSystemUser`, the devTools generator and `seed-e2e-users.ts`.

`src/userCreateInviteTree.spec.ts` parses `src/` and `prisma/` with the TypeScript compiler API and fails on:

- any `user.create` whose `data` has no `inviteTree` key;
- any `user.upsert` whose `create` has none;
- any `user.createMany`, which cannot nest a relation.

A `data` passed as a variable or built from a spread alone fails as unverifiable rather than passing. It reports file and line. Before it was trusted, it was tried against spreads, variables, element access, `upsert` and `createMany`, and removing the row from two real sites made it name both.

Two alternatives were rejected:

- **A Postgres trigger.** It covers every path, but it would put the behaviour outside TypeScript. `schema.prisma` would not show it, `migrate diff` could not verify it, and it would be the repo's first trigger.
- **A reconcile job.** It only makes the rule hold eventually, so a reader could see a gap.

The spec cannot see a `user` delegate reached through an alias. Nothing in the tree does that.

### 4. The migration backfills every existing account

One `INSERT … SELECT` gives every user without a row a row, dated at their `dateRegistered`. Rows that already exist are left alone, and running it twice is a no-op.

A member's **registration email** is the `oldEmail` of their earliest history row, or their current email if they have no history. Their inviter is the inviter of the `accepted` invite to that address, under three conditions:

- the member is **not the inviter**;
- the member registered **at or after** the invite's `createdAt`;
- among the members left, the **earliest** registrant wins.

"Earliest registrant with that email" alone is wrong. Suppose member U registers address x openly, changes email, then invites x, and C accepts. Both U and C have x as their registration email, and "earliest" records U as having invited themselves.

For well-formed data the time bound already excludes the inviter, since an inviter exists before their invite. The self exclusion stays for rows whose `createdAt` cannot be trusted, such as devTools invites written with `expires: now`.

The rule is tested by running the migration's own SQL against seeded cases in `inviteTreeEdge.integration.ts`:

- a changed email;
- the self-invite collision;
- an earlier holder of the address;
- an existing row;
- an accepted invite nobody matches;
- a member nobody invited.

Removing the history lookup, the self exclusion, the time bound or the existing-row guard each fails that suite.

### 5. The staff list shows relationships, not the membership

`GET /users/invite-tree` lists rows with an inviter by default, so the page and its `total` still mean "who invited whom". An optional `all=true` includes every row. The response shape is unchanged. The query value is parsed from the literal strings, because `z.coerce.boolean()` reads `"false"` as true.

## Consequences

**CRS moves on deploy.** The backfill hands pre-existing inviters their direct invitees in one step, so the `invite` dimension can jump and `crsHistory` will show it. Contagion stays inert, since nothing sets `banDate` ([#634](https://github.com/orphic-inc/stellar-api/issues/634)).

**The generator and the e2e seed link rather than create.** Their users are born with a null row, so the invite chain is an `update` (generator) or an `upsert` (seed).

**A new account-creation path has one more thing to write**, and CI names the line when it does not.

This unblocks [#638](https://github.com/orphic-inc/stellar-api/issues/638) (showing who invited whom) and [#639](https://github.com/orphic-inc/stellar-api/issues/639) (actions on a subtree), and gives [#625](https://github.com/orphic-inc/stellar-api/issues/625) real genealogy to reason about.
