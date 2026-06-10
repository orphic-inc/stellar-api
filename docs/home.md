## Agent Documentation

## Documentation Map

| Document | Purpose |
|----------|---------|
| AGENTS.md | Repository workflow, architecture, coding patterns |
| CONTEXT.md | Current project/domain context |
| docs/adr/ | Architectural decision records |
| docs/agents/issue-tracker.md | GitHub issue workflow |
| docs/agents/triage-labels.md | Standard label definitions |
| docs/agents/domain.md | Domain-specific guidance |

## Introduction

Salutations! This in-progress document contains guidance for developing and maintaining Stellar.

## Connecting to the Database

To connect to the production Stellar database, you need Google Cloud SQL Proxy and IAM access for a service account with the Cloud SQL Client role.

Use this service account's JSON file as the environment variable for `GOOGLE_APPLICATION_CREDENTIALS`.

### Issue tracker

Issues live in GitHub Issues at `orphic-inc/stellar-api`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
