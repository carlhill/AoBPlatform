/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test',
  // Suites share one real Postgres and the unscoped vault_outbox table —
  // parallel workers interfere (one suite's cleanup deletes another's
  // evidence rows mid-flight; observed, not theoretical). Serial, always.
  maxWorkers: 1,
  // Runs before any suite builds a Nest application: clears the ABN Lookup
  // GUID so e2e never calls the real Australian Business Register. See the
  // file for why that has to be an empty value rather than a deleted key.
  setupFiles: ['<rootDir>/offline-abr.setup.ts'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
