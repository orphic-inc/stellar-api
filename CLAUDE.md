# CLAUDE.md — stellar-api

Node.js / Express / TypeScript REST API with PostgreSQL (Prisma ORM) and JWT cookie auth.

## Commands

```bash
npm run dev              # nodemon + ts-node
npm run build            # tsc
npx tsc --noEmit         # type-check only (run before committing)
npx prettier --write ... # format — always run on edited files before committing
npx prisma generate      # regenerate Prisma client after schema changes
npx prisma migrate dev   # create + apply migration
```

No test framework yet. `tsconfig` excludes `*.spec.ts` in preparation.

## Environment

Copy `.env.default` → `.env`.

| Variable | Purpose |
|---|---|
| `STELLAR_PSQL_URI` | PostgreSQL connection string |
| `STELLAR_AUTH_JWT_SECRET` | JWT signing secret |
| `STELLAR_HTTP_PORT` | Server port (default 8080) |
| `STELLAR_HTTP_CORS_ORIGIN` | Allowed CORS origin |
| `STELLAR_LOG_LEVEL` | Winston log level (default `info`) |

## Architecture

```
src/
  index.ts                  # Express app, route mounting, global error handler
  modules/
    config.ts               # Typed env config (auth, logging, http)
    asyncHandler.ts         # Wraps async routes; catches errors, 10s timeout
    installState.ts         # In-memory cache for isInstalled() check
  middleware/
    auth.ts                 # JWT cookie decode → DB lookup → req.user
    permissions.ts          # requirePermission, requireAuth, isModerator
    rateLimiter.ts          # authLimiter, writeLimiter, installLimiter
    validate.ts             # validate(bodySchema), validateParams(paramsSchema)
  lib/
    prisma.ts               # Singleton PrismaClient
    audit.ts                # audit(prisma, actorId, action, targetType, targetId, meta?)
    pagination.ts           # parsePage(req) → { skip, limit, page }
                            # paginatedResponse(res, data, total, pg)
    sanitize.ts             # sanitizeHtml(str), sanitizePlain(str)
    jsonHelpers.ts          # appendToJsonArray, jsonObjectArray, removeFromJsonArrayAtIndex
  schemas/                  # Zod schemas + inferred types, one file per domain
  routes/api/
    auth.ts                 # POST / (login), POST /register, GET / (me), POST /logout
    install.ts              # GET / (status), POST / (one-time setup)
    user.ts                 # GET|PUT /settings, GET /:id, POST / (admin create)
    tools.ts                # /user-ranks CRUD — requires admin permission
    profile.ts              # /me, /user/:id, PUT /me, DELETE /, POST /referral/create-invite
    notifications.ts        # GET /, DELETE /:id
    subscriptions.ts        # POST /subscribe, GET /, POST /subscribe-comments
    comments.ts             # GET /, GET /:id, POST /, PUT /:id, DELETE /:id
    posts.ts                # Blog posts + comments
    communities/
      communityRoute.ts     # Community CRUD
      releaseGroup.ts       # Release CRUD under /:communityId/groups
      artist.ts             # Artist CRUD + history/similar/alias/tag
      contribution.ts       # Contribution CRUD
    forum/
      forumRoute.ts         # Forum CRUD
      forumCategory.ts      # ForumCategory CRUD
      forumTopic.ts         # Topic CRUD under /:forumId/topics
      forumPost.ts          # Post CRUD under /:forumTopicId/posts
      forumPoll.ts          # Poll CRUD + voting
      forumTopicNote.ts     # Moderator notes on topics
      forumLastReadTopic.ts # Read-position tracking
```

## req.user shape

Set by `auth.ts` middleware after DB lookup:

```ts
req.user = { id: number; userRankId: number; userRankLevel: number }
```

`userRankLevel` enables inline forum class checks without extra queries:
```ts
if (req.user!.userRankLevel < (forum.minClassRead ?? 0)) { ... }
```

## Established patterns

### Body validation
Always run `validate(schema)` before the handler. Destructure using the Zod-inferred type:
```ts
validate(loginSchema),
asyncHandler(async (req, res) => {
  const { email, password } = req.body as LoginInput;
```

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
await isModerator(req, res)                // boolean; uses cached userRankId
```

### Pagination
```ts
const pg = parsePage(req);  // reads ?page=&limit= with sane defaults
const [rows, total] = await Promise.all([prisma.foo.findMany({ skip: pg.skip, take: pg.limit }), prisma.foo.count()]);
paginatedResponse(res, rows, total, pg);
```

### Soft delete
Users are never hard-deleted — set `disabled: true`. Filter active users with `where: { disabled: false }`. Forum topics and posts use `deletedAt`.

### Error responses
- Field-level validation: `{ errors: { field: [msgs] } }` — emitted by `validate.ts`
- Single-message errors: `{ msg: "..." }` — used everywhere else
- Never use `{ error: "..." }` (old global handler shape — now standardized)

### Transactions
Use `prisma.$transaction([...])` (batch) for fire-and-forget operations where partial failure would leave bad state. Use `prisma.$transaction(async tx => ...)` (interactive) when you need the result of one operation to inform the next.

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

## Commit workflow

1. `npx tsc --noEmit` — must be clean
2. `npx prettier --write <changed files>`
3. Commit with descriptive message following existing log style
4. Push to current feature branch (`phase-3-misc`)
