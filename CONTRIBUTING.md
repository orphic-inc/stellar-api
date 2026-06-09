# Contributing to Stellar API

Welcome! We appreciate your interest in contributing to Stellar API. To keep the codebase healthy, modular, and maintainable, please adhere to the following architectural guidelines.

## Workflow (fork model)

Stellar is three repos developed together — `stellar-api`, `stellar-ui`, `stellar-compose` — using a **fork model**. See [ADR-0009](docs/adr/0009-fork-workflow-and-dependency-discipline.md) for the why.

**Remotes:** `origin` = your fork (`<you>/stellar-*`), `upstream` = `orphic-inc/stellar-*` (canonical). Never push to `upstream`; PRs go fork → upstream.

**Getting started:**

```bash
# Per repo (api/ui/compose): clone your fork, wire upstream
git clone git@github.com:<you>/stellar-api.git && cd stellar-api
git remote add upstream git@github.com:orphic-inc/stellar-api.git   # or: git wire-upstream
```

**Aliases** (install via the `~/.config/git/stellar-aliases.gitconfig` include):

| alias                | does                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| `git sync`           | fetch upstream, ff `develop` to `upstream/develop`, push to your fork |
| `git feature <name>` | `sync` then branch off a fresh `develop`                              |
| `git publish`        | push the current branch to your fork                                  |
| `git opr`            | open a PR from the current branch into `upstream/develop`             |
| `git remotes`        | show which remote is fork vs upstream                                 |

**Branches:** `develop` = integration (PR target) · `staging` = pre-prod · `main` = released. Promotion flows **up**; `main` never runs ahead of `develop`. Linear history on `develop` — **cut feature branches from `develop`, not `main`.**

**Dependency bumps** are isolated (own branch/PR), pinned, ADR'd, and atomic with the regen/migration they force — never entangled with feature work (ADR-0009).

## Code Standards

### Error Handling

Always use the custom `AppError` class when intentionally throwing errors that should be surfaced to the client. This ensures the global error handler (`src/app.ts`) responds with the correct HTTP status code instead of a generic 500 error.

**Do:**

```typescript
import { AppError } from '../lib/errors';
throw new AppError(404, 'User not found');
```

**Don't:**

```typescript
throw new Error('User not found'); // Results in a 500 status code
```

### Input Validation & Type Safety

We use **Zod** for schema validation. Do not manually cast variables using `as T`. Instead, use the built-in `parsedBody`, `parsedParams`, and `parsedQuery` helpers which infer types securely based on your schema.

**Do:**

```typescript
import { parsedBody } from '../../middleware/validate';
const { email, password } = parsedBody<LoginInput>(res);
```

### Separation of Concerns

- **Routes (`src/routes`)**: Controllers should only handle HTTP mappings, response formatting, and status codes.
- **Modules/Services (`src/modules`)**: All database operations and business logic must be housed here, decoupled from Express.

### Database Operations (Prisma)

- Avoid manual string manipulation or raw SQL unless absolutely necessary.
- **Soft Deletes**: Always rely on Prisma soft-delete patterns or extensions rather than manually filtering `deletedAt: null` across all queries.

## Testing

We utilize Jest and Supertest.

- New endpoints must be accompanied by integration tests in `src/integration`.
- Utilize the `apiTestHarness` and `dbHelpers` to cleanly stub out the database or test user context during integration tests.

## Submitting Pull Requests

1. Ensure `npm run build` and `npm run test` pass.
2. If you altered API endpoints, ensure you run `npm run openapi:export` and commit the updated `openapi.json`.
3. Provide a clear description of the changes in your PR and link to any relevant issues.
