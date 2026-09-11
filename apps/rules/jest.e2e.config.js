/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test',
  /*
   * AND THE PENDING SPECS. A *.pending.spec.ts in this folder is a conformance
   * suite for rules that have NOT been authored yet (CLAUDE.md section 7) --
   * collected so the runner reports it as skipped, because a suite nobody
   * collects is a suite nobody remembers. See enduring-ruleset.pending.spec.ts.
   */
  testRegex: '.*\\.(e2e-spec|pending\\.spec)\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
