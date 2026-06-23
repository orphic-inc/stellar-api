# CLAUDE.md — stellar-api

Node.js / Express / TypeScript REST API with PostgreSQL (Prisma ORM) and JWT cookie auth.

## Commands

```bash
npm run dev              # nodemon + ts-node
npm run build            # tsc
npx tsc --noEmit         # type-check only (run before committing)
npm run format           # prettier --write src + prisma/**/*.ts — run on ALL changed files before committing
npm run lint             # eslint src prisma --ext .ts — run before committing; must be clean on new/changed files
npm run test             # jest --runInBand
npm run test:watch       # jest --watch
npm run test:integration # integration tests (requires .env.test)
npm run openapi:export   # generate openapi spec via ts-node src/scripts/export-openapi.ts
npm run db:migrate       # prisma migrate dev (requires interactive TTY)
npm run db:seed          # recreate default user ranks after a DB reset; then go to /install
npm run db:reset         # prisma migrate reset
npm run db:generate      # only needed when pulling someone else's schema changes
npm run db:studio        # prisma studio
```

## Commit workflow

The `.husky/pre-commit` hook runs on every commit and gates: lint-staged (`eslint --fix` + `prettier --write` on staged files), `npx tsc --noEmit`, `npm run typecheck:test`, and `npm run version:check`. So format/lint/type-check are enforced automatically — don't re-run them by hand as a separate pre-commit ritual.

What the hook does **not** cover, run yourself before committing:

1. `npm run format` — only when you've changed files the hook didn't stage (it formats **all** of `src/` and `prisma/**/*.ts`, confirming nothing else drifted)
2. `npm run test --no-coverage` — full suite (too slow for the hook; CI is the authority, but run it locally before pushing)
3. Commit with a descriptive message following existing log style

> If you do run the checks manually (e.g. before staging, or committing with `--no-verify`): order matters — format before lint (Prettier violations surface as ESLint errors), and lint before type-check.

## Environment

Copy `.env.default` → `.env`.

| Variable                   | Purpose                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `STELLAR_PSQL_URI`         | PostgreSQL connection string                                                                |
| `STELLAR_AUTH_JWT_SECRET`  | JWT signing secret                                                                          |
| `STELLAR_HTTP_PORT`        | Server port (default 8080)                                                                  |
| `STELLAR_HTTP_CORS_ORIGIN` | Allowed CORS origin                                                                         |
| `STELLAR_LOG_LEVEL`        | Winston log level (default `info`)                                                          |
| `KORIN_API_URL`            | korin.pink IRC metrics API base URL (ADR-0013; polling disabled when unset)                 |
| `KORIN_PULL_KEY`           | Key stellar presents to korin (`x-pull-key`) for metrics pull + announce push (ADR-0013)    |
| `KORIN_POLL_INTERVAL_MS`   | IRC metrics poll + announce push interval (default 300000 = 5 min)                          |
| `STELLAR_SERVICE_KEY`      | Bearer korin presents on inbound calls (by-irc-nick, link, reputation); fails closed        |
| `STELLAR_SITE_NAME`        | Site name resolved into Golden Rules `${site_name}` (PRD-09; default `Stellar`)             |
| `STELLAR_IRC_URL`          | UI route `${irc}` resolves to (PRD-09; default `/irc`)                                      |
| `STELLAR_DISABLED_CHANNEL` | IRC channel `${disabled_channel}` resolves to (PRD-09; default `#disabled`)                 |
| `STELLAR_STAFFPM_PATH`     | UI route `${staffpm}` resolves to (PRD-09; default `/inbox/staff`)                          |
| `STELLAR_PUBLIC_KB_BASE`   | Stellar Public KB root for `${*_article}` guidance links (PRD-09; default kb.stellargra.ph) |

## Architecture

