/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.integration.ts'],
  globalSetup: '<rootDir>/globalSetup.js',
  globalTeardown: '<rootDir>/globalTeardown.js',
  setupFiles: ['<rootDir>/src/test/integrationSetup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  moduleNameMapper: {
    '^isomorphic-dompurify$': '<rootDir>/src/test/mocks/dompurify.ts'
  },
  clearMocks: true,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          // Transpile-only, same rationale as jest.config.cjs (#306): without
          // this, ts-jest full-type-checks each suite's import graph — the
          // dominant term of the CI integration step. Type safety for these
          // files is enforced by `npm run typecheck:test` (its exclude is only
          // `dist`, so *.integration.ts is covered).
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
