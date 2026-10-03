# Staff act on an invite subtree through a preview and a bound count

**Status: Accepted (2026-10-03).** Decided in the grill on [#639](https://github.com/orphic-inc/stellar-api/issues/639). It sets the posture for a staff action that touches many members at once, as distinct from the unattended sweeps [ADR-0038](0038-inactivity-is-a-clock-not-a-timestamp.md) §4 caps.

## Context

The invite tree exists so that a member answers for their invitees. Since [#633](https://github.com/orphic-inc/stellar-api/issues/633), registration records each edge, and `modules/inviteSubtreeWalk.ts` walks a member's descendants with a depth limit of 50. But staff could act only on one member at a time: a note, a disable, or revoking invite privileges ([#636](https://github.com/orphic-inc/stellar-api/issues/636)), each through its own route.

When a chain turns out to be a ring, such as sold invites or a sockpuppet farm, the whole chain needs the same action at once. The legacy implementation had a staff tool for this. It took a member and a mandatory comment, then noted, disabled, or revoked invites for every descendant. It had no preview, no cap, no undo and no audit beyond the note, and any one of four unrelated permissions let staff use it.

Contagion ([ADR-0004](0004-standing-warnings-bans.md) §3) does not cover this. It scores suspicion and takes no action, its infected source is `banDate`, which nothing writes while [#634](https://github.com/orphic-inc/stellar-api/issues/634) is on hold, and it lives inside CRS, whose future is open.

## Decision

1. **Three actions, on descendants only.** `note`, `disable` and `revoke_invites`, applied to every member below the root, not to the root itself. Staff reach the tool from the root, whom the single-member routes already cover. Every action writes a `UserModerationNote` with the reason on each descendant, so each account's own history says why it changed.
2. **A preview, then an apply bound to it.** `GET /users/{id}/invite-subtree/preview` returns the members and their count. `POST /users/{id}/invite-subtree/action` carries the previewed count as `expectedCount` and answers `409` when the subtree's size no longer matches. Nothing is applied that staff did not see.
3. **No count cap.** ADR-0038's cap bounds a _rule_ misjudging at scale, unattended. Here a person has read the exact count and confirmed it, and `expectedCount` holds the apply to it. A cap would leave a ring half handled: some members cut off, the rest still in, and staff working out who is left. The walk's depth limit still bounds a corrupt tree.
4. **All or nothing.** One transaction per run.
5. **Audited per member and per run.** A member the action changes gets the same audit row the single-member route writes (`user.disabled`, `user.can_invite_changed`), with `subtreeRootId` in its metadata, so readers of a member's history need no special case. The root gets one `user.invite_subtree_action` row with `{ action, reason, count, userIds }`, listing exactly the ids the run changed. A member already in the target state gets the note, but no write and no audit row.
6. **No bulk undo.** The run row keeps the changed ids, so one can be added later. Building it now would have to settle what to do about members changed again since, and about seats ([ADR-0040](0040-capacity-is-counted-in-enabled-seats.md)) on a full site.
7. **No escalation through the tool** ([ADR-0001](0001-granular-permission-checks.md)). The preview needs `invites_manage`. The apply needs `invites_manage` plus the single-member action's own permission: `users_edit` to note, `users_disable` to disable, `invites_edit` to revoke. Nobody can do to many members what they cannot do to one.
8. **One disable write.** `POST /users/{id}/disable` and a subtree run both disable through `modules/accountDisable.ts`, which writes `disabled: true` and the audit row and nothing else. Whatever #634 decides about `banDate` changes that one function.
9. **No messages.** Affected members are not told. A disabled member learns at sign-in, as from a single disable. A ring under investigation is the group least worth warning.

## Consequences

- While #634 stays undecided, a member disabled by a run reaches no `hammer` standing and seeds no Contagion, exactly like a member disabled singly.
- `POST /users/{id}/disable` no longer reads before it writes: its write matching no row is the `404`. That closes the read-then-write race #564 guarded with a `P2025` catch.
- A future bulk staff action should follow decisions 2, 3, 5 and 7, or record why not.

## Alternatives rejected

- **Close as not planned.** Staff would handle a ring one member and one route at a time, at exactly the moment speed matters.
- **Include the root, or offer it as a checkbox.** It buries the most considered decision inside a loop, and makes the blast radius depend on a checkbox.
- **A cap with a refusal above it.** See decision 3.
- **One dedicated permission.** Simpler to grant, but its holders could disable accounts without `users_disable`.
- **An optional message to each member.** It's a bulk messaging path to defend, and it warns the ring.
