# Trunk-based single-branch workflow

**Status: Accepted (2026-06-11).** Supersedes the _branch-model_ section of [ADR-0009](0009-fork-workflow-and-dependency-discipline.md) (`develop` / `staging` / `main` promotion). The fork-remote model and dependency-bump discipline of ADR-0009 remain in force.

## Context

ADR-0009 pinned a three-tier branch model — `develop` (integration) → `staging` (pre-prod) → `main` (released) — with the rule that _`main` must never run ahead of `develop`_ and a back-merge whenever a hotfix landed on `main`.

In practice that rule kept losing:

- **`main` repeatedly diverged from `develop`.** Direct edits to `main` (releases, hotfixes, web-UI doc churn, a stray `origin=orphic` clone) left `develop` missing content `main` had — and vice-versa. On `stellar-api` the two branches diverged _both_ ways: `main` carried a stylesheet-backend / Gravatar-removal feature `develop` never saw, while `develop` carried 57 commits of music-model remodel `main` lacked.
- **Divergence broke promotion.** Because the histories had drifted, GitHub's rebase-merge could not replay `develop → main` (duplicate commits across the divergence); the v0.5.4 promotion had to be reconciled by hand.
- **Three tiers bought nothing at this scale.** Pre-alpha, with a small set of human + agent contributors, `staging` was perpetually stale (a pointer behind `develop`) and the extra promotion hops added ceremony, not safety. Every Mr. Robot sweep spent its largest block on `main ↔ develop` reconciliation.

The cost of maintaining three long-lived branches exceeded any release-gating benefit they provided.

## Decision

**Collapse to a single trunk: `main`.** `develop` and `staging` are retired (deleted) across the lockstep repos — done for `stellar-api` and `stellar-ui` on 2026-06-11; `stellar-compose` to follow.

- **`main` is the only long-lived branch** and the sole PR target. There is no integration or pre-prod branch.
- **Feature branches are cut from `main`** (not `develop`) on your fork (`origin = obrien-k/stellar-*`) and PR'd **fork → `upstream/main`**, per the unchanged ADR-0009 remote model.
- **Linear history on `main`** (rebase-merge only; no merge commits).
- **`release/*` branches may live on `upstream`** when a release needs staging/coordination; they are short-lived and deleted after the release. This is the one sanctioned exception to "dev branches live on the fork."
- Releases are cut and tagged directly on `main` (semver tags, manual — no release tooling yet).

### Retained from ADR-0009 (still in force)

- **Fork-remote model:** `origin` = personal fork, `upstream` = `orphic-inc` canonical; PRs flow fork → upstream; the ambiguous `origin=orphic` direct clones stay retired.
- **Dependency / version-bump discipline:** major dep/runtime bumps get their own isolated, pinned, ADR-recorded PR, atomic with the regen/migration they force.

## Consequences

- The "`main` must never run ahead of `develop`" rule and the develop→staging→main back-merge dance are **obsolete** — there is nothing for `main` to drift against.
- One-time cost: collapsing the existing divergence required a non-linear **merge commit on `stellar-api` `main`** (`af6a1cf`), pushed past the linear-history rule once as admin. `stellar-ui` folded cleanly as a fast-forward. From here, rebase-merge keeps the trunk linear.
- `CONTRIBUTING.md` and the git helper aliases (`git sync`, `git feature`, `git publish`) that assume a `develop` base must be updated to target `main`. (Tracked as follow-up.)
- Branch protection on `main` keeps: linear history + ≥1 review. The retired `develop`/`staging` protections are gone.
- Simpler mental model for human and agent contributors: one trunk, one PR target, one place a feature can be "in."
