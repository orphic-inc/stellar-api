/**
 * ESLint flat config — the eslintrc format this replaced is not supported by
 * ESLint 10 at all, so the migration came with the upgrade rather than by choice.
 *
 * The old `root: true` has no equivalent and needs none: flat config does not
 * cascade upward out of the project directory, which is exactly what that flag
 * was there to stop (a checkout nested inside another checkout picking up the
 * outer repo's config and loading @typescript-eslint from two node_modules).
 */
const js = require('@eslint/js');
const globals = require('globals');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const importPlugin = require('eslint-plugin-import');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
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
