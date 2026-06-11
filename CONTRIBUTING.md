# Contributing to Stellar API

Welcome! We appreciate your interest in contributing to Stellar API. To keep the codebase healthy, modular, and maintainable, please adhere to the following architectural guidelines.

## Workflow (fork model)

Stellar is three repos developed together — `stellar-api`, `stellar-ui`, `stellar-compose` — using a **fork model** with a single `main` trunk. See [ADR-0009](docs/adr/0009-fork-workflow-and-dependency-discipline.md) (fork remotes + dependency discipline) and [ADR-0010](docs/adr/0010-trunk-based-single-branch-workflow.md) (trunk-based workflow) for the why.

**Remotes:** `origin` = your fork (`<you>/stellar-*`), `upstream` = `orphic-inc/stellar-*` (canonical). Never push to `upstream`; PRs go fork → upstream.

**Getting started:**

```bash
# Per repo (api/ui/compose): clone your fork, wire upstream
git clone git@github.com:<you>/stellar-api.git && cd stellar-api
git remote add upstream git@github.com:orphic-inc/stellar-api.git   # or: git wire-upstream
```

**Aliases** (install via the `~/.config/git/stellar-aliases.gitconfig` include):

| alias                | does                                                            |
| -------------------- | --------------------------------------------------------------- |
| `git sync`           | fetch upstream, ff `main` to `upstream/main`, push to your fork |
| `git feature <name>` | `sync` then branch off a fresh `main`                           |
| `git publish`        | push the current branch to your fork                            |
| `git opr`            | open a PR from the current branch into `upstream/main`          |
| `git remotes`        | show which remote is fork vs upstream                           |

**Branches:** `main` is the only long-lived branch and the sole PR target — there is no `develop` or `staging`. **Cut feature branches from `main`** on your fork and PR into `upstream/main`; linear history (rebase-merge). `release/*` branches may live on `upstream` when a release needs coordination — the one sanctioned exception. See [ADR-0010](docs/adr/0010-trunk-based-single-branch-workflow.md).

**Dependency bumps** are isolated (own branch/PR), pinned, ADR'd, and atomic with the regen/migration they force — never entangled with feature work (ADR-0009).

## Local pre-commit gate

Each repo runs a **husky** pre-commit hook that invokes **lint-staged** over your staged files, so formatting/lint never lands in a commit:

- staged `*.ts`/`*.tsx` → `eslint --fix` then `prettier --write`
- staged `*.{json,md,scss,css}` → `prettier --write` (ui also runs `stylelint` on `*.scss`)

The hook installs automatically — `npm install` runs the `prepare` script (`husky install || true`; the `|| true` keeps dependency-free production/Docker builds from failing). Nothing to wire up by hand.

> **One config, no shadow.** lint-staged config lives **only** in `package.json`. Do not add a `.lintstagedrc` — lint-staged prefers the rc file and silently ignores the `package.json` block, which disables the real rules.

lint-staged is the fast staged-file pass, not the full check. **Before pushing**, run the complete gate (it must be clean on new/changed files):

```bash
npm run format   # prettier --write (whole tree — confirms nothing else drifted)
npm run lint     # eslint, clean on changed files
npx tsc --noEmit # type-check
npm run test     # full suite
```

Order matters: format before lint (Prettier violations surface as ESLint errors), lint before type-check.

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
