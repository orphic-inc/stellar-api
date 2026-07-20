# Stellar API

[![Codacy Badge](https://app.codacy.com/project/badge/Grade/ddbd8663fbd640aa96f4a89770a387d6)](https://app.codacy.com/gh/orphic-inc/stellar-api/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)

This is the Node.js API backend for **Stellar**, a community content tracker.

Stellar is an invite-only platform built around **Communities** with granular permissions, member contributions, and supporting features. These supporting features include: requests, reporting, extensive moderating tools, and collages. In addition to these community-first focuses, Stellar has community-centric communication tools, a forum, wiki, messaging, and notifications.

## Status: alpha

Stellar is pre-1.0 software (currently 0.8.x). Running a public instance means running an alpha: interfaces and the database schema still change between releases, migrations may be destructive (pre-1.0 carries no backfill guarantees), and no data-durability promises are made yet. Trunk is kept deployable — every merge passes the full CI chain (format, lint, type-checks, unit and integration suites, and a boot-and-migrate container smoke test) — but treat any public deployment as disposable for now. A fresh install starts with registration `closed`; open it deliberately from site settings when you are ready to accept members.

## What's here

- **Communities, membership & staff** — invite tree, roles, granular per-permission checks ([ADR-0001](docs/adr/0001-granular-permission-checks.md)).
- **Contributions & releases** — track releases, ratio accounting (contributed/consumed), download cost ledger.
- **Stylesheets & theming** — built-in + user-authored themes with adoption scoring ([PRD-03](docs/prd/03-stylesheet-themes-and-scoring.md), [ADR-0003](docs/adr/0003-stylesheet-injection-isolation.md)).
- **Link health** — periodic checks on contribution links, flapping detection, staff escalation, stale-link sweep.

## What's deferred

- **Community Reputation Score (CRS)** — composite reputation across social, contribution, donation, and longevity signals ([PRD-01](docs/prd/01-Community-Score.md)); fed by a community-health pulse ([ADR-0002](docs/adr/0002-community-health-pulse.md)).

## Documentation

The README is the lamp-post; the developer guide is **[`docs/README.md`](docs/README.md)** (architecture, environment reference, "add a module" walkthrough), and specs and decisions live in [`docs/`](docs/):

| Doc                                                                                          | Covers                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [PRD-01 — Community-Score / CRS](docs/prd/01-Community-Score.md)                             | reputation model, dimensions, roadmap        |
| [PRD-03 — Stylesheet themes & scoring](docs/prd/03-stylesheet-themes-and-scoring.md)         | themes, author stylesheets, CRS weights      |
| [ADR-0001 — Granular permission checks](docs/adr/0001-granular-permission-checks.md)         | why no role convenience functions            |
| [ADR-0002 — Community-health pulse → CRS](docs/adr/0002-community-health-pulse.md)           | pulse persistence + CRS folding _(proposed)_ |
| [ADR-0003 — Stylesheet injection isolation](docs/adr/0003-stylesheet-injection-isolation.md) | user-CSS sandbox/reset _(proposed)_          |
| [`docs/agents/`](docs/agents/) · [CONTEXT.md](CONTEXT.md) · [AGENTS.md](AGENTS.md)           | domain language, agent/dev guides            |

> PRD numbering: **PRD-01** Community-Score · **PRD-02** IRC & Announce · **PRD-03** Stylesheets · **PRD-04** Contribution/Release/Music · **PRD-05** Rules & Governance · **PRD-06** Ratio.

## Tech Stack

- **Runtime**: Node.js 22
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Validation**: Zod (with OpenAPI generation)
- **Testing**: Jest & Supertest

## Quick Start

See the [stellar-compose](https://github.com/orphic-inc/stellar-compose) repository for the fastest way to spin up a full instance of Stellar (API, UI, and Database) using Docker.

## Local Development Setup

If you prefer to run the API directly on your local machine for development:

### 1. Prerequisites

- **Node.js 22** (see `.nvmrc` / the `engines` field in `package.json`) — `nvm use` picks it up.
- **PostgreSQL 16** running and reachable.

### 2. Installation

```bash
git clone https://github.com/orphic-inc/stellar-api.git
cd stellar-api
npm install
```

### 3. Environment Variables

Copy `.env.default` to `.env` and set at least the database URI and JWT secret:

```bash
cp .env.default .env
```

`.env.default` is self-documenting (grouped, commented) and is the authoritative list. The variables you must set for a local run:

| Variable                   | Description                                            | Example / default                          |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| `STELLAR_PSQL_URI`         | **Prisma connection string** to your Postgres DB       | `postgresql://user:pass@localhost:5432/db` |
| `STELLAR_AUTH_JWT_SECRET`  | Secret for signing JWTs (32+ chars; set to a real one) | `changeme`                                 |
| `STELLAR_HTTP_PORT`        | API listening port                                     | `8080`                                     |
| `STELLAR_HTTP_CORS_ORIGIN` | Allowed CORS origin (usually the UI url)               | `https://stellargra.ph`                    |
| `STELLAR_LOG_LEVEL`        | Winston log level (`debug`/`info`/`error`)             | `info`                                     |

Optional integrations (Sentry, SMTP invites, site identity/Golden-Rules tokens, and the korin.pink IRC sidecar) are all documented inline in `.env.default` and are **inert until their keys are set** — the app runs fine without them. The full variable reference lives in [`docs/README.md`](docs/README.md#environment-reference).

### 4. Database Setup

Apply migrations and generate the Prisma client. `prisma migrate dev` also **auto-runs the seed** (`prisma/seed.ts`), which plants default user ranks, rank-promotion rules, forums, the Golden Rules, the System user, and the built-in stylesheet fixtures — but **no users**:

```bash
npx prisma migrate dev     # applies migrations + seeds defaults
npx prisma generate        # regenerate the client (only needed after schema pulls)
```

After a database reset you can re-run just the seed with `npm run db:seed`.

### 5. Running the API

Start the server in development mode (with hot-reloading):

```bash
npm run dev
```

### 6. Complete the one-time install (required)

A fresh instance has **no admin and is 503-walled** on `/api/*` until you complete the one-time install, which mints the first SysOp ([ADR-0022](docs/adr/0022-install-state-recorded-fact.md)). Do this once:

- **Via the UI** (recommended for a full-stack setup): open `http://localhost:9000/install` with [stellar-ui](https://github.com/orphic-inc/stellar-ui) running, and fill in the first-admin form.
- **Directly against the API**:

  ```bash
  curl -X POST http://localhost:8080/api/install \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","email":"admin@example.com","password":"<a-strong-password>"}'
  ```

The response includes `configWarnings` and a `setupChecklist` flagging launch-readiness gaps (CORS default, SMTP unset, registration still closed, etc.). Registration defaults to `closed` on a fresh instance — switch it to `open` or `invite` via site settings when you are ready to accept members. Until install completes, every other route returns `503`.

## Contributing

New contributors start with **[CONTRIBUTING.md](CONTRIBUTING.md)** (fork workflow, pre-commit gate, OpenAPI sync, testing). For the architecture overview, the full environment reference, and a worked "add a module" guide, see **[`docs/README.md`](docs/README.md)**.
