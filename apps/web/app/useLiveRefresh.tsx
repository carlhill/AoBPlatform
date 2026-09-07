'use client';

/**
 * Re-fetch a screen that is waiting on somebody else.
 *
 * THE PROBLEM IT SOLVES. A practice invites a practitioner and then sits on the
 * affiliations page waiting. The practitioner opens their email, types the
 * code, and accepts — and the practice's screen goes on saying "awaiting their
 * answer" until somebody thinks to reload. The work happened; the screen lied
 * about it.
 *
 * WHY POLLING RATHER THAN A PUSH. A websocket or an SSE stream is the obvious
 * "proper" answer and is the wrong trade here. The event we are waiting for
 * arrives minutes or hours later, at most a handful of times per practice per
 * week, and a push channel would mean a connection to hold open, a reconnect
 * strategy, a fan-out from the accept handler, and a new failure mode where
 * the screen is silently stale because a socket died quietly. Polling a REST
 * endpoint that already exists has none of that and fails visibly.
 *
 * THREE THINGS KEEP IT CHEAP, and all three matter:
 *
 *   1. IT ONLY RUNS WHEN SOMETHING IS ACTUALLY PENDING. A page with nothing
 *      outstanding polls not at all. This is the whole difference between a
 *      refresh and a busy-loop.
 *   2. IT STOPS WHEN THE TAB IS HIDDEN. A console left open on a second
 *      monitor overnight should not be talking to the server all night.
 *   3. IT REFRESHES IMMEDIATELY ON RETURN. This is the case that actually
 *      happens: switch to the email client, accept, switch back. The interval
 *      is the fallback; the focus check is what makes it feel instant.
 */

import { useEffect, useRef } from 'react';

/** Long enough to be unnoticeable, short enough that nobody reaches for F5. */
export const LIVE_REFRESH_MS = 15_000;

export function useLiveRefresh(
  /** Whether anything is outstanding. False means do nothing at all. */
  active: boolean,
  refresh: () => void | Promise<void>,
  intervalMs: number = LIVE_REFRESH_MS,
): void {
  /*
   * The callback is held in a ref so that a caller passing an inline function
   * — which is every caller — does not tear down and rebuild the interval on
   * every render. Without this the timer would restart constantly and, on a
   * page that re-renders often, might never actually fire.
   */
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!active) return;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const run = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      void latest.current();
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Straight away, not on the next tick. Coming back to the tab IS the
        // moment somebody wants to know.
        run();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', run);

    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', run);
    };
  }, [active, intervalMs]);
}
