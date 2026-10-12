/**
 * A DEV TAB RELOADS ITSELF WHEN THE SERVER RESTARTS — AND NEVER MID-CEREMONY
 * (Carl, 12 Sep 2026: "fix the dev kiosk build id so it reloads").
 *
 * WHAT WENT WRONG WITHOUT IT. `kioskBuildId()` is the constant `'dev'` outside
 * CI, so `kioskBuildIsStale` is false forever, the server's `reload: true`
 * never fires, and a kiosk tab runs the bundle it loaded until a person presses
 * refresh. W6 landed, Carl signed, and none of it was on his screen.
 *
 * THE RISK THIS GUARDS. A reload is the most destructive thing this tab can do
 * to somebody standing at it. The dev signal therefore goes through the SAME
 * gate as the production build floor: idle only, once per tab.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDevBuildWatch } from './useDevBuildWatch';

function serverSaying(...builds: string[]) {
  let call = 0;
  return vi.fn(async () => {
    const build = builds[Math.min(call, builds.length - 1)];
    call += 1;
    return {
      ok: true,
      json: async () => ({ build, dev: true }),
    } as unknown as Response;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dev_kiosk_tab_notices_a_restarted_server', () => {
  it('says nothing while the build is the one it first saw', async () => {
    vi.stubGlobal('fetch', serverSaying('dev-1000', 'dev-1000'));
    const { result } = renderHook(() => useDevBuildWatch(true));

    await vi.advanceTimersByTimeAsync(12_000);
    expect(result.current).toBe(false);
  });

  it('reports a change once the server answers a different build', async () => {
    vi.stubGlobal('fetch', serverSaying('dev-1000', 'dev-2000'));
    const { result } = renderHook(() => useDevBuildWatch(true));

    await vi.advanceTimersByTimeAsync(12_000);
    await waitFor(() => expect(result.current).toBe(true));
  });

  /**
   * THE ONE THAT MATTERS. `enabled` is false whenever the tablet is not between
   * patients, so a ceremony cannot be interrupted — the caller passes
   * `step === 'idle' || step === 'list'`, and this is that contract.
   */
  it('asks nothing at all while a patient is mid-ceremony', async () => {
    const fetchMock = serverSaying('dev-1000', 'dev-2000');
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useDevBuildWatch(false));

    await vi.advanceTimersByTimeAsync(12_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  /**
   * A DEPLOYED ENVIRONMENT ANSWERS `dev: false`, and acting on it there would
   * be a second reload path outside the staged, per-practice rollout that
   * CLAUDE.md §7 requires. So it is ignored even if the build string moves.
   */
  it('never acts on a deployed server, even when its build changes', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return {
          ok: true,
          json: async () => ({ build: `release-${call}`, dev: false }),
        } as unknown as Response;
      }),
    );
    const { result } = renderHook(() => useDevBuildWatch(true));

    await vi.advanceTimersByTimeAsync(12_000);
    expect(result.current).toBe(false);
  });

  /**
   * A SERVER THAT IS DOWN IS NOT A NEW BUILD. Mid-restart the fetch throws;
   * reporting a change then would reload the tab into a server that is not
   * listening yet, and the tab would come back blank.
   */
  it('treats an unreachable server as no news, not as a new build', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('connection refused');
      }),
    );
    const { result } = renderHook(() => useDevBuildWatch(true));

    await vi.advanceTimersByTimeAsync(12_000);
    expect(result.current).toBe(false);
  });

  /** Nothing is written anywhere — the stamp lives in a ref for the tab's life. */
  it('kiosk_persists_nothing_but_pairing_when_watching_the_build', async () => {
    vi.stubGlobal('fetch', serverSaying('dev-1000', 'dev-2000'));
    renderHook(() => useDevBuildWatch(true));

    await vi.advanceTimersByTimeAsync(12_000);
    const keys = [
      ...Object.keys(window.localStorage),
      ...Object.keys(window.sessionStorage),
    ].filter((k) => !k.startsWith('aob.pairing'));
    expect(keys).toEqual([]);
  });
});
