'use client';

/**
 * RETURN TO THE START WHEN THE TABLET IS UNTOUCHED (Carl, 4 September 2026).
 *
 * > "Return to the start when untouched for N minutes — a per-practice
 * > setting, default 5 minutes. Applies to every kiosk screen except idle."
 *
 * WHAT IT IS FOR, because the wording "idle timeout" undersells it. A patient
 * is called in part-way through the ceremony, or reads two lines and wanders
 * off. The tablet is then sitting on a counter in a waiting room with
 * somebody's name, date of birth and address on it, and the next person to
 * pick it up is a stranger. C2's "no residual patient data on device after
 * submission" has always covered the END of the ceremony; this covers the
 * middle of one that never ends.
 *
 * THE NUMBER IS THE PRACTICE'S, NOT OURS. It arrives on `GET /kiosk/me` with
 * everything else the tablet asks about itself, bounded 60..1800 by the server,
 * and this hook simply counts it down. There is no setting on the device — a
 * device with settings is a device somebody can configure at the tablet.
 *
 * A WARNING FIRST, AND ANY TOUCH CANCELS IT. Thirty seconds before the reset a
 * quiet overlay asks "Still there?". It is not a dialog and it has no button:
 * every pointer, touch and key event on the page already re-arms the clock, so
 * the answer to "still there?" is to touch the screen, which is what somebody
 * standing at a tablet does anyway. A modal with an "I'm still here" button
 * would be a control that must be found and pressed by a person who may be
 * unwell, standing up, on a screen they did not ask for.
 *
 * TIMERS ARE MEMORY (CLAUDE.md §7). Nothing here is written anywhere: no
 * storage, no cookie, no service worker, no "last activity" stamp that could
 * outlive the tab. A reload starts the clock again, which is correct — a
 * reloaded tab is showing nobody's details.
 *
 * IT NEVER BLOCKS CARE (hard rule 8, REQ-REC-04). Expiry drops the screen back
 * to idle and, on a pushed session, tells the server the session `timed_out`
 * — the same effect as the patient pressing "See reception" and walking away,
 * but a different word, so reception can tell the two apart (Carl's ruling,
 * 4 Sep 2026). It changes NOTHING about the agreement: no transition, no
 * lock, no decline. The patient is still seen, and reception still chooses
 * what to do after the service.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { KIOSK_IDLE_WARNING_SECONDS, kioskIdleTimeoutOrDefault } from '@aobplatform/domain';

/**
 * THE EVENTS THAT COUNT AS SOMEBODY BEING THERE.
 *
 * Pointer events cover mouse, touch and pen in one listener on every browser
 * this device will ever run; `touchstart` is kept beside them for the older
 * Android webviews a practice may still have on a shelf, and `keydown` for the
 * verification form, which is the one screen somebody uses without touching
 * the glass again for a while.
 *
 * DELIBERATELY NOT `pointermove` ALONE: a tablet on a counter with a cracked
 * digitiser can emit those on its own, and a clock that a faulty screen keeps
 * re-arming is no clock at all. Movement counts only as part of an actual
 * interaction — down, up, wheel, key.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'keydown', 'wheel'] as const;

export interface InactivityState {
  /**
   * Seconds left before the reset, while the warning is showing. `null` the
   * rest of the time, which is what the overlay keys off — there is no
   * separate "is the warning up" boolean to drift out of step with it.
   */
  readonly warningSecondsLeft: number | null;
}

export function useInactivityReset({
  enabled,
  timeoutSeconds,
  onExpire,
}: {
  /**
   * Every kiosk screen EXCEPT idle. The idle screen holds nothing about
   * anybody and is already the place this hook sends the tablet, so a clock on
   * it would be a timer whose only job is to stay where it is.
   */
  enabled: boolean;
  /** From `GET /kiosk/me`. Out-of-range or absent falls back to the domain default. */
  timeoutSeconds: number;
  onExpire: () => void;
}): InactivityState {
  const [warningSecondsLeft, setWarningSecondsLeft] = useState<number | null>(null);

  /*
   * THE CALLBACK IN A REF, and this is load-bearing rather than tidy. `onExpire`
   * closes over the pushed session so it can post `timed_out`, so it is a new
   * function on almost every render. If the arming effect depended on it, every
   * render would restart the clock and the tablet would never time out at all —
   * the exact failure this feature exists to prevent, arriving silently.
   */
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (expireTimer.current) clearTimeout(expireTimer.current);
    if (tick.current) clearInterval(tick.current);
    warnTimer.current = null;
    expireTimer.current = null;
    tick.current = null;
  }, []);

  const total = kioskIdleTimeoutOrDefault(timeoutSeconds);
  /*
   * The warning window, never longer than the timeout itself. The server's
   * floor is sixty seconds so thirty is always comfortably inside it; this
   * clamp exists so a future shorter floor cannot produce a warning that was
   * due before the screen was drawn.
   */
  const warnFor = Math.min(KIOSK_IDLE_WARNING_SECONDS, Math.max(1, total - 1));

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setWarningSecondsLeft(null);
      return;
    }

    /**
     * Back to the top of the clock. Called on arm and on every touch — the
     * warning is dropped the moment it is, which is what "tapping anywhere
     * cancels" means.
     */
    const arm = (): void => {
      clearTimers();
      setWarningSecondsLeft(null);
      warnTimer.current = setTimeout(
        () => {
          setWarningSecondsLeft(warnFor);
          tick.current = setInterval(() => {
            // Floors at zero rather than going negative: the expiry timer is
            // what actually ends it, and a countdown showing "-1 s" for the
            // instant between them would be a bug on a patient's screen.
            setWarningSecondsLeft((left) => (left === null ? null : Math.max(0, left - 1)));
          }, 1_000);
          expireTimer.current = setTimeout(() => {
            clearTimers();
            setWarningSecondsLeft(null);
            onExpireRef.current();
          }, warnFor * 1_000);
        },
        (total - warnFor) * 1_000,
      );
    };

    arm();

    /*
     * CAPTURE, AND PASSIVE. Capture so a control that stops propagation — the
     * signature pad swallows pointer events while somebody is drawing — cannot
     * hide a patient's hand from the clock. Passive because none of this ever
     * calls `preventDefault`, and a non-passive listener on `touchstart` and
     * `wheel` costs scrolling smoothness on the one device where it shows.
     */
    const onActivity = (): void => arm();
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { capture: true, passive: true });
    }
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
      clearTimers();
    };
  }, [enabled, total, warnFor, clearTimers]);

  return { warningSecondsLeft };
}
