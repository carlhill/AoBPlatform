'use client';

/**
 * THE PUSHED SESSION POLL — the tablet's half of "send to the tablet"
 * (TODO.md "Two front doors", Carl 4 Sep 2026).
 *
 * A SECOND POLL, NOT A SECOND MECHANISM, and the choice was forced rather than
 * preferred: `GET /kiosk/waiting-list` does not carry a session (see
 * `WaitingListResponse` — there is no field for one, and adding one would be a
 * change to `apps/core`, which this build does not make). So this asks
 * `GET /kiosk/session` on its own, AT THE CADENCE THE WAITING LIST WAS TOLD.
 * The server still owns the number — two seconds while somebody is waiting,
 * fifteen while nobody is — and the two polls stay in step without this file
 * inventing an interval to "tune".
 *
 * NO ETAG, BECAUSE THE SERVER SENDS NONE. It answers for ONE device about ONE
 * session and is mostly `null`, so the tag would cost more than it saved — and
 * a 304 on a response carrying a date of birth and an address would be a cached
 * copy on the device, which the zero-footprint rule does not want
 * (`kiosk-session.controller.ts` says exactly this).
 *
 * A FAILED POLL DOES NOT CLEAR THE SESSION. Only an explicit `{ session: null }`
 * does. A patient standing at a tablet must not be thrown back to the idle
 * screen because one request timed out; the ceremony survives the gap and the
 * next answer settles it. That is the same instinct as the waiting list keeping
 * its last good rows on screen (REQ-REC-04).
 *
 * A 401 IS THE ONE FAILURE THAT STOPS THE LOOP — revoked or rotated, and it
 * will mean that on every future poll. No retry loop hammering the server
 * (CLAUDE.md §7).
 *
 * ONLY WHILE THE TAB IS VISIBLE, and nothing is written anywhere: the payload
 * lives in React state for as long as the session does and is dropped with it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTabletSession, isUnpaired, type TabletSessionPayload } from './api';

export interface TabletSessionState {
  /** The live session, or null when the server says there is none. */
  readonly session: TabletSessionPayload | null;
  /**
   * WHETHER THE SERVER HAS ANSWERED AT ALL. `session === null` before the first
   * answer means "we have not asked yet", which is a different thing from
   * "there is nothing on this tablet" — and the difference decides whether a
   * pushed ceremony should be torn down. Before the first answer, nothing is.
   */
  readonly answered: boolean;
  /** The server refused this tablet's credential. Terminal: the poll stops. */
  readonly unpaired: boolean;
}

const FALLBACK_POLL_MS = 15_000;

export function useTabletSession(enabled: boolean, pollMs?: number): TabletSessionState {
  const [session, setSession] = useState<TabletSessionPayload | null>(null);
  const [answered, setAnswered] = useState(false);
  const [unpaired, setUnpaired] = useState(false);
  const unpairedRef = useRef(false);
  const visibleRef = useRef(true);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const body = await fetchTabletSession();
      if (!mountedRef.current) return;
      setSession(body.session ?? null);
      setAnswered(true);
    } catch (err) {
      if (!mountedRef.current) return;
      if (isUnpaired(err)) {
        unpairedRef.current = true;
        setUnpaired(true);
        return;
      }
      /*
       * SWALLOWED ON PURPOSE, AND IT IS NOT THE SAME AS IGNORING IT. The
       * waiting-list poll is this tablet's health signal and already shows a
       * server it cannot reach; a second error message about the same outage
       * would say nothing new, and tearing a ceremony down over one bad request
       * would be the tablet blocking care over a network blip.
       */
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
      return;
    }
    let cancelled = false;
    const loop = async () => {
      if (cancelled || unpairedRef.current) return;
      if (visibleRef.current) await poll();
      if (cancelled || unpairedRef.current) return;
      timerRef.current = setTimeout(loop, pollMs ?? FALLBACK_POLL_MS);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, poll, pollMs]);

  return { session, answered, unpaired };
}
