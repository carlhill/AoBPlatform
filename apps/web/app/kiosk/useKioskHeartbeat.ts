'use client';

/**
 * THE HEARTBEAT — one poll, on every screen, carrying the tablet's own state
 * out and reception's instructions back (Carl, 4–5 Sep 2026; TODO.md "Tablet
 * heartbeat and Return to Begin").
 *
 * IT WAS `useOutageState` AND IT IS THE SAME LOOP. That hook existed for one
 * job: "when the server is down, hide everything and say, Please contact
 * reception" (Carl, 4 Sep 2026, having watched Begin still showing while core
 * was down). Every line of the failure counting and the recovery semantics
 * below is that hook's, unchanged, and its tests still hold them. What changed
 * is the call it makes and therefore what it can answer.
 *
 * ONE DEDICATED POLL, AND IT HAD TO BECOME AN EXCHANGE. `/kiosk/me` was the
 * cheapest call the tablet already made, and it is one of three the tablet
 * makes — but the other two only run on SOME screens (`useWaitingList` and
 * `useTabletSession` are both disabled on K-2, K-5, K-4 and the two end
 * screens, "so a poll that nobody can see is noise"). This hook is the one
 * signal that runs everywhere, which makes it the only place that can carry
 * two facts nothing else could:
 *
 *   - WHERE THE TABLET IS. Before this, a walk-up half-way through verifying
 *     was invisible from the console: recall only reaches a pushed session,
 *     and the session poll is deliberately off during a walk-up. Now the
 *     device row can say "Walk-up in progress · verifying identity".
 *   - WHAT RECEPTION WANTS. `return_to_begin` comes back on the answer. There
 *     is no other channel to a device that holds one opaque credential; a
 *     socket would fail silently, and a silently dead reset is a tablet
 *     reception cannot get back.
 *
 * THE SERVER SETS THE CADENCE, and here that matters more than it did on the
 * waiting list. The list poll is off mid-ceremony, so on those screens this
 * hook's own `pollMs` is the only cadence there is — which is why the response
 * carries one and this hook prefers it over the number it was handed.
 *
 * TWO CONSECUTIVE FAILURES, NETWORK ERROR OR 5xx ONLY — unchanged. A 401 means
 * revoked or rotated, and the tablet's own unpaired handling already owns
 * that, so this stops polling rather than compete with it. Any other 4xx is
 * the server refusing something about the request, never a sign the platform
 * is unreachable, so it is ignored outright: not counted as a failure, and not
 * treated as a recovery either.
 *
 * RECOVERY FIRES ONCE, ON THE TRANSITION — unchanged. `onRecovered` is called
 * only the poll after `outage` was true; on an ordinary healthy poll it would
 * wipe out a ceremony in progress every couple of seconds.
 *
 * NOTHING IS WRITTEN TO THE DEVICE. The screen name, the session id and the
 * pending command are React state and refs; there is no storage call in this
 * file and there must not be (CLAUDE.md §7, `kiosk_persists_nothing_but_pairing`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KioskCommand, KioskScreen } from '@aobplatform/domain';
import { isUnpaired, KioskApiError, sendKioskHeartbeat } from './api';
import { kioskBuildId } from './session';

export interface HeartbeatState {
  /** True once two consecutive polls have failed on a network error or 5xx. */
  readonly outage: boolean;
  /**
   * Reception has taken this tablet off the floor. It keeps heartbeating —
   * that is the whole difference from a revoke — so this clears itself the
   * moment somebody puts it back in use, with nobody visiting the device.
   *
   * IT IS THE LAST THING THE SERVER SAID, held through an outage rather than
   * reset by one: a tablet that could not be reached has not been put back.
   */
  readonly outOfUse: boolean;
}

const FALLBACK_POLL_MS = 15_000;
const FAILURES_BEFORE_OUTAGE = 2;

export function useKioskHeartbeat({
  enabled,
  pollMs,
  screen,
  sessionId,
  onRecovered,
  onCommand,
}: {
  /** Every screen but pairing, unpaired and the first paint. */
  enabled: boolean;
  /** The cadence the server last asked for elsewhere; the answer's own wins. */
  pollMs: number;
  /** One of `KIOSK_SCREENS`. Never a heading, never a typed value. */
  screen: KioskScreen;
  /** The opaque pushed-session id, or null for a walk-up and for Begin. */
  sessionId: string | null;
  onRecovered: () => void;
  /** Called ONCE per command id, as it is first seen. */
  onCommand: (command: KioskCommand) => void;
}): HeartbeatState {
  const [outage, setOutage] = useState(false);
  const [outOfUse, setOutOfUse] = useState(false);
  const outageRef = useRef(false);
  const failuresRef = useRef(0);
  const unpairedRef = useRef(false);
  const visibleRef = useRef(true);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cadenceRef = useRef(pollMs);
  cadenceRef.current = cadenceRef.current || pollMs;

  /*
   * WHAT THE NEXT REQUEST SAYS, read fresh at send time rather than closed
   * over. `screen` and `sessionId` change on nearly every render — the whole
   * point of the hook is that they do — and an effect that depended on them
   * would tear down and re-arm the timer every time the patient touched
   * anything, which is a poll that never fires at its own cadence.
   */
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  /**
   * THE COMMAND THIS TABLET HAS CARRIED OUT AND NOT YET HAD CLEARED. It rides
   * on the next heartbeat as `ackCommandId`; until the server sees it, the
   * same command comes back on every answer, so one dropped request does not
   * lose a reset. Cleared when the server stops sending it.
   */
  const ackRef = useRef<string | null>(null);
  /** So a command served twice (before the ack lands) is acted on once. */
  const handledRef = useRef<string | null>(null);

  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const poll = useCallback(async () => {
    try {
      const answer = await sendKioskHeartbeat({
        screen: screenRef.current,
        sessionId: sessionRef.current,
        build: kioskBuildId(),
        ackCommandId: ackRef.current,
      });
      if (!mountedRef.current) return;
      failuresRef.current = 0;
      if (answer.pollMs > 0) cadenceRef.current = answer.pollMs;
      setOutOfUse(answer.outOfUse);

      if (answer.command) {
        // Served again until acknowledged, so this is where "once" is decided.
        if (handledRef.current !== answer.command.id) {
          handledRef.current = answer.command.id;
          ackRef.current = answer.command.id;
          onCommandRef.current(answer.command);
        }
      } else {
        // The server has let it go — acknowledged, or expired unclaimed. Either
        // way this tablet has nothing outstanding to echo back.
        ackRef.current = null;
      }

      if (outageRef.current) {
        outageRef.current = false;
        setOutage(false);
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
      if (failuresRef.current >= FAILURES_BEFORE_OUTAGE && !outageRef.current) {
        outageRef.current = true;
        setOutage(true);
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
      // a stale `outage`) across them into the next ceremony.
      failuresRef.current = 0;
      unpairedRef.current = false;
      if (outageRef.current) {
        outageRef.current = false;
        setOutage(false);
      }
      return;
    }
    let cancelled = false;
    const loop = async () => {
      if (cancelled || unpairedRef.current) return;
      if (visibleRef.current) await poll();
      if (cancelled || unpairedRef.current) return;
      timerRef.current = setTimeout(loop, cadenceRef.current || pollMs || FALLBACK_POLL_MS);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, poll, pollMs]);

  return { outage, outOfUse };
}
