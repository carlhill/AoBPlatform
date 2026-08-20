/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test',
  // Suites share one real Postgres and the unscoped vault_outbox table —
  // parallel workers interfere (one suite's cleanup deletes another's
  // evidence rows mid-flight; observed, not theoretical). Serial, always.
  maxWorkers: 1,
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
