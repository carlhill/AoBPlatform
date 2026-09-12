/**
 * A DEV TAB NOTICES THAT THE SERVER IT LOADED FROM HAS GONE (Carl, 12 Sep 2026:
 * "fix the dev kiosk build id so it reloads").
 *
 * WHY THE ORDINARY MECHANISM CANNOT DO THIS. A tablet reloads when the server
 * answers `reload: true`, which happens while its build is below the practice's
 * `minimumKioskBuild`. In dev `kioskBuildId()` is the constant `'dev'` and no
 * floor is ever set, so `kioskBuildIsStale` returns false forever and the tab
 * runs whatever it loaded until a person presses refresh. That cost a morning:
 * W6 landed, Carl signed, and the copy offer was not there because his tab
 * predated it.
 *
 * WHAT THIS DOES. Polls `/api/kiosk-build` while the tablet is BETWEEN
 * PATIENTS, remembers the first answer, and reports true once the answer
 * changes. It never reloads anything itself — it hands the fact to the same
 * one-reload-per-tab gate in `Ceremony` that the build floor and the
 * stale-bundle refusal already go through, so the reload still cannot land
 * mid-ceremony.
 *
 * DEVELOPMENT ONLY, TWICE OVER: the caller passes `enabled` false when
 * `NEXT_PUBLIC_BUILD_ID` is set, and the route itself reports `dev: false`
 * there, which this refuses to act on. A real tablet's reloads stay the
 * staged, per-practice, instantly-revertible thing CLAUDE.md §7 requires.
 *
 * IT PERSISTS NOTHING. The stamp lives in a ref for the life of the tab, like
 * everything else here (`kiosk_persists_nothing_but_pairing`).
 */
import { useEffect, useRef, useState } from 'react';

/** Slow on purpose: this is a developer convenience, not a health signal. */
const POLL_MS = 5_000;

export function useDevBuildWatch(enabled: boolean): boolean {
  const [changed, setChanged] = useState(false);
  /** The first build this tab ever saw. Null until the first successful read. */
  const seenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || changed) return;
    let live = true;

    const check = async () => {
      try {
        const res = await fetch('/api/kiosk-build', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { build?: unknown; dev?: unknown };
        // A deployed environment answers `dev: false`; acting on it there would
        // be a second, unstaged reload path, which is precisely what must not
        // exist.
        if (body.dev !== true || typeof body.build !== 'string') return;
        if (!live) return;
        if (seenRef.current === null) {
          seenRef.current = body.build;
          return;
        }
        if (seenRef.current !== body.build) setChanged(true);
      } catch {
        /*
         * A DEAD SERVER IS NOT A STALE BUILD. Mid-restart the fetch simply
         * fails; saying "changed" here would reload the tab into a server that
         * is not up yet. The next poll that SUCCEEDS is the one that decides.
         */
      }
    };

    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [enabled, changed]);

  return changed;
}
