# Use granular permission checks; do not introduce role convenience functions

**Status:** Accepted (2026-05-27). Enforced — `isModerator`/`isStaffUser` were removed from all call sites and no role helper exists in the tree; `src/middleware/permissions.ts` exports only permission-named gates.

Stellar has a per-permission system where each user rank stores an explicit map of
granted permissions (e.g. `forums_moderate`, `reports_manage`, `staff_inbox_manage`).
We deliberately do not expose named role checks like `isModerator()` or `isStaffUser()`
at call sites.

Before granular permissions existed, convenience functions (`isModerator`,
`isStaffUser`) were introduced as shorthand. These caused cross-domain permission
bleed: a user with only `forums_moderate` inadvertently satisfied the `reports_manage`
gate because both were collapsed into the same role check. Each call site should name
the exact permission it requires. Use `requirePermission('X')` as route middleware, or
`hasPermission(await loadPermissions(req, res), 'X')` for inline branching.

The `admin` permission is the one universal override and is already handled
transparently by `hasPermission` — callers never need to check for it explicitly.
