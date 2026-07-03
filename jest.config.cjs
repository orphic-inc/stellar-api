module.exports = {
  testEnvironment: 'node',
  maxWorkers: '50%',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  resetMocks: true,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          // Transpile-only — do NOT remove. Without this, ts-jest full-type-checks
          // each suite's entire import graph in every parallel worker; on a busy
          // CPU the heavy suites (docs/search/rules/communities) get time-sliced
          // past the default 5s testTimeout and flake. isolatedModules drops the
          // full run from minutes (with timeouts) to ~50s, clean. Type safety is
          // still enforced by `npx tsc --noEmit` in the commit gate / CI.
          // (Lives inside `tsconfig` because the transformer-level option is
          // deprecated in ts-jest and warns once per worker.)
          isolatedModules: true,
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          types: ['jest', 'node']
        }
      }
    ]
  }
};
