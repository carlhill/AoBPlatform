'use client';

/**
 * The waiting-room poll (§9.4).
 *
 * WHY A POLL AT ALL. `useLiveRefresh.tsx` in the console argues for polling
 * over push and is right about it — a dead socket fails silently, a poll fails
 * visibly. The kiosk is the case where that file's own conditions ("minutes or
 * hours, a handful of times a week") fail: seconds, many times a day, a person
 * standing there. The answer is still a poll, just a much faster one.
 *
 * THE CADENCE IS THE SERVER'S, NOT OURS. Every response carries `pollMs` — two
 * seconds while anybody is waiting, fifteen while nobody is — and this hook
 * obeys it. That is what lets the interval change for every tablet in the
 * country in one place, and it is why there is no interval constant in this
 * file to "tune". `FALLBACK_POLL_MS` is what to do before the first answer
 * arrives, which is a different question.
 *
 * AND IT IS CHEAP. The ETag goes back out as `If-None-Match`, so an unchanged
 * list answers 304 with no body: no JSON to parse, no re-render, no new array
 * identity. The state is only replaced when the revision actually changed.
 *
 * ONLY WHILE THE TAB IS VISIBLE. `visibilitychange` stops the timer when the
 * tablet is asleep or the tab is in the background — a tablet in a drawer
 * polling every two seconds all night is just noise in the logs. This is the
 * web equivalent of the Expo build's `AppState` listener.
 *
 * A FAILURE IS SHOWN, NOT SWALLOWED (REQ-REC-04). The hook reports the error
 * and keeps the last good list on screen; the screen offers reception. Nothing
 * here can stop a patient being seen.
 *
 * A 401 IS THE ONE FAILURE THAT STOPS THE LOOP. It means the device was
 * revoked or rotated, and it will mean that for every future poll — so the
 * hook reports `unpaired` and the timer is not re-armed. "No retry loop
 * hammering the server" is the requirement (TODO.md, "Zero-footprint kiosk"),
 * and a tablet retrying a dead credential every two seconds is a tablet
 * somebody has to visit in order to quieten, which is the expense the whole
 * decision exists to avoid.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWaitingList, isUnpaired, type KioskWaitingRow, type WaitingListResponse } from './api';

export interface WaitingListState {
  readonly rows: readonly KioskWaitingRow[];
  readonly identifierTypes: readonly string[];
  readonly pollMs: number;
  readonly revision: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** The server refused this tablet's credential. Terminal: the poll stops. */
  readonly unpaired: boolean;
  /**
   * THE SERVER'S LIVE ANSWER TO "MAY THIS TABLET SEE NAMES" (Carl, 4 Sep
   * 2026). `true` on an ordinary tablet: no rows and no count. `false` on a
   * test device. `null` before the first response, when the tablet only has
   * `/kiosk/me`'s answer from start-up to go on.
   *
   * IT RIDES THE POLL SO THE CONSOLE TOGGLE IS LIVE. A staff member flipping
   * "Test device" on `/practice/devices` must reach a tablet already sitting
   * on its idle screen — within one poll, with no re-pairing and no reload —
   * and `hidden` is inside the ETag (see the server's `revisionOf`), so the
   * change cannot be swallowed by a 304 on a quiet morning.
   */
  readonly hidden: boolean | null;
  /**
   * Somebody is waiting -- true/false once the server has answered, null before.
   * On a hidden response it is the server's boolean; on a test device it is
   * whether any rows came back. Never a number.
   */
  readonly anyoneWaiting: boolean | null;
  /** This tab is below the practice's build floor and must hard-reload. */
  readonly reload: boolean;
  /** How many polls came back 304 — evidence the ETag path is doing its job. */
  readonly notModifiedCount: number;
  readonly refresh: () => void;
}

const FALLBACK_POLL_MS = 15_000;

export function useWaitingList(enabled: boolean): WaitingListState {
  const [body, setBody] = useState<WaitingListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notModifiedCount, setNotModifiedCount] = useState(0);
  const [unpaired, setUnpaired] = useState(false);
  const etagRef = useRef<string | null>(null);
  // Read by the loop as well as by the render, so the timer stops on the same
  // tick the refusal arrives rather than one poll later.
  const unpairedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(true);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const result = await fetchWaitingList(etagRef.current);
      if (!mountedRef.current) return;
      if (result.kind === 'notModified') {
        setNotModifiedCount((n) => n + 1);
      } else {
        etagRef.current = result.etag;
        setBody(result.body);
      }
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      /*
       * REVOKED, AND THAT IS THE END OF IT. Not an error to show beside a
       * stale list — the list on screen is a practice's patient names and the
       * server has just said this tablet may not have them. The ceremony drops
       * to the unpaired screen and nothing is polled again.
       */
      if (isUnpaired(err)) {
        unpairedRef.current = true;
        setUnpaired(true);
        return;
      }
      setError((err as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
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

  const pollMs = body?.pollMs;

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
    // `pollMs` deliberately re-arms the loop when the server changes its mind
    // about the cadence — an empty room slowing to 15s, a walk-in speeding it
    // back to 2s.
  }, [enabled, poll, pollMs]);

  return {
    rows: body?.waiting ?? [],
    identifierTypes: body?.identifierTypes ?? [],
    pollMs: body?.pollMs ?? FALLBACK_POLL_MS,
    revision: body?.revision ?? null,
    loading,
    error,
    unpaired,
    hidden: body === null ? null : body.hidden !== false,
    anyoneWaiting:
      body === null ? null : body.hidden !== false ? body.anyoneWaiting !== false : body.waiting.length > 0,
    reload: body?.reload === true,
    notModifiedCount,
    refresh: () => {
      // A revoked tablet does not get a Try again that cannot work.
      if (unpairedRef.current) return;
      void poll();
    },
  };
}