```
src/
  index.ts                  # Thin bootstrap — starts HTTP server on configured port
  app.ts                    # createApp() factory — Express setup, route mounting, error handler (testable)
  modules/
    config.ts               # Typed env config (auth, logging, http)
    asyncHandler.ts         # Wraps async routes; catches errors, 10s timeout
    installState.ts         # In-memory cache for isInstalled() check
    logging.ts              # Winston logger factory (JSON in prod, pretty in dev)
    linkHealth.ts           # HEAD-request link checker + auto-warn on 3+ reports; computePulse + getCommunityHealthPulse; applyHealthAccrual (per-contribution PASS-uptime accumulator, #95/ADR-0019)
    linkHealthJob.ts        # Background job: recheck stale contribution links every 24h
    communityHealthHistory.ts # Persist/query the community health pulse as a time-series snapshot (#75); captured by statsJob
    crsHistory.ts           # Capture/query CRS as a time-series snapshot (#94, ADR-0007 trend layer); active-users-only, Monthly+Yearly cadence (no hourly), self-read only — captured by statsJob
    auth.ts                 # Password validation, auth user DB query helpers
    artist.ts               # Artist creation/update with history tracking
    comment.ts              # Comment soft-delete with audit logging
    contribution.ts         # Contribution submission & processing (with link health)
    downloads.ts            # Download grant logic
    forum.ts                # Forum business logic (post creation, topic management)
    pm.ts                   # Private message business logic
    staffPm.ts              # Staff-to-staff private message logic (separate from support tickets)
    staffInbox.ts           # Support ticket business logic
    profile.ts              # Profile update logic
    ratio.ts                # Ratio calculation helpers
    ratioPolicy.ts          # Ratio policy evaluation
    reports.ts              # Report claim/resolve logic
    requests.ts             # Release request + bounty logic
    settings.ts             # Site settings helpers
    stats.ts                # Stats query helpers
    top10.ts                # Ranked list logic: binomial scoring, TTL caching, snapshots
    user.ts                 # User query helpers
    reputation.ts           # CRS dimension registry (longevity/ratio/friends/invite/donation/community/linkHealth/irc/stylesheet); pure scorers + read-time assembler. linkHealth = lifetime confirmed-PASS uptime (#95/ADR-0019)
    irc.ts                  # korin.pink metrics poll client + pure IRCScore scorer (getIrcScore); ADR-0013
    ircJob.ts               # Background poll job — fetches korin.pink IRC metrics into the in-process cache (ADR-0013)
    announce.ts             # Release-Announce publisher — builds new-contribution RSS, pushes to korin POST /irc/announce (ADR-0013)
    announceJob.ts          # Background job — cursor over new contributions, pushes each to korin (ADR-0013)
    goldenRules.ts            # The 6 immutable Golden Rules (PRD-05/09): GOLDEN_RULES table mirroring CODE_OF_CONDUCT.md verbatim + idempotent seedGoldenRules(); drift-guarded by goldenRules.spec.ts
    siteVariables.ts          # resolveSiteVariables() — read-time token→values map for GET /rules/tree (PRD-09, ADR-0020); config + Bugs-forum lookup, single-sourced for UI substitution
  middleware/
    auth.ts                 # JWT cookie decode → DB lookup → req.user
    permissions.ts          # requirePermission, requireAuth, isModerator
    rateLimiter.ts          # authLimiter, writeLimiter, installLimiter
    serviceAuth.ts          # requireServiceKey — Bearer gate for korin.pink inbound calls (ADR-0013; fails closed)
    validate.ts             # validate(bodySchema), validateParams(paramsSchema)
  lib/
    prisma.ts               # Singleton PrismaClient
    audit.ts                # audit(prisma, actorId, action, targetType, targetId, meta?)
    errors.ts               # AppError class (extends Error with statusCode)
    mailer.ts               # SMTP email utility (sendInviteEmail)
    openapi.ts              # Auto-generated OpenAPI type definitions
    pagination.ts           # parsePage(req) → { skip, limit, page }
                            # paginatedResponse(res, data, total, pg)
    sanitize.ts             # sanitizeHtml(str), sanitizePlain(str)
    jsonHelpers.ts          # appendToJsonArray, jsonObjectArray, removeFromJsonArrayAtIndex
    ttlCache.ts             # Generic TtlCache<K,V> + top10Cache singleton
  types/
    api.ts                  # Auto-generated OpenAPI interface definitions
    auth.ts                 # AuthUser type (id, userRankId, userRankLevel; optional contributed/consumed)
    express.d.ts            # Express Request augmentation for req.user?
  schemas/                  # Zod schemas + inferred types, one file per domain
  scripts/
    export-openapi.ts       # Generates openapi.ts from route definitions
  test/
    apiTestHarness.ts       # Supertest harness helpers for route-level tests
    dbHelpers.ts            # DB setup/teardown utilities for integration tests
    factories.ts            # Entity factories for test data
    integrationSetup.ts     # Jest global setup for integration suite
    setup.ts                # Jest setup for unit/spec suite
    mocks/
      dompurify.ts          # DOMPurify mock for jsdom tests
  integration/              # Integration test files (use real DB via .env.test)
  routes/api/
    auth.ts                 # POST / (login), POST /register, GET / (me), POST /logout
    install.ts              # GET / (status), POST / (one-time setup)
    user.ts                 # GET|PUT /settings, GET /:id, POST / (admin create)
    tools.ts                # /user-ranks CRUD — requires admin permission
    settings.ts             # GET|PUT /settings — site-wide settings (admin)
    profile.ts              # /me, /user/:id, PUT /me, DELETE /, POST /referral/create-invite
    notifications.ts        # GET /, DELETE /:id
    subscriptions.ts        # POST /subscribe, GET /, POST /subscribe-comments
    comments.ts             # GET /, GET /:id, POST /, PUT /:id, DELETE /:id
    posts.ts                # Blog posts + comments
    messages.ts             # Private messages (conversations, inbox, sent)
    staffInbox.ts           # Support tickets + staff inbox + canned responses
    reports.ts              # File report, my reports, staff queue, claim/resolve
    ratioPolicy.ts          # GET /:userId, POST /:userId/override (staff)
    requests.ts             # Release requests + bounties
    downloads.ts            # Download grant + access
    collages.ts             # Collage CRUD
    announcements.ts        # Announcements
    stats.ts                # Site stats
    bookmarks.ts            # Artist/release/community/request bookmark CRUD
    home.ts                 # Featured albums + vanity house releases
    top10.ts                # Ranked releases/users/tags/votes (TTL cached + snapshots)
    search.ts               # Cross-domain search
    random.ts               # Random release endpoint
    siteHistory.ts          # Site history log
    stylesheet.ts           # User stylesheets
    wiki.ts                 # Wiki pages, aliases, revisions
    docs.ts                 # API docs endpoint
    communities/
      communities.ts        # Community CRUD
      release.ts            # Release CRUD under /:communityId/releases
      artist.ts             # Artist CRUD + history/similar/alias/tag
      contributions.ts      # Contribution CRUD + domain gate + approve
      dnu.ts                # Community Do-Not-Upload list management
    forum/
      forumRoute.ts         # Forum CRUD
      forumCategory.ts      # ForumCategory CRUD
      forumTopic.ts         # Forum topic CRUD (create, lock, sticky, delete)
      forumPost.ts          # Forum post CRUD (create, edit, delete, history)
      forumPoll.ts          # Poll CRUD
      forumPollVote.ts      # Poll voting
      forumTopicNote.ts     # Moderator notes on topics
      forumLastReadTopic.ts # Read-position tracking
```

