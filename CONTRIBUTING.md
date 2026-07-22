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

**Optional aliases.** These convenience aliases wrap the fork-workflow commands. Add them to a git include (e.g. a `~/.config/git/stellar-aliases.gitconfig` referenced from your `~/.gitconfig`), or just use the raw commands in the right-hand column:

| alias                | does                                                            | raw equivalent                                                                                         |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `git sync`           | fetch upstream, ff `main` to `upstream/main`, push to your fork | `git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main` |
| `git feature <name>` | `sync` then branch off a fresh `main`                           | `git sync && git checkout -b <name>`                                                                   |
| `git publish`        | push the current branch to your fork                            | `git push -u origin HEAD`                                                                              |
| `git opr`            | open a PR from the current branch into `upstream/main`          | `gh pr create --repo orphic-inc/stellar-api --base main`                                               |
| `git remotes`        | show which remote is fork vs upstream                           | `git remote -v`                                                                                        |

**Branches:** `main` is the only long-lived branch and the sole PR target — there is no `develop` or `staging`. **Cut feature branches from `main`** on your fork and PR into `upstream/main`; linear history (rebase-merge). `release/*` branches may live on `upstream` when a release needs coordination — the one sanctioned exception. See [ADR-0010](docs/adr/0010-trunk-based-single-branch-workflow.md).

**Dependency bumps** are isolated (own branch/PR), pinned, ADR'd, and atomic with the regen/migration they force — never entangled with feature work (ADR-0009).

> **Adding a dependency with a conditional `exports` map.** Packages whose `package.json` resolves through a conditional `exports` map (e.g. `katex`, `isomorphic-dompurify`, `@sentry/node`, `@prisma/client`) can't be followed by the `import/no-unresolved` resolver Codacy Static Code Analysis runs, so the **Codacy** PR check fails with an unresolved-import issue even though `import katex from 'katex'` type-checks and runs fine. Local `npm run lint` can pass — the local node resolver reads the package's `main` field — so a green local lint is **not** proof the Codacy check will pass. The fix is the established one: add the bare package name to the `ignore` array of the `import/no-unresolved` rule in `.eslintrc.cjs` (that list exists for exactly this class of module). Verify with `npm run lint`, and confirm the Codacy check on the PR goes green.

## Local pre-commit gate

The **husky** `pre-commit` hook does more than format staged files — it runs, in order:

1. **`lint-staged`** over staged files — `*.ts`/`*.tsx` → `eslint --fix` then `prettier --write`; `*.{json,md,scss,css}` → `prettier --write` (ui also runs `stylelint` on `*.scss`).
2. **`tsc --noEmit`** — type-checks the **whole project** (a staged edit can break types in files it doesn't touch).
3. **`npm run typecheck:test`** — type-checks the test files (the base tsconfig excludes them).
4. **`npm run version:check`** — the version-consistency guardrail across `package.json`/lockfile/CHANGELOG (internal axes; the git-tag axis is enforced in CI on tag pushes so a release-bump commit isn't blocked).

So format, lint, and type-checking are enforced at commit time — you don't need to run them by hand as a separate ritual. The hook installs automatically: `npm install` runs `prepare` (`husky install || true`; the `|| true` keeps dependency-free production/Docker builds from failing).

The whole chain can take several minutes on a cold cache. If you must commit around it (e.g. a docs-only change while iterating), run the gates yourself and commit with `--no-verify`, noting it in the message — but the pushed branch must still pass CI.

> **One config, no shadow.** lint-staged config lives **only** in `package.json`. Do not add a `.lintstagedrc` — lint-staged prefers the rc file and silently ignores the `package.json` block, which disables the real rules.

The hook does **not** run the full Jest suite (too slow) — that is CI's job. **Before pushing**, run it yourself:

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

## OpenAPI Synchronization

Stellar relies on an OpenAPI specification to maintain type-safety between the API and the UI. When you make changes to Zod schemas or API routes, you must export the new OpenAPI spec:

```bash
npm run openapi:export
```

This generates an `openapi.json` file in the project root. The `stellar-ui` repository reads this file to generate its frontend TypeScript types, so a stale `openapi.json` will silently drift the UI's types away from the live API contract.

## Testing

We utilize Jest and Supertest. Supertest drives our route-level tests through the harness in `src/test/apiTestHarness.ts`, exercising the real Express app without binding a port.

```bash
npm run test              # unit/spec suite (mocked DB)
npm run test:integration  # integration suite (requires a stellar_test database and a .env.test file)
```

- New endpoints must be accompanied by integration tests in `src/integration`.
- Utilize the `apiTestHarness` and `dbHelpers` to cleanly stub out the database or test user context during integration tests.

## Submitting Pull Requests

1. Ensure `npm run build` and `npm run test` pass.
2. If you altered API endpoints, ensure you run `npm run openapi:export` and commit the updated `openapi.json`.
3. Provide a clear description of the changes in your PR and link to any relevant issues.
