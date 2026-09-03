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
 * file to "tune".
 *
 * AND IT IS CHEAP. The ETag goes back out as `If-None-Match`, so an unchanged
 * list answers 304 with no body: no JSON to parse, no re-render, no new array
 * identity. The state is only replaced when the revision actually changed.
 *
 * ONLY WHILE THE TABLET IS AWAKE. `AppState` stops the timer when the app is
 * backgrounded — a tablet in a drawer polling every two seconds all night is
 * just noise in the logs.
 *
 * A FAILURE IS SHOWN, NOT SWALLOWED (REQ-REC-04). The hook reports the error
 * and keeps the last good list on screen; the screen offers reception. Nothing
 * here can stop a patient being seen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchWaitingList } from '../api/client';
import type { KioskWaitingRow, WaitingListResponse } from '../api/types';

export interface WaitingListState {
  readonly rows: readonly KioskWaitingRow[];
  readonly identifierTypes: readonly string[];
  readonly pollMs: number;
  readonly revision: string | null;
  readonly loading: boolean;
  readonly error: string | null;
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
  const etagRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);
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
      setError((err as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      activeRef.current = next === 'active';
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      if (activeRef.current) await poll();
      if (cancelled) return;
      const wait = body?.pollMs ?? FALLBACK_POLL_MS;
      timerRef.current = setTimeout(loop, wait);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `body?.pollMs` deliberately re-arms the loop when the server changes its
    // mind about the cadence — an empty room slowing to 15s, a walk-in
    // speeding it back to 2s.
  }, [enabled, poll, body?.pollMs]);

  return {
    rows: body?.waiting ?? [],
    identifierTypes: body?.identifierTypes ?? [],
    pollMs: body?.pollMs ?? FALLBACK_POLL_MS,
    revision: body?.revision ?? null,
    loading,
    error,
    notModifiedCount,
    refresh: () => {
      void poll();
    },
  };
}
