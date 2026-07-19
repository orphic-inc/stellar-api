# Stellar API — Developer Documentation

The human entry point for developing and operating the Stellar API. Start here after the root [README.md](../README.md) (install & run) and [CONTRIBUTING.md](../CONTRIBUTING.md) (workflow & gates). `CLAUDE.md` and `AGENTS.md` at the repo root carry the same material formatted for AI coding agents — this document is the human-facing source; the agent files point back here rather than duplicating it.

## Where things live

| You want to…                                                  | Read                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Install and run locally                                       | [root README](../README.md)                                                                             |
| Contribute (fork model, pre-commit gate, OpenAPI sync, tests) | [CONTRIBUTING.md](../CONTRIBUTING.md)                                                                   |
| Understand the architecture                                   | [Architecture](#architecture) (below)                                                                   |
| Configure the app                                             | [Environment reference](#environment-reference) (below)                                                 |
| Add a feature                                                 | [Adding a module or route](#adding-a-module-or-route) (below)                                           |
| Understand a design decision                                  | [`adr/`](adr/) — 28 Architecture Decision Records                                                       |
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

The exhaustive module/route inventory (every file and its responsibility) is maintained in [CLAUDE.md](../CLAUDE.md#architecture); this section is the orientation, that is the map.

## Environment reference

Copy `.env.default` → `.env`. `.env.default` is grouped and commented and is the authoritative list; the table below explains each variable. Everything except the database URI and JWT secret has a sane default or is inert until set.

| Variable                                                                                                             | Purpose                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STELLAR_PSQL_URI`                                                                                                   | PostgreSQL connection string (Prisma reads this)                                                                                                     |
| `STELLAR_PSQL_URI_TEST`                                                                                              | Separate DB for integration tests (created on first run)                                                                                             |
| `STELLAR_AUTH_JWT_SECRET`                                                                                            | JWT signing secret (32+ chars)                                                                                                                       |
| `STELLAR_HTTP_PORT`                                                                                                  | Server port (default 8080)                                                                                                                           |
| `STELLAR_HTTP_CORS_ORIGIN`                                                                                           | Allowed CORS origin                                                                                                                                  |
| `STELLAR_LOG_LEVEL`                                                                                                  | Winston log level (default `info`)                                                                                                                   |
| `STELLAR_SENTRY_DSN`                                                                                                 | Optional — error reporting; disabled if unset                                                                                                        |
| `STELLAR_SMTP_*`, `STELLAR_SITE_URL`                                                                                 | Optional — invite email; invites skipped with a warning if unset                                                                                     |
| `STELLAR_SITE_NAME`, `STELLAR_IRC_URL`, `STELLAR_DISABLED_CHANNEL`, `STELLAR_STAFFPM_PATH`, `STELLAR_PUBLIC_KB_BASE` | Site identity + Golden-Rules `${...}` token resolution (PRD-09 / [ADR-0020](adr/0020-rules-tree-variable-resolution.md)); all optional with defaults |
| `KORIN_API_URL`, `KORIN_PULL_KEY`, `KORIN_POLL_INTERVAL_MS`                                                          | korin.pink IRC metrics pull + announce push ([ADR-0013](adr/0013-korin-pink-irc-integration.md)); inert until set                                    |
| `STELLAR_SERVICE_KEY`                                                                                                | Bearer korin presents on inbound calls; fails closed                                                                                                 |
| `STELLAR_ASSET_MAX_BYTES`                                                                                            | Max size of a single stored binary asset ([ADR-0026](adr/0026-static-asset-storage.md)); default 2 MB                                                |

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
6. **List endpoints** paginate with `parsePage(req)` + `paginatedResponse(res, rows, total, pg)`.

The **stub models** in `schema.prisma` that have no routes yet (CoverArt, BitcoinDonation, Applicant/Thread, Concert, etc. — see [CLAUDE.md](../CLAUDE.md#stub-models-no-routes-implemented)) are the standing extension backlog.

## Testing

- **Unit/spec** (`*.spec.ts`): mock the DB, `npm run test`.
- **Integration** (`src/integration/`): real DB via `.env.test`, `npm run test:integration`.
- Helpers: `src/test/apiTestHarness.ts`, `factories.ts`, `dbHelpers.ts`.
