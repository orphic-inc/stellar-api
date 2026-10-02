# Product history gets a dedicated log; the audit log stays forensic

**Status: Accepted (2026-10-02).** Decided in the grill on [#897](https://github.com/orphic-inc/stellar-api/issues/897). It applies first to a community's leadership history, the surface [ADR-0053](0053-community-leadership-curator-authority-and-handoff.md) §9 split out.

## Context

Leadership changes are audited as `community.leader.set`, and since [#896](https://github.com/orphic-inc/stellar-api/issues/896) the handoff as `community.leader.offer`, `.accept`, `.decline` and `.withdraw`. Nothing showed them. No route read `AuditLog`: its one reader was `inactivityJob.ts`, which reads a `user.create` row as an internal flag and serves nothing.

`AuditLog` is generic. `action` is a string and `metadata` untyped JSON, there is no index on `(targetType, targetId)`, and nothing prunes it. Its `leader.set` rows are not a clean history either: a staff `PUT /communities/{id}` audits one whenever the body sends `leaderId`, unchanged or not ([#901](https://github.com/orphic-inc/stellar-api/issues/901)).

The codebase already serves one history as product data, from a table of its own: `GroupLog` ([ADR-0023](0023-contribution-package-and-releasegroup-identity.md)), written alongside each release-group change and read by `GET /release-groups/{id}/log`.

## Decision

### 1. No route serves audit rows

The audit log is a forensic record for staff and for the code. A history that a product shows gets a dedicated table, written in the same place as the change it records. An internal read that serves nothing, such as `inactivityJob`'s flag, stays allowed.

Serving audit rows would make every audit action name and metadata shape an api contract, which today change freely. A product read would also parse untyped JSON, and need an index only one feature wants.

### 2. Leadership is the first instance: `CommunityLeadershipEvent`

One row per **change** of a community's leader, with typed columns:

- `communityId`, `kind`, `fromUserId`, `toUserId`, `actorId` and `at`, indexed on `(communityId, at)`;
- `kind` is one of `founded`, `assigned`, `handed_off` and `cleared`.

The table plays the part `GroupLog` plays for release groups, but its rows are typed rather than a pre-rendered sentence. Usernames are joined at read time, so a rename shows the current name, and the ui owns the wording. A row is written only when the leader actually changes: at create, on a staff `PUT`, on an accepted handoff, and when the boot seed creates the site community.

### 3. Changes only: the offer lifecycle stays in the audit log

Offers, declines and withdrawals are not logged. ADR-0053 §8 keeps the leader's intent from other curators, and a readable declined offer would expose it after the fact, along with a public record about the member who declined.

### 4. Anyone who can read the community reads its log

`GET /communities/{id}/leadership-log` is paginated and newest first. It answers `403` and `404` exactly as `GET /communities/{id}` does ([#771](https://github.com/orphic-inc/stellar-api/issues/771)). The current leader is already public on that read, and the log is the same fact over time.

Staff read it only where they can read the community. Whether `communities_manage` reads every community is [#902](https://github.com/orphic-inc/stellar-api/issues/902)'s to decide.

### 5. The actor is shown to staff only

`actor` is served to `communities_manage` and `admin` viewers, and is `null` for everyone else. It names a staff member on `founded`, `assigned` and `cleared`, and on `handed_off` it is always the successor. A reassign can be contentious, and naming the individual moderator to the whole community invites taking it personally. Staff accountability is kept: staff see the actor, and the audit log records it.

### 6. The history is backfilled from the audit log, once

The migration that creates the table derives its rows from existing `community.leader.set` audit rows:

- each row is one event, in `createdAt` order, and a no-op row (`leaderId = previousLeaderId`) is skipped;
- the kind is `founded` when the metadata has no `previousLeaderId`, `cleared` when `leaderId` is null, and `handed_off` when a matching `community.leader.accept` row exists; otherwise it is `assigned`;
- the actor is the audit row's `actorId`.

A community whose earliest leader no audit row explains gets a synthetic `founded` at its `createdAt`, with no actor. That is the boot seed's site community, and fixture communities.

A migration, not a script, because the boot seed is create-only (#882) and a migration needs no operator to remember it.

## Consequences

- Leadership history ships in [#897](https://github.com/orphic-inc/stellar-api/issues/897), and the ui page in stellar-ui#473.
- The next feature that wants a history writes a table, not an audit read. One that wants an audit-backed surface should supersede §1 rather than work around it.
- The audit log keeps every leadership action, including the offer lifecycle and the actor, for staff forensics.

## Alternatives rejected

- **Serve the audit log, adding an index.** Less code now, but it makes audit-as-product-data a pattern, and couples the audit format to the contract.
- **A free-text `info` line, as in `GroupLog`.** That suits a log of heterogeneous events. Leadership has four kinds, and typed rows keep names current and the wording in the ui.
- **Log the offer lifecycle too, perhaps staff-only through a `hidden` flag.** It would expose intent ADR-0053 §8 keeps private, or put forensic detail in a product table.
- **Show the actor to everyone.** Transparent, but it names individual moderators for contentious decisions, and the kind already says staff acted.
- **A tenure table** (one row per leader with start and end). Tenures derive from consecutive events if a surface ever needs them.
