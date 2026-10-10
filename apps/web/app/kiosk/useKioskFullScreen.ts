'use client';

/**
 * FULL SCREEN ON THE FIRST TAP (Carl, 10 Oct 2026).
 *
 * > "write code to make the app full screen. We cannot have dependency on the
 * > tablet"
 *
 * WHAT IT IS FOR. The kiosk should look like an app on the practice's tablet —
 * no address bar, no tabs, no Android status and navigation bars — without
 * anybody installing, pinning or configuring anything on the device. The
 * Fullscreen API does that from the page itself, in Chrome and Edge on Android.
 *
 * ONE TAP TO START, BECAUSE BROWSERS INSIST. `requestFullscreen` is refused
 * without a user gesture, so it cannot happen on load. The first tap anywhere
 * — pairing, Begin, anything — asks for it, on `pointerup` rather than
 * `pointerdown` so the tap still lands on whatever it was meant for.
 *
 * THE PATIENT CAN ALWAYS LEAVE, AND THE NEXT TAP COMES BACK. A system swipe or
 * the back gesture exits full screen and no web page can prevent that. On
 * `fullscreenchange` back to windowed, the hook re-arms and asks again on the
 * NEXT tap — once per tap, never on a timer, never with a prompt or an
 * overlay. It is invisible to the patient: a refusal is swallowed, and an
 * unsupported browser (iPhone Safari has no element full screen) does nothing
 * at all, so the kiosk works exactly as it did before.
 *
 * NEVER WHILE SOMEBODY IS SIGNING. Entering full screen resizes the viewport,
 * and the signature pad is a canvas whose points are measured against its own
 * size: a resize mid-stroke moves the pad under the finger, and a resize after
 * ink reports a pad size the strokes were not drawn on. So the caller passes
 * `enabled: false` on the signature step, and a gesture that lands on a canvas
 * is ignored whatever the step. A patient who left full screen on K-4 gets it
 * back on the first tap after K-4.
 *
 * IT WRITES NOTHING (CLAUDE.md §7, zero footprint). No storage, no cookie, no
 * manifest, no service worker: the "armed" flag is a ref and dies with the
 * tab. The in-app reset (`useInactivityReset`) is a state change and keeps full
 * screen; a hard reload (the build floor, `useDevBuildWatch`) drops it, and the
 * next tap re-enters.
 *
 * FEATURE-FLAGGED (CLAUDE.md §6). `NEXT_PUBLIC_KIOSK_FULL_SCREEN=false` turns it
 * off; anything else, including unset, leaves it on.
 */

import { useEffect, useRef } from 'react';

/**
 * THE FLAG, read at call time and statically — Next substitutes the member
 * expression at build time (see `session.ts`'s `orElse`), and a test can stub it.
 */
function kioskFullScreenEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_KIOSK_FULL_SCREEN ?? 'true') !== 'false';
}

/** The prefixed forms older WebKit/Blink builds still expose. */
interface PrefixedElement {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
}
interface PrefixedDocument {
  webkitFullscreenElement?: Element | null;
}

function isFullScreen(): boolean {
  return Boolean(document.fullscreenElement ?? (document as PrefixedDocument).webkitFullscreenElement);
}

/**
 * ASKS ONCE, AND SWALLOWS EVERY REFUSAL. A rejected promise and a synchronous
 * throw are both a browser saying no — no gesture it recognises, a permissions
 * policy, an embedded frame — and none of them is the patient's problem.
 */
function requestFullScreen(onRefused: () => void): void {
  const root = document.documentElement as HTMLElement & PrefixedElement;
  const options: FullscreenOptions = { navigationUI: 'hide' };
  try {
    const result: unknown =
      typeof root.requestFullscreen === 'function'
        ? root.requestFullscreen(options)
        : typeof root.webkitRequestFullscreen === 'function'
          ? root.webkitRequestFullscreen(options)
          : undefined;
    // The prefixed form may return nothing at all rather than a promise.
    if (result instanceof Promise) result.catch(onRefused);
  } catch {
    // Refused synchronously. Nothing to show, nothing to log.
    onRefused();
  }
}

function fullScreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.fullscreenEnabled === false) return false;
  const root = document.documentElement as HTMLElement & PrefixedElement;
  return typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function';
}

export function useKioskFullScreen(enabled: boolean): void {
  /*
   * IN A REF so the listener below is attached once, and the signature step
   * flipping it does not detach and re-attach a window listener mid-ceremony.
   */
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (!kioskFullScreenEnabled() || !fullScreenSupported()) return;

    /*
     * ARMED means "the next tap may ask". Disarmed by asking, re-armed by
     * leaving full screen — so a run of taps while a request is in flight asks
     * once, and nothing ever asks without a fresh tap behind it.
     */
    let armed = true;

    // A refusal re-arms too: the next tap tries again, and only a tap does.
    const rearm = (): void => {
      armed = true;
    };
    const onGesture = (event: Event): void => {
      if (!armed || !enabledRef.current || isFullScreen()) return;
      const target = event.target;
      if (target instanceof Element && target.closest('canvas')) return;
      armed = false;
      requestFullScreen(rearm);
    };
    const onChange = (): void => {
      // Whatever ended it — a swipe, back, the system — the next tap may ask again.
      if (!isFullScreen()) armed = true;
    };

    // Capture, so a control that stops propagation cannot hide the tap;
    // passive, because nothing here calls `preventDefault`.
    window.addEventListener('pointerup', onGesture, { capture: true, passive: true });
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    document.addEventListener('fullscreenerror', rearm);
    document.addEventListener('webkitfullscreenerror', rearm);
    return () => {
      window.removeEventListener('pointerup', onGesture, { capture: true });
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      document.removeEventListener('fullscreenerror', rearm);
      document.removeEventListener('webkitfullscreenerror', rearm);
    };
  }, []);
}
