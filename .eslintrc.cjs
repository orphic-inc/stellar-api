module.exports = {
  // Stop the config cascade here: a checkout nested inside another checkout
  // (e.g. a git worktree under .claude/worktrees/) otherwise inherits the
  // outer repo's .eslintrc.cjs too, and ESLint refuses to load the
  // @typescript-eslint plugin from two node_modules at once.
  root: true,
  env: {
    es2020: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'plugin:import/recommended'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 12
  },
  plugins: ['@typescript-eslint'],
  rules: {
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
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.ts', '.d.ts'],
        paths: ['./src']
      }
    }
  }
};