## req.user shape

Set by `auth.ts` middleware after DB lookup:

```ts
req.user = { id: number; userRankId: number; userRankLevel: number }
```

`AuthUser` in `types/auth.ts` also carries optional `contributed`/`consumed` as strings (BigInt serialization). `userRankLevel` enables inline forum class checks without extra queries:

```ts
if (req.user!.userRankLevel < (forum.minClassRead ?? 0)) { ... }
```

## Established patterns

### Business logic in modules

Route handlers delegate to domain modules in `src/modules/`. Modules own DB queries, transactions, and business rules. Routes handle HTTP concerns (auth, validation, response shape).

### Body validation

Always run `validate(schema)` before the handler. Read the parsed body with the `parsedBody<T>` helper, typed with the Zod-inferred type:

```ts
validate(loginSchema),
asyncHandler(async (req, res) => {
  const { email, password } = parsedBody<LoginInput>(res);
```

Use `parsedQuery<T>(res)` / `parsedParams<T>(res)` for `validateQuery` / `validateParams`.

### Param validation

Use `validateParams` with `z.coerce` for numeric IDs — never use raw `parseInt` + `isNaN`:

```ts
const artistIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
router.get('/:id', validateParams(artistIdParamsSchema), asyncHandler(async (req, res) => {
  const { id } = req.params as unknown as { id: number };
```

