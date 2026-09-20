# Runbook — cut a release

How a stellar-api version gets from `main` to a published image and a GitHub Release. The pipeline ends at publish ([ADR-0027](../adr/0027-publish-vs-deploy-boundary.md)) — promoting an image into an environment is stellar-compose's job and is deliberately outside this document.

Written because the sequence has a trap that has already cost a failed CI run and a force-push, and until now that lesson lived only in a sweep ledger marked for deletion.

## The ordering trap — read this first

**Bump `package.json`, then regenerate `openapi.json`, then commit.** In that order.

`openapi.json` embeds `info.version`, sourced from `package.json`. Running `npm run openapi:export` _before_ the version bump writes the **old** version into the spec, and the OpenAPI-freshness gate in CI then fails on a one-line diff nobody expects — the change looks unrelated to the release. This is what broke the first CI run on PR #311 during the v0.6.9 cut.

The same applies to any release-adjacent regeneration: the manifest is the source, so it moves first.

## What is automated and what is not

| Step                                                 | Who                                                 |
| ---------------------------------------------------- | --------------------------------------------------- |
| Full gate (lint, types, unit, integration) on the PR | CI — required checks `test` and `integration`       |
| Image build + boot-and-migrate verification          | CI — `smoke`, runs on PRs, **not** a required check |
| GHCR push on a `v*` tag                              | CI — `publish`, skipped on PRs                      |
| GitHub Release from the CHANGELOG section            | CI — `release`, tag-only, `needs: [publish]`        |
| CHANGELOG accuracy                                   | **You.** Nothing checks it — see below              |
| Choosing the version and pushing the tag             | **You**                                             |

## The CHANGELOG is load-bearing output

Since the `release` job landed, the tag's `## [x.y.z]` section **is** the published Release notes. A thin section is no longer a thin file in the repo; it is thin public notes on the surface people see first.

Since #386 a CI gate covers the common case: a PR touching `src/`, `prisma/` or `.github/workflows/` fails unless it also updates `CHANGELOG.md` (escape hatch: the `no-changelog` PR label). That stops the drift that produced 20 unrecorded commits between v0.8.1 and this runbook.

**It is not a substitute for reading the section before a cut.** The gate proves an entry exists; it cannot judge whether the entry is accurate, complete, or written for the person reading the Release notes. It is also `pull_request`-only, so a direct push to `main` bypasses it entirely. `npm run version:check` still never inspects `[Unreleased]` — it compares the top **dated** heading against the manifest. **Still hand-diff `[Unreleased]` against `git log <last-tag>..main` as part of every cut**, now as a review rather than a reconstruction.

If the section for the tag is missing entirely, the `release` job fails rather than publishing an empty Release. That is deliberate: a missing section means the CHANGELOG was not updated, which is worth learning at release time.

## Procedure

1. **Review the CHANGELOG.** `git log v<last>..main --oneline`, and hand-diff against `[Unreleased]`. The #386 gate means entries should already be there — you are checking they read well and cover the work, not writing them from scratch. Verify any `docs/` links resolve — a wrong ADR filename ships as a broken link in the Release notes.
2. **Rename `[Unreleased]`** to `## [x.y.z] — YYYY-MM-DD` and open a fresh empty `[Unreleased]`. Add the compare-link footer entry.
3. **Bump the manifest** — `npm version <x.y.z> --no-git-tag-version` (updates `package.json` and `package-lock.json`).
4. **Regenerate `openapi.json`** — `npm run openapi:export`. Order matters; see the trap above.
5. **Commit all of it together**, then open a PR into `origin/main`.
6. **Verify CI is green**, including the freshness gates (`openapi.json`, `docs/erd.md`) and `version:check`.
7. **Merge**, then tag the merge commit:

   ```bash
   git fetch origin
   git tag -a v<x.y.z> -m "v<x.y.z>" <merge-sha>
   git push origin v<x.y.z>
   ```

8. **Watch the tag run.** It should go `test` + `integration` → `smoke` → `publish` → `release`. Confirm the image is on GHCR and the Release exists with the right notes.

## One remote, and tags go to it

`origin` is `orphic-inc/stellar-api` — the release surface. There is no `upstream`, and no fork remote is configured.

This section used to read "do not push tags to the fork", from when work happened on a personal fork with `upstream` pointing at the organisation. Actions were enabled on that fork, so a `v*` tag pushed to `origin` published a stray image under `ghcr.io/obrien-k/…` and, once the `release` job landed, a Release on the fork as well. The lesson survives the topology that produced it: **a `v*` tag publishes wherever it lands**, so push one only to the remote you mean to release from. If you ever re-add a fork remote, that hazard returns unchanged.

## If something goes wrong

- **Freshness gate fails on a one-line `openapi.json` version diff** — the ordering trap. Regenerate after the bump and amend.
- **`release` fails, `publish` succeeded** — the image is published but the Release is missing. Re-run the job, or create it by hand from the CHANGELOG section; nothing needs reverting.
- **`publish` fails** — no image and, because `release` needs it, no Release. The tag still exists; fix forward and re-run rather than deleting a pushed tag.
