# Moderation & messaging surface model: three separate systems; Staff Inbox is one role-dispatched entry

**Status: Accepted.** Records the separation that `/api/messages`, `/api/reports`, and `/api/staff-inbox` already encode, and pins the UI surface to it. Reuses the `staff_inbox_manage` and `reports_manage` gates from [ADR-0001 granular permission checks](0001-granular-permission-checks.md). Resolves a stellar-ui drift in which the staff ticket queue was reachable from two nav entries; captured because the model had never been written down and was re-derived (and mis-derived) more than once.

## Context

Three systems look alike at a glance — each surfaces a list a member or a staffer works through — and had drifted toward each other in the UI even though the API keeps them cleanly apart. They are not the same thing:

| System                     | What it is                                                        | Anchored to                                                   |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| **Personal Messages**      | user ↔ user correspondence                                       | a conversation between members                                |
| **Reports**                | a member flags a piece of **content** for staff                   | a target: a release, forum topic/post, comment, request, etc. |
| **Staff Inbox** (staff PM) | a member asks staff a **generic question** with no content target | a member → staff conversation thread                          |

The API already reflects this: `/api/messages` (PMs), `/api/reports` (content-anchored; `POST /` to file, `/mine`, the staff queue at `/`, `/:id/claim|unclaim|resolve|notes`, `/counts`), and `/api/staff-inbox` (`/tickets` for a member's own vs `/queue` for staff, plus `/responses` canned replies and `/:id/reply|resolve|unresolve|assign`). The staff-PM queue and the reports queue are distinct endpoints over distinct data. There is no data-layer conflation.

The drift lived only in the UI. The staff view of the staff-PM queue had accreted **two** homes: the Staff Inbox entry (which dispatches by permission) and a second, separately-built "Staff Queue" tool — both rendering the identical queue component, which is visually a twin of the reports queue. A staff member opening "Staff Inbox" therefore landed on a moderation queue indistinguishable from Reports, and duplicated by "Staff Queue." The root cause was the absence of a written surface model: each surface was built at a different time against the local code shape, with no single spec to reconcile against.

## Decision

**The three systems are separate surfaces and stay separate.** Reports are content-anchored moderation; Staff Inbox is a generic member→staff channel; Personal Messages are member↔member. They may share a visual queue idiom but never share data, nav, or entry point.

**Staff Inbox is a single, role-dispatched entry** — one nav item for everyone:

- A staffer who can manage the inbox (`staff_inbox_manage`) sees the shared ticket **queue** at Staff Inbox.
- Everyone else sees their **own** member→staff conversations at the same entry.
- There is **no separate "Staff Queue" surface.** The queue _is_ what a manager sees under Staff Inbox. A staffer's own tickets and the queue they manage are the two sides of the one entry, chosen by permission.
- The Staff Inbox unread indicator is role-aware for the same reason: it counts the queue's unanswered tickets for a manager, and the member's own unread otherwise.
- Canned responses, assignment, and resolve/bulk-resolve are affordances _within_ the staff side of Staff Inbox, not a separate destination.

**Reports keep their own surfaces**: a member files/tracks reports from content and under their own reports view; staff triage them in a reports-specific queue gated by `reports_manage`. Reports are never routed through, or visually merged into, Staff Inbox.

**Personal Messages keep their own surface** ("Inbox"), unchanged.

## Consequences

- The duplicate "Staff Queue" nav item and its standalone route/tool are removed; the staff ticket queue and a single ticket are served under the Staff Inbox namespace. A staffer who lacks `staff_inbox_manage` gets their own tickets at Staff Inbox and no queue access, consistent with the gate — an inconsistency in the old dual-gate wiring is also closed.
- Future work on any of the three systems has a written model to build against instead of re-deriving it from whichever surface the author happens to read first.

## Explicitly deferred

- **Staff-class visibility tiering for staff PMs.** A staff-PM conversation could carry a tier that bounds which staff class may see/answer it (e.g. first-line support vs. full moderators), so lower-tier staff see only the subset routed to them. `/api/staff-inbox` does not model this today; it is a scoping decision to grill separately. Assignment and resolve already exist.
- **Visual differentiation of the two queue idioms.** The staff-PM queue and the reports queue remain the same triage-table form. De-twinning them visually (so they never _read_ as the same surface even though they are correctly separate) is a design task, not a structural one.