### Static routes before parameterized

Any static-segment route (`/history/:artistId`, `/settings`) must be registered **before** `/:id` in the same router or Express shadows it.

### Auth & permissions

```ts
requireAuth                                // sets req.user or 401
...requirePermission('admin')              // spread — includes requireAuth
// Inline permission branch — name the exact permission required:
const perms = await loadPermissions(req, res);
if (!hasPermission(perms, 'forums_moderate')) { ... }
```

Do not introduce named role checks (`isModerator`, `isStaffUser`). See `docs/adr/0001-granular-permission-checks.md`.

### Pagination

```ts
const pg = parsePage(req); // reads ?page=&limit= with sane defaults
const [rows, total] = await Promise.all([
  prisma.foo.findMany({ skip: pg.skip, take: pg.limit }),
  prisma.foo.count()
]);
paginatedResponse(res, rows, total, pg);
```

### Typed errors

Throw `new AppError(statusCode, 'message')` from modules; the global handler in `app.ts` catches it and sends `{ msg }` with the correct status.

### Soft delete

Users are never hard-deleted — set `disabled: true`. Filter active users with `where: { disabled: false }`. Forum topics and posts use `deletedAt`.

### Error responses

- Field-level validation: `{ errors: { field: [msgs] } }` — emitted by `validate.ts`
- Single-message errors: `{ msg: "..." }` — used everywhere else
- Never use `{ error: "..." }` (old global handler shape — now standardized)

### Transactions

Use `prisma.$transaction([...])` (batch) for fire-and-forget operations where partial failure would leave bad state. Use `prisma.$transaction(async tx => ...)` (interactive) when you need the result of one operation to inform the next.

## Testing

- **Unit/spec tests** (`*.spec.ts` in `src/`): mock the DB, use `src/test/setup.ts`, run with `npm run test`
- **Integration tests** (`src/integration/`): hit a real test DB configured via `.env.test`, run with `npm run test:integration`
- **Test helpers**: `apiTestHarness.ts` (supertest wrappers), `factories.ts` (entity creation), `dbHelpers.ts` (DB state management)

## Audit history

Five rounds of audit remediation have been applied to this codebase. Key items completed:

- Auth shape: `{ user: AuthUser }` wrapper, JWT issued as HttpOnly cookie
- `req.user` carries `userRankLevel` from DB lookup in auth middleware
- Forum class enforcement (`minClassRead`, `minClassCreate`, `minClassWrite`)
- Route ordering: static segments before `/:id` throughout
- `validate()` on all mutating routes; `validateParams()` replacing `parseInt`+`isNaN`
- Error envelope standardized to `{ msg }` / `{ errors: { field } }`
- Users soft-deleted (`disabled: true`) — never hard-deleted
- Pagination on all list endpoints that can return unbounded rows
- `Permission` and `CommentEdit` Prisma models dropped (unused — migration applied)
- `installState.ts` in-memory cache for repeated install-check calls
- `app.ts` / `index.ts` split for testability
- Business logic extracted from routes into `src/modules/` domain files

## Stub models (no routes implemented)

These Prisma models exist in `schema.prisma` but have no API routes:

| Model                       | Status                                 |
| --------------------------- | -------------------------------------- |
| `CoverArt`                  | Planned — release art management       |
| `BitcoinDonation`           | Planned — donor system                 |
| `Applicant`, `Thread`       | Planned — application/thread system    |
| `Concert`, `ContestType`    | Planned — events/contests              |
| `ForumSpecificRule`         | Planned — per-forum/topic/thread rules |
| `Note`                      | Planned — admin messaging/content      |
| `BadPassword`               | Planned — admin moderation tools       |
| `CurrencyConversionRate`    | Planned — economy system               |
| `FeaturedMerch`             | Planned — merch feature                |
| `GroupLog`                  | Planned — misc features                |
| `ApiApplication`, `ApiUser` | Deferred indefinitely                  |

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `orphic-inc/stellar-api` (external PRs are not a triage surface). See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — `CONTEXT-MAP.md` at the repo root indexes the per-repo `CONTEXT.md` files across the Stellar constellation (stellar-api, stellar-ui, external korin.pink). See `docs/agents/domain.md`.
