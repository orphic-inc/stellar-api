## Agent Documentation

> Human contributors: start at [docs/README.md](README.md) (architecture, environment reference, "add a module" guide) and the root [README.md](../README.md) / [CONTRIBUTING.md](../CONTRIBUTING.md). This page is the map for AI coding agents.

## Documentation Map

| Document                     | Purpose                                            |
| ---------------------------- | -------------------------------------------------- |
| AGENTS.md                    | Repository workflow, architecture, coding patterns |
| CONTEXT.md                   | Current project/domain context                     |
| docs/adr/                    | Architectural decision records                     |
| docs/agents/issue-tracker.md | GitHub issue workflow                              |
| docs/agents/triage-labels.md | Standard label definitions                         |
| docs/agents/domain.md        | Domain-specific guidance                           |
| CODE_OF_CONDUCT.md           | Stellar Golden Rules — canonical behavioral prose  |

## Introduction

Salutations! This in-progress document contains guidance for developing and maintaining Stellar.

## Prose conventions

Documentation and user-facing copy follow a few house rules:

- **No pleonasm.** Cut redundant phrasing — "greetings and salutations" says one thing twice; "salutations" alone does the job.
- **Plain over ceremonial.** Prefer the shorter, plainer wording; trim filler greetings and throat-clearing.
- **Consistent voice across branches.** When the same copy lives on more than one branch, align it rather than letting phrasings drift.

## Connecting to the Database

To connect to the production Stellar database, you need Google Cloud SQL Proxy and IAM access for a service account with the Cloud SQL Client role.

Use this service account's JSON file as the environment variable for `GOOGLE_APPLICATION_CREDENTIALS`.

### Issue tracker

Issues live in GitHub Issues at `orphic-inc/stellar-api`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
