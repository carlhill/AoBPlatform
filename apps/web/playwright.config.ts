/**
 * Playwright for the kiosk ceremony.
 *
 * IT RUNS AGAINST THE RUNNING DEV STACK, deliberately, and it does not start
 * one. The ceremony is only meaningful against a real `apps/core` with a real
 * Postgres behind it: the rules engine has to refuse or pass, the renderer has
 * to produce a hash, and RLS has to scope the waiting list. A mocked API would
 * prove that the screens call each other, which the Vitest suite already does
 * far more cheaply.
 *
 * SO IT IS NOT IN CI, and the script is `e2e:kiosk` rather than `test:e2e` for
 * exactly that reason: the root `npm run test:e2e` fans out across every
 * workspace, and CI has neither web on 3100 nor core on 3001.
 *
 *   npm run dev -w apps/web        # web on 3100
 *   npm run start:dev -w apps/core # core on 3001
 *   npm run e2e:kiosk -w apps/web
 *
 * ONE WORKER, NO RETRIES. The spec stages and then consumes a waiting patient;
 * two workers would race for the same row and the failure would look like a
 * flaky selector rather than what it is.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.KIOSK_WEB_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    // The tablet targets, not a laptop. The two-column layout starts at 900px.
    viewport: { width: 1024, height: 768 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
