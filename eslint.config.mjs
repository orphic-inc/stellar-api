/**
 * ESLint flat config — the eslintrc format this replaced is not supported by
 * ESLint 10 at all, so the migration came with the upgrade rather than by choice.
 *
 * The old `root: true` has no equivalent and needs none: flat config does not
 * cascade upward out of the project directory, which is exactly what that flag
 * was there to stop (a checkout nested inside another checkout picking up the
 * outer repo's config and loading @typescript-eslint from two node_modules).
 */
import js from '@eslint/js';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'prisma/erd/**']
  },

  // Every block below is scoped to *.ts. Flat config has no `--ext`, so the
  // `files` pattern is what makes `eslint src prisma` look at TypeScript at all
  // — without it the run silently matches only the default JS extensions and
  // reports success having linted nothing.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 12,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2020
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.ts', '.d.ts'],
          paths: ['./src']
        }
      }
    },
    rules: {
      ...js.configs.recommended.rules,

      // The overlay that switches off core rules TypeScript already enforces —
      // `no-redeclare`, `no-undef` and friends, which false-positive on
      // declaration merging and type-only names. Under eslintrc this came in
      // free with `plugin:@typescript-eslint/recommended`; in flat config it is
      // a separate config that has to be spread explicitly, and omitting it
      // fails on `installState.ts` ("'InstallState' is already defined").
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,

      ...tsPlugin.configs.recommended.rules,
      ...importPlugin.flatConfigs.recommended.rules,

      // Types are declared, not imported at runtime, so the resolver cannot see
      // these. Carried over verbatim from .eslintrc.cjs.
      'import/no-unresolved': [
        'error',
        {
          ignore: [
            '@asteasolutions/zod-to-openapi',
            '@prisma/client',
            '@sentry/node',
            'bcryptjs',
            'express-rate-limit',
            'isomorphic-dompurify',
            'jest-mock-extended',
            'katex',
            'nodemailer'
          ]
        }
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Both off because the advice is wrong here, not merely noisy. Each was
      // tried before being switched off, and each broke something.
      //
      // no-named-as-default flags `import rateLimit from 'express-rate-limit'`
      // and suggests the named export. Plain `require()` agrees the two are the
      // same function — but under ts-jest's CJS interop the named form resolves
      // to undefined and every suite that transitively imports the rate limiter
      // dies with `(0, express_rate_limit_1.rateLimit) is not a function`.
      // 1742 passing unit tests drop to 497.
      //
      // no-named-as-default-member flags `DOMPurify.sanitize(…)` the same way,
      // and there the two genuinely differ:
      //
      //   require('isomorphic-dompurify').sanitize === m.default.sanitize  // false
      //
      // Taking that suggestion would change which function sanitizes user HTML.
      // That is the XSS boundary; it does not move on a lint hint.
      //
      // Neither rule fired before eslint-plugin-import 2.32, which the eslint 9
      // peer range requires — so this is new advice about unchanged code.
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',

      // TypeScript already resolves identifiers, and no-undef cannot see type-only
      // names, so it reports false positives on a TS codebase. This is what
      // plugin:@typescript-eslint/recommended did for us under eslintrc.
      'no-undef': 'off'
    }
  },

  // Last so its formatting rules win, and so eslint-config-prettier switches off
  // every stylistic rule the blocks above turned on.
  {
    ...prettierRecommended,
    files: ['**/*.ts']
  }
];
