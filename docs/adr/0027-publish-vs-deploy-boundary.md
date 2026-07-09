# ADR-0027: The publish/deploy boundary — GHCR publish is where this repo's pipeline ends

**Status:** Accepted (2026-07-09)
**Date:** 2026-07-09
**Repos:** orphic-inc/stellar-api, orphic-inc/stellar-compose
**Relates:** [ADR-0018 — development lifecycle & the API/UI contract gate](0018-development-lifecycle-and-contract-gate.md)
**Cross-links:** [stellar-compose #10 — migration execution strategy](https://github.com/orphic-inc/stellar-compose/issues/10)

---

## Context

The stellar-api CI chain (`.github/workflows/publish.yml`) runs `test` → `smoke` → `publish`: the full lint/type/unit/integration gate, then a real image build that boots against a fresh Postgres and proves the container self-migrates (asserting rows in `_prisma_migrations`), then a versioned push to GHCR — a `{{version}}` semver tag on `v*` tag pushes and `:latest` on `main`. The chain **ends at publish.** Nothing downstream defines what promotes a published image into a running environment, who is responsible for that promotion, or whether an environment-deploy step belongs in this repo's workflows at all.

This was named the last structural CI/CD gap before v0.7.0 (2026-06-23 backlog review: the GHCR-publish boundary versus an environment deploy step is unscoped and a real pre-0.7.0 decision) but never got recorded. Two facts constrain the answer and were settled before this ADR:

- The image is **self-contained at runtime**: `docker-entrypoint.sh` runs `prisma migrate deploy` before starting the server (#276), so a booted container brings the schema forward on its own. The smoke job exists precisely to keep that property from regressing. The runtime migration question is therefore already answered — this ADR is about the *pipeline* boundary, not the runtime one.
- The **deployment surface is a separate repository** (stellar-compose), which owns the `docker-compose.yml` that references the api image and the environment it runs in. Its open issue #10 covers migration execution *at scale* (the entrypoint-migrate strategy races across replicas; destructive expand→contract migrations, e.g. #98/#73/#74, need sequencing care) — an orchestration concern, not a pipeline one.

The decision is where the line falls between the two repos, because that choice determines whether environment credentials and topology leak into this repo's CI, and whether "deploy" is one responsibility or two.

## Decision

**This repo's pipeline is responsible through publish, and no further. Deployment lives entirely on the stellar-compose / environment side. The handoff artifact is the versioned GHCR image tag.**

Concretely:

- **stellar-api owns** producing a tested, smoke-verified, semantically-versioned image in GHCR. Its responsibility ends the moment `docker/build-push-action` pushes `ghcr.io/orphic-inc/stellar-api:<semver>` (on a `v*` tag) and refreshes `:latest` (on `main`). No stellar-api workflow SSHes into, triggers, or otherwise mutates any running environment. The api repo does not hold environment secrets, hostnames, or production database URLs.
- **stellar-compose owns** promotion: pulling a chosen image tag into an environment, and the migration-execution strategy for that environment (single-instance is covered by the self-migrating entrypoint; the multi-replica and destructive-migration cases are compose #10's remit).
- **The handoff contract** is an explicit semver tag. Production compose pins a specific `:<semver>` — never `:latest` — so a deploy is a reviewable, revertible tag bump in the compose repo, not an implicit consequence of pushing to a branch. `:latest` exists for convenience (local, non-prod) and is deliberately excluded from the promotion path.
- **Expand→contract discipline spans both repos and is a release-sequencing rule, not a pipeline feature.** The api side ships migrations expand-first (a destructive migration never lands in the same release as code that still needs the old shape); the compose side must not drive more than one replica through a destructive migration without the one-shot / init-migrate pattern under discussion in #10. This ADR records the shared obligation; #10 records the mechanism.

## Alternatives considered

**(Rejected) A deploy job in stellar-api's workflows** — a `deploy` job after `publish` that pushes the freshly published image into an environment (SSH + `docker compose pull`, or a webhook to the host). Rejected: it drags environment credentials and topology into the artifact-producing repo, couples the api pipeline to the number and identity of environments (each new environment would edit api CI), and conflates "this image is good" with "this image is now live" — two decisions that want different owners and different review. The self-migrating image means there is nothing a deploy job would need to do that compose can't do at pull time.

**(Rejected) Migrations applied by the pipeline** (compose #10's third option) — already foreclosed by #276: the entrypoint self-migrates, and the smoke job guards it. Re-introducing a pipeline migrate step would create two sources of truth for schema application.

## Consequences

- The v0.7.0 CI/CD picture is complete: build → verify → publish here; pull → promote → run there. No orphaned "who deploys" question remains open in this repo.
- stellar-compose #10 is the sole remaining deploy-side decision (multi-replica migration safety); it is scoped, not blocked by this ADR, and this ADR gives it its boundary.
- A future automated promotion (if wanted) is a stellar-compose concern — e.g. a compose-side workflow that watches for a new semver tag and opens a pin-bump PR — and does not reopen this boundary.
- Because promotion is a tag pin in compose, rollback is a git revert there; the api repo needs no rollback machinery.
