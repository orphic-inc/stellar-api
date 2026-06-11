# Fork-model multi-repo workflow + dependency-bump discipline

**Status: Accepted — branch model superseded by [ADR-0010](0010-trunk-based-single-branch-workflow.md) (2026-06-11).** The fork-remote model and dependency-bump discipline below remain in force; the `develop`/`staging`/`main` promotion model (the "Branches — `develop` is the integration trunk" section) is retired in favour of a single `main` trunk.

Stellar is three repos developed in lockstep — `stellar-api`, `stellar-ui`, `stellar-compose`. Two recurring failure modes motivated pinning the workflow: (1) **remote/clone ambiguity** — parallel clone-sets where `origin` meant the fork in one and the org in another, so `origin/develop` was ambiguous; and (2) a **dependency bump that "transcended the whole tree"** (the prisma6/openssl3 upgrade entangled schema regen, the Docker base image, and migrations with unrelated feature work).

## Decision

### Remotes — fork model, everywhere

- `origin` = your personal fork (`obrien-k/stellar-*`); `upstream` = `orphic-inc/stellar-*` (canonical).
- Never push to `upstream`; PRs go **fork → upstream**. One clone-set per repo (the fork clones); direct `origin=orphic` clones are retired to kill the ambiguity.
- Helper aliases (see `CONTRIBUTING.md`): `git sync`, `git feature <name>`, `git publish`, `git opr`, `git remotes`, `git wire-upstream`.

### Branches — `develop` is the integration trunk

- `develop` = integration (the PR target). `staging` = pre-prod promotion. `main` = released.
- Promotion flows **up** (develop → staging → main).
- **`main` must never run ahead of `develop`.** If a hotfix lands on `main`, back-merge to `develop` immediately. (Backwards drift here has bitten repeatedly — see the develop↔main reconciliations.)
- Linear history on `develop` (rebase-only). **Cut feature branches from `develop`, not `main`** — branches cut from `main` carry release/squash-promote baggage and re-detonate merge conflicts on rebase.

### Dependency / version bumps — isolate, pin, ADR

The prisma6 bump spread because it rode along with feature work. Going forward a major dependency or runtime bump is:

- its **own** branch/PR, isolated from feature work;
- **pinned** (exact version + base image), with the decision recorded as an ADR (e.g. the prisma6/OpenSSL pin ADR in `stellar-compose`);
- atomic with the regen/migration it forces (the bump and its `prisma generate`/migration land together — never split, never entangled with unrelated features).

## Consequences

- `git sync` before every feature keeps forks current; drift is caught early instead of accumulating into a multi-branch sprawl.
- Cross-repo changes (API contract → UI types → compose) coordinate through the shared `CONTRIBUTING.md` getting-started.
- The current branch sprawl is a one-time reconciliation sweep (Mr. Robot); this discipline is what stops it recurring.
