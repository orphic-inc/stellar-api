# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Stellar API — a Node.js/Express/TypeScript REST API with PostgreSQL (via Prisma ORM) and JWT authentication. Early-stage (v0.1.0) media platform backend supporting communities, releases, artists, contributions, and user management.

## Commands

- `npm start` — run the server (ts-node)
- `npm run dev` — run with nodemon auto-reload
- `npm run build` — compile TypeScript (`tsc`)
- `npm run watch` — compile in watch mode
- `npx prisma generate` — regenerate Prisma client after schema changes
- `npx prisma migrate dev` — create/apply database migrations
- `npx prisma db push` — push schema changes without migrations

No test framework is configured yet. tsconfig excludes `*.spec.ts` files in preparation.

## Architecture

**Entry point:** `src/index.ts` — Express app setup, route mounting, error handler.

**`src/modules/`** — shared infrastructure:
- `config.ts` — exports `auth`, `logging`, `http` objects from `STELLAR_*` env vars
- `logging.ts` — Winston logger factory (`getLogger(category)`) with per-category caching
- `asyncHandler.ts` — wraps async route handlers with 10s timeout and error handling

**`src/routes/api/`** — Express route modules mounted under `/api`. Currently only `user.ts` (registration with bcrypt hashing, Gravatar, JWT issuance).

**`prisma/schema.prisma`** — PostgreSQL schema. Key models: User, Community, Release, Artist, Contribution, Contributor, Consumer, Tag, Invite. Some models are stubs (Profile, UserSettings, UserRank).

## Environment

Copy `.env.default` to `.env`. Key variables:

| Variable | Purpose |
|---|---|
| `STELLAR_PSQL_URI` | PostgreSQL connection string |
| `STELLAR_AUTH_JWT_SECRET` | JWT signing secret |
| `STELLAR_HTTP_PORT` | Server port (default 8080) |
| `STELLAR_HTTP_CORS_ORIGIN` | Allowed CORS origin |
| `STELLAR_LOG_LEVEL` | Winston log level (default "info") |

## Code Style

- ESLint + Prettier enforced via Husky pre-commit hook (lint-staged on `.js` files)
- Prettier: single quotes, no trailing commas
- 2-space indentation (editorconfig)
- TypeScript strict mode, ESNext target, NodeNext module resolution
