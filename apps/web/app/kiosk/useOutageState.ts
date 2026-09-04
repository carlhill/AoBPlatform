'use client';

/**
 * THE OUTAGE HEARTBEAT (TODO.md "Outage screen on the tablet", Carl 4 Sep
 * 2026): "When the server is down, hide everything and say, Please contact
 * reception." Carl watched Begin still showing while core was down — that is
 * the bug this hook closes.
 *
 * ONE DEDICATED POLL, NOT A NEW ENDPOINT. `/kiosk/me` is the cheapest call the
 * tablet already makes — no PII, no waiting-room state, already whitelisted —
 * and it is one of the three sources TODO.md names (`/kiosk/me`, the waiting
 * list, the session poll). The other two only run on some screens
 * (`useWaitingList` and `useTabletSession` are both disabled on K-2, K-5, K-4
 * and the two end screens, "so a poll that nobody can see is noise" — see
 * their own comments), so an outage declared from either of them could never
 * be seen on those screens. This hook is the one signal that can run
 * everywhere the outage screen must be able to appear, and it obeys the SAME
 * cadence those two already settled on (`list.pollMs`, passed in) — "no
 * tighter retry loop hammering the server" (CLAUDE.md §7).
 *
 * TWO CONSECUTIVE FAILURES, NETWORK ERROR OR 5xx ONLY. A 401 means revoked or
 * rotated — the tablet's own unpaired handling already owns that, so this
 * stops polling rather than compete with it (mirrors `useWaitingList` and
 * `useTabletSession`). Any other 4xx is the server refusing something about
 * the request, never a sign the platform is unreachable, so it is ignored
 * outright: not counted as a failure, and not treated as a recovery either.
 *
 * RECOVERY FIRES ONCE, ON THE TRANSITION. `onRecovered` is called only the
 * poll after `active` was true — never on an ordinary healthy poll, which
 * would otherwise wipe out a ceremony in progress on every single success.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchKioskMe, isUnpaired, KioskApiError } from './api';

export interface OutageState {
  /** True once two consecutive polls have failed on a network error or 5xx. */
  readonly active: boolean;
}

const FALLBACK_POLL_MS = 15_000;
const FAILURES_BEFORE_OUTAGE = 2;

export function useOutageState(enabled: boolean, pollMs: number, onRecovered: () => void): OutageState {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const failuresRef = useRef(0);
  const unpairedRef = useRef(false);
  const visibleRef = useRef(true);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read fresh on every poll without making the effect below depend on
  // whatever closure Ceremony passed this render — the callback can change
  // (it closes over `clearCeremonyState`) without re-arming the timer.
  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;

  const poll = useCallback(async () => {
    try {
      await fetchKioskMe();
      if (!mountedRef.current) return;
      failuresRef.current = 0;
      if (activeRef.current) {
        activeRef.current = false;
        setActive(false);
        // THE ONLY CALL SITE. See the module comment: once, on recovery.
        onRecoveredRef.current();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (isUnpaired(err)) {
        unpairedRef.current = true;
        return;
      }
      /*
       * IGNORED OUTRIGHT (TODO.md: outage_ignores_401_and_4xx). A named 4xx
       * is the server answering, just not with a yes — the opposite of an
       * outage — so it neither advances the failure count nor resets it.
       */
      if (err instanceof KioskApiError && err.status >= 400 && err.status < 500) {
        return;
      }
      failuresRef.current += 1;
      if (failuresRef.current >= FAILURES_BEFORE_OUTAGE && !activeRef.current) {
        activeRef.current = true;
        setActive(true);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
    };
    visibleRef.current = typeof document === 'undefined' || document.visibilityState === 'visible';
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      // A FRESH START EVERY TIME THIS TURNS ON. Pairing and unpaired are
      // never shown the outage screen, so nothing carries a stale streak (or
      // a stale `active`) across them into the next ceremony.
      failuresRef.current = 0;
      unpairedRef.current = false;
      if (activeRef.current) {
        activeRef.current = false;
        setActive(false);
      }
      return;
    }
    let cancelled = false;
    const loop = async () => {
      if (cancelled || unpairedRef.current) return;
      if (visibleRef.current) await poll();
      if (cancelled || unpairedRef.current) return;
      timerRef.current = setTimeout(loop, pollMs || FALLBACK_POLL_MS);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, poll, pollMs]);

  return { active };
}
