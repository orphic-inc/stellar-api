# ADR-0034: ESLint 9 and flat config — the `eslint-plugin-import` ceiling, and what we suppressed to get here

**Status:** Accepted (2026-08-14), with one question deliberately left open — see [Open question: does Codacy still earn its place](#open-question-does-codacy-still-earn-its-place).
**Date:** 2026-08-14
**Repos:** orphic-inc/stellar-api
**Relates:** [ADR-0018 — development lifecycle & the API/UI contract gate](0018-development-lifecycle-and-contract-gate.md)
**Cross-links:** [#367 — eslint v10](https://github.com/orphic-inc/stellar-api/pull/367) (stays open), [#362 — @babel/eslint-parser v8](https://github.com/orphic-inc/stellar-api/pull/362) (closed by this), [#431 — eslint-config-prettier v10](https://github.com/orphic-inc/stellar-api/pull/431) (superseded by this)

---

## Context

ESLint 8 is end-of-life. Renovate opened the upgrade path in three PRs on 2026-07-20 — eslint v10 (#367), `@babel/eslint-parser` v8 (#362), `eslint-config-prettier` v10 (#431) — and all three stalled for three weeks. Two were red, and the reason was not the one on the tin.

**#367 looked like a lockfile problem and was not.** Its CI failure is `npm ci` refusing an out-of-sync lockfile. Regenerating it makes `npm ci` pass — and then installs **eslint 8.57.1 anyway**:

```
├─┬ eslint-config-prettier@8.10.2
│ └── eslint@8.57.1 deduped invalid: "^10.0.0" from the root project
```

Every eslint-adjacent package still peered on 8, so npm produced a tree the lockfile disagrees with: `node_modules/eslint` records 10.8.1, the install resolves 8. Nothing in CI notices, because `npm run lint` runs whatever binary is on disk. A lint job can pass while linting under a version nobody chose.

**The ceiling is `eslint-plugin-import`.** Its peer range tops out below eslint 10, and 2.32.0 is the latest release:

```
eslint-plugin-import: {"eslint":"^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9"}
```

There is no version of that plugin that supports eslint 10. So "take eslint 10" is not a version bump — it is a decision to replace the plugin with the `eslint-plugin-import-x` fork (peers `^8.57 || ^9 || ^10`) or to stop linting imports.

**Any upgrade forces the config migration.** eslintrc is deprecated in eslint 9 and removed in 10, so `.eslintrc.cjs` had to become flat config regardless of which target we picked.

## Decision

### 1. ESLint 9 now; eslint 10 stays open

We take eslint 9 and the flat-config migration together. That clears the end-of-life problem, which is the actual risk, and puts the flat config in place so that reaching 10 later costs one dependency swap rather than a migration.

**#367 stays open, pointing here.** It is not an ignored Renovate PR; it is blocked on a real upstream constraint and on the question in §Alternatives about `import-x`.

### 2. The config is `eslint.config.mjs`, not `eslint.config.js`

This repo has no `"type": "module"`, so a bare `eslint.config.js` is parsed as CommonJS and must use `require()`. ESLint resolves `eslint.config.mjs` natively, which lets the config use `import` without changing the package type.

The forcing function was Codacy flagging six `Require statement not part of import statement` findings — one per `require()` in the config. The `.mjs` extension resolves that at the source rather than by suppression or a `.codacy.yml` exclusion, which is why it is recorded as a decision rather than a workaround.

### 3. `@babel/eslint-parser` is deleted, not bumped

It appears only in `package.json` and is referenced by no config; the parser is `@typescript-eslint/parser`. It was also one of the peer constraints pinning eslint to 8. #362 proposed bumping an unused dependency to unblock an upgrade it was itself blocking; deleting it closes #362 outright.

### 4. `eslint-config-prettier` is `^10.1.0`, not `^10.0.0`

`eslint-plugin-prettier` excludes 10.0.x by peer range — `">= 7.0.0 <10.0.0 || >=10.1.0"`. #431 as written (`^10.0.0`) can resolve into that hole. `eslint-plugin-prettier` itself moves `^5.0.0` → `^5.5.0`: it was locked at exactly 5.0.0, which predates the `/recommended` flat-config entry point.

### 5. Two `import` rules are off, with the evidence recorded

Both were tried before being switched off. Both suggestions are wrong in this repo, not merely noisy, and both are recorded in `eslint.config.mjs` so the next person does not retry them.

**`import/no-named-as-default`** flags `import rateLimit from 'express-rate-limit'`. Plain `require()` says the named and default exports are the same function object:

```
node -e "const m=require('express-rate-limit'); console.log(m.rateLimit === (m.default||m))"
true
```

Under ts-jest's CJS interop they are not. Taking the suggestion drops the unit suite from **1742 passing to 497**, because every suite transitively importing the rate limiter fails to load:

```
TypeError: (0 , express_rate_limit_1.rateLimit) is not a function
```

**`import/no-named-as-default-member`** flags `DOMPurify.sanitize(…)`. Here the two genuinely differ — `require('isomorphic-dompurify').sanitize === m.default.sanitize` is `false` — so the suggested rewrite would change which function sanitizes user HTML. That is the XSS boundary ([ADR-0031](0031-injected-css-threat-model.md)); it does not move on a lint hint. Not attempted.

Neither rule fired under `eslint-plugin-import` 2.27.5. Both are new advice about unchanged code, arriving with the 2.32 bump that eslint 9's peer range requires.

## Issues raised and circumvented

Recorded because each cost time to rediscover, and a flat-config migration silently drops exactly this class of thing.

- **The `@typescript-eslint` `eslint-recommended` overlay must be spread explicitly.** Under eslintrc it arrived free with `plugin:@typescript-eslint/recommended`. Omitting it leaves core rules on that TypeScript already enforces, and `no-redeclare` fires on declaration merging — `'InstallState' is already defined` in `installState.ts`.
- **`root: true` has no flat equivalent and needs none.** Flat config does not cascade out of the project directory, which is the nested-checkout case that flag existed for. The concern is now handled structurally rather than by a setting.
- **`--ext` is gone.** Flat config selects files by `files:` patterns. Without an explicit `**/*.ts` pattern, `eslint src prisma` matches only default JS extensions and exits 0 having linted nothing — a green lint job that checked no code.
- **A stale `eslint-disable` in `bbcode.spec.ts`** suppressed `import/first` and `@typescript-eslint/no-var-requires`, neither of which still fires. Removed.
- **Lockfile refreshes carry unversioned upgrades.** Separately, #357 ("npm non-major") moved prettier 3.0.0 → 3.9.6 and TypeScript 5.2.2 → 5.9.3 with no `package.json` change, breaking `prettier --check` on 15 files and `tsc` on `assetStore.ts`. `renovate.json` has `lockFileMaintenance` with `automerge: true`, so that class of change is configured to merge unattended. Pinning `typescript` and `prettier` exactly would make those moves explicit PRs; not decided here.

## Open question: does Codacy still earn its place

**Deliberately not decided.** Codacy was added early as a second opinion on typing and code cleanliness, and it has since gone stale on the team's radar — nobody reads it, and it is not in the branch-protection required checks (`["test", "integration"]`), so it can fail without blocking a merge. It is currently a red X that means nothing procedurally and is therefore trained to be ignored, which is worse than either keeping it properly or removing it.

Two things from this migration are evidence for that review rather than against Codacy as such:

- Its threshold is **zero new issues of any severity**, so a stylistic preference about one config file (`require()` vs `import`) presented identically to a correctness failure.
- The finding count coincided exactly with an unrelated lint warning count — six and six — which was misread as identification and produced a fix for a problem Codacy had not raised. That is a hazard of a tool whose findings are read as a number rather than a list.

The question to answer separately: what does Codacy catch that `tsc --noEmit`, `eslint`, and `prettier --check` do not? If the answer is "little", remove it and reclaim the review signal. If the answer is real, make it a required check and set a threshold worth blocking on. Either is better than the present state.

## Alternatives considered

**Swap `eslint-plugin-import` for `eslint-plugin-import-x`.** The maintained fork supports eslint 10 and is close to a drop-in, but rules move to the `import-x/` prefix and it is a different maintainer's package. Reaching one major sooner does not justify deciding that inside a Renovate bump; it belongs to whoever picks up #367.

**Drop import linting entirely.** Defensible — `import/no-unresolved` overlaps `tsc`, and this repo already carries a nine-entry ignore list to work around its false positives on type-only imports. Rejected for now because `recommended` also supplies `no-duplicates`, `named`, and `export`, which `tsc` does not replace, and because losing rules should be its own decision rather than a side effect of a version bump.

**Stay on eslint 8.** Rejected: it is end-of-life and unpatched, and Renovate will keep reopening the majors regardless.

**Suppress the config file in `.codacy.yml`.** Rejected: `.mjs` fixes the cause, and an exclusion would have hidden the finding while leaving the config CommonJS.

## Consequences

- `npm ci` installs the eslint the lockfile names — verified from a clean tree, which is the check #367 fails.
- Lint is silent again, matching main's baseline: 0 errors, 0 warnings.
- Two `import` rules no longer run anywhere in the repo. Their absence is documented at the point of suppression, with reproduction commands, so re-enabling them is a decision someone can evaluate rather than a mystery.
- eslint 10 remains unreachable until the `import-x` question is settled. #367 will keep appearing in the PR list; that is intended, and this ADR is what it points at.
- The flat config is stricter about what it lints by construction: file selection is explicit, so a future "lint passes but checked nothing" regression is visible in the config rather than invisible in a flag.
