/**
 * WHAT BUILD THIS WEB SERVER IS SERVING — for development only.
 *
 * THE PROBLEM IT SOLVES (Carl, 12 Sep 2026). A kiosk tab never picks up new
 * code by itself in dev. `kioskBuildId()` is the constant `'dev'` outside CI,
 * the practice build floor is therefore never crossed, and the server's
 * `reload: true` can never fire. Carl signed on the tablet after W6 landed and
 * saw none of it, because the tab was running the bundle it had loaded hours
 * earlier — and restarting the dev server makes it worse, since the tab loses
 * its hot-reload socket and then goes quiet rather than erroring.
 *
 * WHAT THIS IS. One number: the moment THIS server process started. A tab that
 * sees it change knows the server it loaded from is gone and what it is running
 * may be stale. That catches the case that actually bites — a dev server
 * restart under an open tab — and it deliberately does not try to catch an
 * edit that hot reload applied cleanly, because hot reload already handled
 * that one.
 *
 * WHAT IT IS NOT. It is not the rollout mechanism. Releases to real kiosks are
 * staged per practice with an instant rollback (CLAUDE.md §7), the build floor
 * on the practice record owns that, and none of it changes here. In a deployed
 * environment `NEXT_PUBLIC_BUILD_ID` is set, the client-side watcher that reads
 * this route is switched off, and this endpoint is inert.
 *
 * NO PII, NOTHING ABOUT ANY PATIENT, and nothing that identifies the machine —
 * a start time and a flag. It is readable without a pairing credential because
 * it says nothing worth protecting, and because a tab that has LOST its
 * credential is exactly one that may need to reload.
 */
import { NextResponse } from 'next/server';

/**
 * Evaluated once per server process, when this module is first loaded. A
 * restart produces a new module registry and therefore a new number, which is
 * the whole mechanism.
 */
const STARTED_AT = Date.now();

/** Next sets this; an env file cannot. */
const DEV = process.env.NODE_ENV !== 'production';

/** Never cached: a cached answer is the same tab staring at its own stale copy. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    {
      /*
       * `NODE_ENV` DECIDES, NOT THE BUILD ID. `apps/web/.env.local` already sets
       * `NEXT_PUBLIC_BUILD_ID=dev`, so "is the build id missing" answers false
       * on a developer's machine and the watcher would have stayed switched
       * off — the exact bug it exists to fix, reintroduced one layer down.
       * `NODE_ENV` is set by Next itself and cannot be spoofed by an env file.
       */
      build: DEV ? `dev-${STARTED_AT}` : (process.env.NEXT_PUBLIC_BUILD_ID ?? 'unknown'),
      /** True only in development, where the watcher is allowed to act on it. */
      dev: DEV,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
