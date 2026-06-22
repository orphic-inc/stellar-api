# Stellar API

[![Codacy Badge](https://app.codacy.com/project/badge/Grade/ddbd8663fbd640aa96f4a89770a387d6)](https://app.codacy.com/gh/orphic-inc/stellar-api/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)

This is the Node.js API backend for **Stellar**, a modern, next-generation community content tracker and forum software.

Stellar is an invite-only (`/private/`) platform built around **Communities** with granular permissions, member contributions, and a **Community Reputation Score (CRS)** that rewards long-term, healthy participation.

## What's here

- **Communities, membership & staff** — invite tree, roles, granular per-permission checks ([ADR-0001](docs/adr/0001-granular-permission-checks.md)).
- **Contributions & releases** — track releases, ratio accounting (contributed/consumed), download cost ledger.
- **Community Reputation Score (CRS)** — composite reputation across social, contribution, donation, and longevity signals ([PRD-01](docs/prd/01-Community-Score.md)); fed by a community-health pulse ([ADR-0002](docs/adr/0002-community-health-pulse.md)).
- **Stylesheets & theming** — built-in + user-authored themes with adoption scoring ([PRD-03](docs/prd/03-stylesheet-themes-and-scoring.md), [ADR-0003](docs/adr/0003-stylesheet-injection-isolation.md)).
- **Link health** — periodic checks on contribution links, flapping detection, staff escalation, stale-link sweep.

## Documentation

The README is the lamp-post; specs and decisions live in [`docs/`](docs/):

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

- **Runtime**: Node.js (LTS)
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Validation**: Zod (with OpenAPI generation)
- **Testing**: Jest & Supertest

## Quick Start

See the [stellar-compose](https://github.com/orphic-inc/stellar-compose) repository for the fastest way to spin up a full instance of Stellar (API, UI, and Database) using Docker.

## Local Development Setup

If you prefer to run the API directly on your local machine for development:

### 1. Prerequisites

- Node.js (LTS version)
- A running PostgreSQL instance

### 2. Installation

```bash
git clone https://github.com/orphic-inc/stellar-api.git
cd stellar-api
npm install
```

### 3. Environment Variables

Copy `.env.example` to `.env` (or create one) and configure the following variables:

| Variable                   | Description                                    | Default                 |
| -------------------------- | ---------------------------------------------- | ----------------------- |
| `DATABASE_URL`             | Prisma connection string to your Postgres DB   | `postgresql://...`      |
| `STELLAR_AUTH_JWT_SECRET`  | Secret for signing JWTs (must be securely set) | _undefined_             |
| `STELLAR_LOG_LEVEL`        | Winston log level (e.g., debug, info, error)   | `info`                  |
| `STELLAR_HTTP_PORT`        | API listening port                             | `8080`                  |
| `STELLAR_HTTP_CORS_ORIGIN` | Allowed CORS origin (usually the UI url)       | `http://localhost:3000` |

### 4. Database Setup

Before running the app, ensure your database schema is initialized and the Prisma Client is generated:

```bash
npx prisma migrate dev
npx prisma generate
```

### 5. Running the API

Start the server in development mode (with hot-reloading):

```bash
npm run dev
```

## Contributing

For the contributor workflow (OpenAPI sync, testing), see [CONTRIBUTING.md](CONTRIBUTING.md).
