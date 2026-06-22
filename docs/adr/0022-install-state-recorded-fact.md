# Install state is a recorded fact, not inferred from rows

**Status: Accepted (2026-06-22).** Reverses the original install-barrier implementation. Relates to [ADR-0001 granular permission checks](0001-granular-permission-checks.md) (the barrier is a lifecycle gate, deliberately kept _out_ of the permission graph). Numbering note: lands alongside the unmerged ADR-0021 (community-leader); 0021 is claimed by that branch, this is the next free number.

## Context

The API gates every `/api/*` route behind an install barrier (503 until setup is complete). The original `isInstalled()` answered "are we installed?" by counting rows — `userRank.count() > 0 && user.count() > 0` — and latching the positive in memory. That is the legacy-installer failure mode: a **lifecycle phase reconstructed from incidental domain data**. It needed the dual-table check only to dodge a false-positive (ranks are seeded automatically, so ranks-alone read installed before any owner existed), and that defensive accretion is the tell — every inference grows special cases.

Install is irreducibly a **data-creating transition**: it mints the first SysOp. So the truth has to live in the database, because only the data can answer "does the owner exist?" — but it must be _recorded_ at the moment it becomes true, not _inferred_ afterward from rows that exist for other reasons. An environment variable cannot own this truth: it asserts a phase the deployment _declares_, which can disagree with the data the moment an operator sets it wrong — reintroducing the same two-sources-disagree bug. Env belongs as a future read-time _override_ (CI, ephemeral test DBs), never as the source of truth.

## Decision

Record one fact, expose it through one typed read-port, decide the barrier as a pure function.

1. **One stored truth: `SiteSettings.installedAt DateTime?`.** `null` = awaiting setup; a timestamp = installed (and carries _when_). It lives on the existing settings singleton (`id: 1`). There is no `phase` enum column and no second flag — a single nullable timestamp is the minimal honest record.

2. **Derived representation, never stored.** `getInstallState()` (`installState.ts`) reads that column and parses it into a Zod discriminated union — `{ phase: 'awaiting_setup' }` | `{ phase: 'installed'; installedAt }`. The `phase` is computed at read time; persisting it would re-create the disagreement we are escaping. "Both" a column and a union is two _layers_ of one truth, not two truths — that distinction is the whole rule: derive, don't store.

3. **The barrier is a pure function.** `gate(state): 'pass' | 'block'` takes the union and returns a decision — no Express, no Prisma — so it is exhaustively table-tested over the variants. The route middleware is a thin adapter; `isInstalled()` is a one-line boolean convenience over `gate(getInstallState())` that keeps the test mock surface a single export.

4. **Positive-only latch.** The read caches only the `installed` result and never the negative. Install is irreversible in normal operation, so the positive is permanent; the pre-install window is transient and re-reads each request until the stamp lands. This means **no explicit cache invalidation is needed** when the transition fires — the absence of a cached negative _is_ the invalidation.

5. **The transition lives where the data is owned.** Stamping `installedAt` is a `SiteSettings` write, so `markInstalled(tx)` is a `settings.ts` helper, called as the final step **inside POST /install's existing SysOp transaction**. `installedAt` therefore commits if and only if the owner does — the barrier can never report installed without an owner. `installState.ts` (the read side) and the install route stay decoupled: neither imports the other, so the lifecycle read and the lifecycle write share only the column.

6. **Env override is a seam, not built.** A future `STELLAR_ASSUME_INSTALLED` would resolve inside `getInstallState()`, derived at read time and never persisted alongside `installedAt`. The single read chokepoint makes it a one-line addition; it is deferred until a real CI/headless need exists.

## Consequences

- The barrier reads one explicit column instead of two `count()` queries, and the dual-table defensive check disappears with the false-positive it guarded against.
- `GET /api/install` reports `installed` from the stamp; its response shape is unchanged (no OpenAPI contract change).
- The barrier stays a pure lifecycle gate, explicitly _not_ a permission — honoring ADR-0001's "no role bleed" by keeping setup-state out of the authz graph entirely.
- A migration adds one nullable column. No backfill: pre-existing installs would read `awaiting_setup` until re-stamped, which is correct for a pre-alpha instance (data is disposable) and avoids fabricating a record nothing confirmed.

## Deferred / out of scope

- **Env `STELLAR_ASSUME_INSTALLED` override** — seam left in `getInstallState()`, unbuilt.
- **User-model tracker-field split** (`ratioWatchDownload`, `UserSettings.paranoia` → a 1:1 satellite) — a separate legacy-shape cleanup, its own ADR/PR.
