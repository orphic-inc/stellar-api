# Module writes meet the same constraint-guard rule as routes

**Status: Accepted (2026-09-29).** Accepted as the gate on [#596](https://github.com/orphic-inc/stellar-api/issues/596). It records the [2026-09-11 grill](https://github.com/orphic-inc/stellar-api/issues/596#issuecomment-5637740340) and its [2026-09-28 follow-up](https://github.com/orphic-inc/stellar-api/issues/596#issuecomment-5882190645). Amended 2026-09-29: Decision 4 gains a fourth job policy and classifies every job ([outcome](https://github.com/orphic-inc/stellar-api/issues/596#issuecomment-5889229216)). It is also the record #564's rule never had: until now the rule lived only in `AGENTS.md`.

## Context

The global error handler in `app.ts` is `err.statusCode ?? 500`, and it maps no Prisma error code. So a Prisma write that violates a constraint reports a client mistake as a server error. #564 made that a rule with two arms, a shared helper and a gate:

- **Arm A:** `create` / `upsert` on a model owning a foreign key or a `@unique`. The codes are P2003 / P2002.
- **Arm B:** `update` / `delete` addressed by id, on **every** model. The code is P2025: a missing row throws whatever the model carries.
- **Helper:** `translatePrismaError` in `lib/prismaErrors.ts` catches the code and throws an `AppError` with the right status.
- **Gate:** `npm run prisma:guard-coverage` finds each write structurally and fails on an unguarded one. `prisma-guard-coverage-baseline.json` is its ratchet: `unreviewed` only shrinks, and `internallyDerived` records a site whose ids cannot dangle, with the reason.

Only `src/routes/` was gated, and that reached zero unreviewed. The reason modules were left out was real. A route can see where an id came from, a path or a body, but a module receives it as a function argument. So arm A's precondition, a client-supplied id, is not decidable in a module without call-graph analysis.

Measured on 2026-09-28, `src/modules/` and `src/lib/` held **306 unguarded sites**. 100 of them are in `src/modules/devTools/`. The remaining **206** split as 96 arm A and 110 arm B, across 44 files. The count rose by twelve in two days while the question was open, from new work, with nothing to stop it.

Three further facts shaped the decision:

- **Arm B needs no origin at all.** A missing row throws whoever supplied the id. More than half the remainder is decidable without the analysis that kept modules out.
- **Background jobs call modules with no request in the stack.** An `AppError(404)` is exactly as fatal to a job as the raw P2025. The HTTP remedy is incomplete there, but not wrong: 10 of the 14 job-reachable sites are route-reachable too, and the translation serves that path.
- **The jobs already run several different per-item failure policies,** most of them deliberate. A syntax rule such as "a `try` in every job loop" would be wrong for at least one of them.

## Decision

### 1. The gate covers routes, modules and lib, under one rule

`GATED` in `scripts/check-prisma-guard-coverage.ts` is `['routes', 'modules', 'lib']`. Both arms apply in every area.

A module site whose constrained ids cannot dangle goes in `internallyDerived`, with the reason, exactly as a route's does. The first entry is `lib/audit.ts`: every caller passes `req.user.id`, the resolved system actor, or the subject's own id as that actor's fallback.

A baseline entry whose site the gate does not cover fails as stale. Narrowing `GATED` back to routes therefore fails on every module entry, rather than passing because each still matches a live site.

The rule is not relaxed for modules and not split by caller. A per-site classification by who calls the function was considered and rejected. Reachability is not binary: most job-reachable sites are also route-reachable, so the classification would mostly answer "both" and add a call graph to keep correct.

### 2. `src/modules/devTools/` is outside the gate, by path

The dev-only content factory's router mounts only when `NODE_ENV !== 'production'`, and every endpoint re-checks at runtime. None of its writes serves a production request.

It is excluded in one place: `DEV_ONLY_PREFIXES` in `lib/prismaGuardCoverage.ts`, with that reason beside it. It is not excluded by baseline entries, which would be about 100 lines each restating the same reason. The checker still counts it and reports the count.

### 3. The backlog starts in `unreviewed` and reaches zero by v0.11.0

The existing sites go into `unreviewed` when this lands: 205, plus the one `internallyDerived` entry. From then on, a new unguarded site anywhere in the gated areas fails CI. That stops the growth before the burn-down starts.

The commitment:

- **Zero `unreviewed` by the v0.11.0 cut.** 1.0 is not scheduled, so a 1.0 deadline would bind nothing.
- **The work happens one file per pull request,** each a sub-issue of #596, starting with `forum.ts` (34) and `requestLifecycle.ts` (26).
  - `auth.ts`, `downloads.ts` and `ratioPolicy.ts` are on the high-risk list in `AGENTS.md`. They get small changes and close review, not a sweep.
  - `bootstrap.ts` is seed code reached through `/install`. It is in scope, but several of its sites likely belong in `internallyDerived` rather than earning guards.
- **Every release cut records the count** (`docs/runbooks/release.md`), and a cut where it did not fall is called out in its pull request.
- **Rejected: clearing a file's entries on any change to it.** It would force a one-line fix in a high-risk module to guard nine or more unrelated sites in the same change.

### 4. A job's per-item failure policy is pinned by a spec, not a checker

Every `*Job.ts` gets a spec that makes one item fail and asserts the job's declared policy held. There are four policies. The fourth was added on 2026-09-29, when the last five jobs were read ([recorded on the issue](https://github.com/orphic-inc/stellar-api/issues/596#issuecomment-5889229216)):

| Policy                                                                                                                                      | Jobs                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stop at the failure, retry from there next cycle:** at-least-once and in order, where order matters                                       | `announceJob`                                                                                                                                         |
| **Catch, log, continue:** each item is independent                                                                                          | `membershipJob`, `ratioPolicyJob`, `inviteExpiryJob`, `remoteImageJob`, `linkHealthJob`, and, since PR #749, `inactivityJob` and `rankProgressionJob` |
| **Set-based writes:** no single item can fail alone, so aborting on an outage is safe. Independent tasks in one cycle are caught separately | `inviteGrantJob`, `assetSweepJob`, `donorExpiryJob`, `statsJob`                                                                                       |
| **One unit per cycle, and a failure keeps the last good state**                                                                             | `ircJob`                                                                                                                                              |

What each spec pins:

- **`inviteGrantJob`:** the grant and its clock move in one write, so a member a failed batch did not reach is granted next run: never twice, never lost.
- **`donorExpiryJob`:** it deletes by condition, not by a list read earlier, so a failed run is safe to repeat.
- **`ircJob`:** it writes nothing to the database. A failed or non-200 poll leaves the cached metrics in place, so a korin outage does not blank anyone's IRC reputation dimension.

`inactivityJob` and `rankProgressionJob` used to abort the whole cycle on one failure, with no deliberate policy behind it. [PR #749](https://github.com/orphic-inc/stellar-api/pull/749) moved both to catch, log, continue before this gate landed.

Reading the last five jobs found a third case. `statsJob`'s reputation snapshot (`captureCrsSnapshots`) read every active user through one `Promise.all`. One user's failed read therefore lost the period's snapshot for everyone, and skipped the retention prune. It now skips only that user, like the sweeps.

A job fitting none of the four is a decision to make, not a spec to write.

## Consequences

- **A new write in a module must be guarded,** or recorded as internally derived with a reason, before it merges. The recipe is in `AGENTS.md`.
- **The `try` goes where the write is.** The checker finds guards structurally, so a catch in a calling route does not clear a module site. In a module the translation throws an `AppError`, which a route caller surfaces correctly. A job caller still needs its own policy (Decision 4).
- **`unreviewed` reopens at 205** after routes burned theirs to zero. Stale-entry detection stops rot, but only the commitment in Decision 3 stops 205 becoming the new normal.
- **devTools is unmeasured by the gate.** If any of it ever serves a production request, `DEV_ONLY_PREFIXES` is the line to change, and the change would put about 100 sites in front of the gate.
