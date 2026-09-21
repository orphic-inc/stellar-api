# Stellar API — Developer Documentation

The human entry point for developing and operating the Stellar API. Start here after the root [README.md](../README.md) (install & run) and [CONTRIBUTING.md](../CONTRIBUTING.md) (workflow & gates). [`AGENTS.md`](../AGENTS.md) at the repo root is the canonical agent-instruction file and carries the exhaustive reference — the full module/route inventory, the established patterns, the commit and merge discipline. `CLAUDE.md` is a one-line `@import` of it and holds no content of its own. This document is the human-facing orientation; where the two overlap, `AGENTS.md` is the more detailed of the pair.

## Where things live

| You want to…                                                  | Read                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Install and run locally                                       | [root README](../README.md)                                                                             |
| Contribute (fork model, pre-commit gate, OpenAPI sync, tests) | [CONTRIBUTING.md](../CONTRIBUTING.md)                                                                   |
| Understand the architecture                                   | [Architecture](#architecture) (below)                                                                   |
| Configure the app                                             | [Environment reference](#environment-reference) (below)                                                 |
| Add a feature                                                 | [Adding a module or route](#adding-a-module-or-route) (below)                                           |
| Understand a design decision                                  | [`adr/`](adr/) — Architecture Decision Records                                                          |
| Understand a product requirement                              | [`prd/`](prd/) — 10 Product Requirement Docs                                                            |
| Deploy / operate the whole stack                              | [stellar-compose](https://github.com/orphic-inc/stellar-compose) (operator runbook + constellation map) |
| Agent/domain conventions                                      | [`agents/`](agents/) · [CONTEXT.md](../CONTEXT.md) · [CONTEXT-MAP.md](../CONTEXT-MAP.md)                |

The four-repo constellation — this API, [stellar-ui](https://github.com/orphic-inc/stellar-ui) (frontend), [stellar-compose](https://github.com/orphic-inc/stellar-compose) (deployment), and the external [korin.pink](https://github.com/obrien-k/korin-pink) (optional IRC-metrics sidecar) — is mapped in [CONTEXT-MAP.md](../CONTEXT-MAP.md). The single "stand up the whole thing" doc lives in stellar-compose.

## Architecture

Node.js / Express / TypeScript REST API with PostgreSQL (Prisma ORM) and JWT cookie auth. Every route lives under `/api/*`. The layering is strict: **routes do HTTP; modules do business logic; schemas validate.**

```
src/
  index.ts            Thin bootstrap — starts the HTTP server
  app.ts              createApp() factory — Express setup, route mounting, error handler (testable)
  routes/api/         HTTP layer only: auth, validation, response shape. One file per domain.
  modules/            Business logic: DB queries, transactions, domain rules. One file per domain.
  schemas/            Zod schemas + inferred types, one file per domain.
  middleware/         auth (JWT→req.user), permissions, rateLimiter, validate, serviceAuth
  lib/                prisma singleton, audit, AppError, pagination, sanitize, openapi contract
  types/              Generated OpenAPI types + req.user augmentation
  test/               Supertest harness, factories, DB helpers
  integration/        Integration tests against a real DB (.env.test)
```

- **Routes → Modules → DB.** A route handler validates input, calls a module, and shapes the response. It never runs raw business logic. Business rules, transactions, and Prisma access live in `src/modules/<domain>.ts`.
- **Validation is mandatory on mutating routes.** `validate(schema)` / `validateParams(schema)` run before the handler; read the parsed value with `parsedBody<T>(res)` / `parsedParams<T>(res)`. Use `z.coerce` for numeric path params — never hand-rolled `parseInt` + `isNaN`.
- **Permissions are granular, not role-based.** Use `requirePermission('name')` or the inline `loadPermissions` + `hasPermission(perms, 'name')`. Do not add named role helpers ([ADR-0001](adr/0001-granular-permission-checks.md)). `req.user` carries `{ id, userRankId, userRankLevel }` for inline class checks.
- **Errors** are thrown as `new AppError(status, 'message')` from modules; the global handler emits `{ msg }`. Field validation emits `{ errors: { field: [msgs] } }`. Never `{ error }`.
- **Soft delete**: users are never hard-deleted (`disabled: true`); forum content uses `deletedAt`.
- **The OpenAPI contract** is authored in `src/lib/openapi.ts` and exported to `openapi.json` (git-tracked, CI-gated). stellar-ui regenerates its types from it. Run `npm run openapi:export` after any contract change.

The exhaustive module/route inventory (every file and its responsibility) is maintained in [AGENTS.md](../AGENTS.md#architecture); this section is the orientation, that is the map.

## Environment reference

Copy `.env.default` → `.env`. `.env.default` is grouped and commented and is the authoritative list; the table below explains each variable. Everything except the database URI and JWT secret has a sane default or is inert until set.

The background jobs are the part worth reading twice. `INACTIVITY_MODE` and `INVITE_GRANT_MODE` both ship **`off`**, and the rollout is `dryRun` for one release — which evaluates everything and writes nothing — and then `on`. The other two sweeps have no mode switch because neither can take anything away: one returns lapsed invites to their inviters, the other lifts ratio-caused disables.

| Variable                                                                                                                                      | Purpose                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STELLAR_PSQL_URI`                                                                                                                            | PostgreSQL connection string (Prisma reads this)                                                                                                                                                                                                                                                                     |
| `STELLAR_PSQL_URI_TEST`                                                                                                                       | Separate DB for integration tests (created on first run)                                                                                                                                                                                                                                                             |
| `STELLAR_AUTH_JWT_SECRET`                                                                                                                     | JWT signing secret (32+ chars)                                                                                                                                                                                                                                                                                       |
| `STELLAR_HTTP_PORT`                                                                                                                           | Server port (default 8080)                                                                                                                                                                                                                                                                                           |
| `STELLAR_HTTP_CORS_ORIGIN`                                                                                                                    | Allowed CORS origin                                                                                                                                                                                                                                                                                                  |
| `STELLAR_TRUST_PROXY_HOPS`                                                                                                                    | Reverse-proxy hops in front of the API ([#542](https://github.com/orphic-inc/stellar-api/issues/542)); default 1, matching the shipped nginx topology. Set `0` for proxy-less local dev                                                                                                                              |
| `STELLAR_LOG_LEVEL`                                                                                                                           | Winston log level (default `info`)                                                                                                                                                                                                                                                                                   |
| `STELLAR_LOG_TIME_FMT`                                                                                                                        | Optional — Winston timestamp format; Winston's own default if unset                                                                                                                                                                                                                                                  |
| `STELLAR_SENTRY_DSN`                                                                                                                          | Optional — error reporting; disabled if unset                                                                                                                                                                                                                                                                        |
| `STELLAR_SMTP_*`, `STELLAR_SITE_URL`                                                                                                          | Optional — invite email; invites skipped with a warning if unset                                                                                                                                                                                                                                                     |
| `STELLAR_SITE_NAME`, `STELLAR_IRC_URL`, `STELLAR_DISABLED_CHANNEL`, `STELLAR_STAFFPM_PATH`, `STELLAR_PUBLIC_KB_BASE`, `STELLAR_IRC_GUIDE_URL` | Site identity + Golden-Rules `${...}` token resolution (PRD-09 / [ADR-0020](adr/0020-rules-tree-variable-resolution.md)); all optional with defaults                                                                                                                                                                 |
| `KORIN_API_URL`, `KORIN_PULL_KEY`, `KORIN_POLL_INTERVAL_MS`, `KORIN_CHANNEL_WEIGHTS`                                                          | korin.pink IRC metrics pull + announce push ([ADR-0013](adr/0013-korin-pink-irc-integration.md)); inert until set                                                                                                                                                                                                    |
| `STELLAR_SERVICE_KEY`                                                                                                                         | Bearer korin presents on inbound calls; fails closed                                                                                                                                                                                                                                                                 |
| `STELLAR_ASSET_MAX_BYTES`                                                                                                                     | Max size of a single stored binary asset ([ADR-0026](adr/0026-static-asset-storage.md)); default 2 MB                                                                                                                                                                                                                |
| `STELLAR_FEED_SECRET`                                                                                                                         | Member Feed token secret ([#262](https://github.com/orphic-inc/stellar-api/issues/262) / [ADR-0014](adr/0014-per-user-contribution-feed.md)); 32+ chars. **Unset, every feed route answers its 404** — a feed URL is a bearer credential, so that is the safe default. Rotating it revokes every member's feed links |
| `STELLAR_MINIMUM_BOUNTY`                                                                                                                      | Smallest bounty a release request accepts, in bytes (default 104857600 = 100 MiB)                                                                                                                                                                                                                                    |
| `INACTIVITY_MODE`, `INACTIVITY_MAX_DISABLES_PER_CYCLE`, `INACTIVITY_INTERVAL_MS`                                                              | Dormancy sweep ([#279](https://github.com/orphic-inc/stellar-api/issues/279) / [ADR-0038](adr/0038-inactivity-is-a-clock-not-a-timestamp.md)). **Ships `off`**; `dryRun` evaluates everything and writes nothing. Defaults 50 disables per cycle, 24h interval                                                       |
| `INVITE_GRANT_MODE`, `INVITE_GRANT_INTERVAL_MS`                                                                                               | Class-based invite handout ([#282](https://github.com/orphic-inc/stellar-api/issues/282) / [ADR-0039](adr/0039-invite-supply-is-class-based-accrual.md)). **Ships `off`**; `dryRun` writes nothing. The 24h interval is the job's wake-up, not the 14-day accrual period, which lives in code                        |
| `INVITE_EXPIRY_INTERVAL_MS`                                                                                                                   | Invite expiry sweep ([#627](https://github.com/orphic-inc/stellar-api/issues/627) / [ADR-0041](adr/0041-an-invite-lapses-and-is-returned.md)); default 1h. No mode switch — it only returns lapsed invites to their inviters. The 3-day lifetime lives in code                                                       |
| `RATIO_POLICY_INTERVAL_MS`                                                                                                                    | Ratio policy sweep ([#646](https://github.com/orphic-inc/stellar-api/issues/646) / [ADR-0044](adr/0044-a-ratio-disable-records-its-cause.md)); default 24h. No mode switch; lifts ratio-caused disables. A staff disable is never lifted                                                                             |

**Production database access** (Google Cloud SQL): connecting to the live database uses the Cloud SQL Proxy with IAM access for a service account holding the Cloud SQL Client role; point `GOOGLE_APPLICATION_CREDENTIALS` at that account's JSON key. Deployment specifics live in the [stellar-compose](https://github.com/orphic-inc/stellar-compose) operator runbook.

## Adding a module or route

The end-to-end shape for a new feature, using an existing route as the template:

1. **Schema** (`src/schemas/<domain>.ts`) — define the Zod body/params schemas and export the inferred types:
   ```ts
   export const createWidgetSchema = z.object({ name: z.string().min(1) });
   export type CreateWidgetInput = z.infer<typeof createWidgetSchema>;
   ```
2. **Module** (`src/modules/<domain>.ts`) — own the DB work and rules; throw `AppError` on failure:
   ```ts
   export async function createWidget(
     input: CreateWidgetInput,
     actorId: number
   ) {
     const widget = await prisma.widget.create({ data: { ...input } });
     await audit(prisma, actorId, 'widget.create', 'Widget', widget.id);
     return widget;
   }
   ```
3. **Route** (`src/routes/api/<domain>.ts`) — HTTP only; validate, delegate, shape. Register static segments **before** `/:id`:
   ```ts
   router.post(
     '/',
     requirePermission('widgets_manage'),
     validate(createWidgetSchema),
     asyncHandler(async (req, res) => {
       const input = parsedBody<CreateWidgetInput>(res);
       const widget = await createWidget(input, req.user!.id);
       res.status(201).json(widget);
     })
   );
   ```
4. **Contract** — register the response shape in `src/lib/openapi.ts`, then `npm run openapi:export` (regenerates the git-tracked `openapi.json`; the CI freshness gate fails if you forget). Pair a stellar-ui `api:sync` after merge.
5. **Test** — add a `*.spec.ts` (mock DB) and/or an integration test (`src/integration/`, real DB). Seed deterministic data and assert observable behavior.
6. **List endpoints** paginate with `parsedPage(res)` + `paginatedResponse(res, rows, total, pg)`. `parsedPage` reads the already-validated query off `res.locals`, so the route must first run `validateQuery` with a schema spreading `paginationBase` — there is no `parsePage(req)`.

The **stub models** in `schema.prisma` that have no routes yet (CoverArt, BitcoinDonation, Applicant/Thread, Concert, etc. — see [AGENTS.md](../AGENTS.md#stub-models-no-routes-implemented)) are the standing extension backlog.

## Testing

- **Unit/spec** (`*.spec.ts`): mock the DB, `npm run test`.
- **Integration** (`src/integration/`): real DB via `.env.test`, `npm run test:integration`. Create that file once with `cp .env.test.example .env.test`, then point `STELLAR_PSQL_URI_TEST` at your database — the test DB itself is created automatically on first run.
- Helpers: `src/test/apiTestHarness.ts`, `factories.ts`, `dbHelpers.ts`.
