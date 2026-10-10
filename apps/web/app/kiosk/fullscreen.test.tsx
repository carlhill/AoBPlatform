/**
 * FULL SCREEN ON THE FIRST TAP (Carl, 10 Oct 2026: "write code to make the app
 * full screen. We cannot have dependency on the tablet").
 *
 * jsdom has no Fullscreen API, which is convenient: every test installs exactly
 * the API it is about — the standard one, the prefixed one, or none — and
 * drives `document.fullscreenElement` by hand.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKioskFullScreen } from './useKioskFullScreen';

let fullscreenElement: Element | null = null;

function installApi(impl: () => Promise<void> | void): ReturnType<typeof vi.fn> {
  const request = vi.fn(impl);
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
  return request;
}

function tap(target: Element = document.body): void {
  target.dispatchEvent(new Event('pointerup', { bubbles: true }));
}

/** What the browser does when full screen starts or ends. */
function fullScreenBecomes(element: Element | null): void {
  fullscreenElement = element;
  document.dispatchEvent(new Event('fullscreenchange'));
}

/** Lets a rejected request's `.catch` run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
});

afterEach(() => {
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
  delete (document.documentElement as unknown as Record<string, unknown>).webkitRequestFullscreen;
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('kiosk_enters_full_screen_on_the_first_tap', () => {
  it('asks for nothing on mount — browsers refuse without a gesture', () => {
    const request = installApi(() => Promise.resolve());
    renderHook(() => useKioskFullScreen(true));
    expect(request).not.toHaveBeenCalled();
  });

  it('asks on the first pointerup, hiding the navigation UI', () => {
    const request = installApi(() => Promise.resolve());
    renderHook(() => useKioskFullScreen(true));
    tap();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' });
  });

  it('does not ask again when already full screen', () => {
    const request = installApi(() => Promise.resolve());
    renderHook(() => useKioskFullScreen(true));
    tap();
    fullScreenBecomes(document.documentElement);
    tap();
    tap();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks once for a run of taps while a request is in flight', () => {
    const request = installApi(() => new Promise<void>(() => undefined));
    renderHook(() => useKioskFullScreen(true));
    tap();
    tap();
    tap();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('re-arms when the patient leaves full screen, and asks again on the NEXT tap only', () => {
    const request = installApi(() => Promise.resolve());
    renderHook(() => useKioskFullScreen(true));
    tap();
    fullScreenBecomes(document.documentElement);
    // A system swipe ends it. Leaving is never answered by itself — no loop.
    fullScreenBecomes(null);
    expect(request).toHaveBeenCalledTimes(1);
    tap();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('survives an in-app re-render: the listener is attached once', () => {
    const request = installApi(() => Promise.resolve());
    const { rerender } = renderHook(({ on }) => useKioskFullScreen(on), { initialProps: { on: true } });
    rerender({ on: true });
    rerender({ on: true });
    tap();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('full_screen_never_starts_from_the_signature_pad', () => {
  it('ignores a tap that lands on the pad canvas', () => {
    const request = installApi(() => Promise.resolve());
    const pad = document.createElement('canvas');
    pad.setAttribute('data-testid', 'signature-pad');
    document.body.appendChild(pad);
    renderHook(() => useKioskFullScreen(true));
    tap(pad);
    expect(request).not.toHaveBeenCalled();
  });

  it('ignores every tap while the caller has it off (the signature step), and asks on the first tap after', () => {
    const request = installApi(() => Promise.resolve());
    const { rerender } = renderHook(({ on }) => useKioskFullScreen(on), { initialProps: { on: false } });
    tap();
    tap();
    expect(request).not.toHaveBeenCalled();
    rerender({ on: true });
    tap();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('full_screen_is_invisible_when_it_cannot_happen', () => {
  it('swallows a rejected request and tries again on the next tap', async () => {
    const request = installApi(() => Promise.reject(new TypeError('Permissions check failed')));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderHook(() => useKioskFullScreen(true));
    tap();
    await settle();
    tap();
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('swallows a synchronous throw', () => {
    installApi(() => {
      throw new Error('refused');
    });
    renderHook(() => useKioskFullScreen(true));
    expect(() => tap()).not.toThrow();
  });

  it('does nothing at all on a browser with no element full screen', () => {
    renderHook(() => useKioskFullScreen(true));
    expect(() => tap()).not.toThrow();
  });

  it('falls back to the prefixed form, which may return nothing', () => {
    const prefixed = vi.fn(() => undefined);
    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', {
      configurable: true,
      value: prefixed,
    });
    renderHook(() => useKioskFullScreen(true));
    tap();
    expect(prefixed).toHaveBeenCalledWith({ navigationUI: 'hide' });
  });

  it('does nothing when NEXT_PUBLIC_KIOSK_FULL_SCREEN is false', () => {
    vi.stubEnv('NEXT_PUBLIC_KIOSK_FULL_SCREEN', 'false');
    const request = installApi(() => Promise.resolve());
    renderHook(() => useKioskFullScreen(true));
    tap();
    expect(request).not.toHaveBeenCalled();
  });

  it('writes nothing to the device (CLAUDE.md §7)', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem, getItem: () => null, removeItem: setItem, clear: setItem });
    vi.stubGlobal('sessionStorage', { setItem, getItem: () => null, removeItem: setItem, clear: setItem });
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    const cookie = vi.fn();
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: cookie });
    installApi(() => Promise.resolve());
    renderHook(() => useKioskFullScreen(true));
    tap();
    fullScreenBecomes(document.documentElement);
    fullScreenBecomes(null);
    tap();
    expect(setItem).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });
});
