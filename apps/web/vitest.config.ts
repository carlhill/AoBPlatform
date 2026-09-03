/**
 * Vitest for the web app — introduced with the kiosk port (Carl, 3 Sep 2026).
 *
 * WHY NOT JEST, WHICH THE REST OF THE REPO PINS TO ^29.7.0 (CONVENTIONS.md
 * §3). That pin exists for `ts-jest` and `jest-expo`, and both leave with
 * `apps/kiosk`. Next compiles with SWC and the web app has no Jest transform
 * of its own; adding one would mean a second TypeScript pipeline whose config
 * has to be kept in step with `next.config.mjs` by hand. Vitest reads the same
 * `tsconfig.json` the dev server and `npm run typecheck` read, so a test and
 * the page under test cannot disagree about how the code compiles.
 *
 * SCOPED TO THE KIOSK, for now. There is no pretence that the console is
 * covered; this names exactly what is, so nobody reads a green run as more
 * than it is.
 *
 * The Playwright ceremony spec is excluded here and run by `npm run e2e:kiosk`
 * — it needs a live core and a live web server and has no business in a unit
 * run (or, for the same reason, in CI's `npm run test`).
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['app/kiosk/**/*.test.ts', 'app/kiosk/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    restoreMocks: true,
  },
});
