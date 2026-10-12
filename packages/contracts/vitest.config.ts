/**
 * WHY THIS PACKAGE RUNS VITEST AND NOT JEST.
 *
 * `src/auth.test.ts` has imported from `vitest` since it was written on
 * 12 September 2026 — but the package had no `test` script, so nothing ever
 * ran it and nobody noticed. Adding the script is the fix; adding the runner
 * the test already asks for is cheaper and less disruptive than rewriting a
 * passing test to a different runner, and `apps/web` is on the same vitest.
 *
 * The include is pinned to `src` on purpose: `dist` is built output and
 * `tsconfig.build.json` already excludes tests from it, so a test discovered
 * there would be a stale copy of one that lives here.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
