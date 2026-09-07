/**
 * A TAB LEFT OPEN PAST EXPIRY (Carl, 7 Sep 2026 — "a console tab left open
 * shows 'signed in' after the session has expired; actions then fail with a
 * bare 400").
 *
 * Drives the REAL `auth.ts` — not a mock of it — through a real sign-in
 * (`completeLogin`) and a real scheduled refresh (`performRefresh`), because
 * the bug was in the wiring between them and `SessionControl`/`AuthGate`, not
 * in any one function read in isolation.
 *
 * THE CLOCK IS FAKE FROM BEFORE THE FIRST RENDER, and `waitFor`/`findBy*` are
 * not used anywhere below — RTL's polling itself runs on `setTimeout`, which
 * this file has faked, so a real-time `waitFor` would sit forever waiting for
 * a tick nothing will ever fire. Everything is settled explicitly with
 * `settle()` / `advanceMs()`, matching `app/kiosk/heartbeat.test.tsx`.
 *
 * Lives under `app/practice` for the same reason `apiError.test.ts` does:
 * `vitest.config.ts` does not run bare `app/*.test.tsx`, and this borrows a
 * covered directory rather than widening that scope.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import { SessionControl } from '../SessionControl';
import { AuthGate } from '../AuthGate';
import {
  attemptSilentLogin,
  completeLogin,
  clearSession,
  rememberSignedIn,
  silentLoginFailed,
} from '../auth';
import { strings } from '../strings';

const VERIFIER_KEY = 'aob.pkce.verifier';
const STATE_KEY = 'aob.pkce.state';
const CLIENT_KEY = 'aob.pkce.client';

function fakeAccessToken(claims: Record<string, unknown>): string {
  return `h.${btoa(JSON.stringify(claims))}.s`;
}

/** Whether the fetch mock answers the next refresh-grant call with a failure. */
let refreshOutcome: 'ok' | 'invalid_grant' = 'ok';
/** Whether the initial sign-in issues a refresh token at all. */
let issueRefreshToken = true;

function stubKeycloak(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const bodyStr = init?.body ? String(init.body) : '';
      const isRefresh = bodyStr.includes('grant_type=refresh_token');
      if (isRefresh && refreshOutcome === 'invalid_grant') {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'invalid_grant', error_description: 'Session not active' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({
          access_token: fakeAccessToken({ preferred_username: 'robin', realm_access: { roles: ['practice_user'] } }),
          expires_in: 300,
          ...(issueRefreshToken ? { refresh_token: 'rt-' + Math.random().toString(36).slice(2) } : {}),
        }),
      } as unknown as Response;
    }),
  );
}

/** Flushes pending promises under a faked clock without letting real wall-clock
 *  time (or RTL's own timer-based polling) pass at all. */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

async function advanceMs(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/*
 * A FRESH CODE EVERY TIME, DELIBERATELY. `completeLogin` remembers a
 * SUCCESSFUL exchange by its code for the life of the module (auth.ts:
 * "a code already spent returns the session it produced") — reusing one
 * across tests silently returns test 1's cached session object instead of
 * running `exchangeCode` again, which does not touch the module-level
 * `session` variable a second time. `afterEach`'s `clearSession()` had
 * already nulled it, so every test after the first one that reused a code
 * saw nobody signed in.
 */
let signInCount = 0;

/** Seeds the PKCE fields `completeLogin` reads, so it is not exercising
 *  `beginLogin`'s own redirect (which jsdom does not implement). */
async function signIn(): Promise<void> {
  signInCount += 1;
  const code = `code-${signInCount}`;
  const state = `state-${signInCount}`;
  sessionStorage.setItem(VERIFIER_KEY, 'verifier');
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(CLIENT_KEY, 'web');
  await act(async () => {
    await completeLogin(code, state);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  refreshOutcome = 'ok';
  issueRefreshToken = true;
  stubKeycloak();
});

afterEach(() => {
  clearSession();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  /*
   * AND THE "THIS BROWSER HAS SIGNED IN BEFORE" HINT, which a real sign-in
   * writes to localStorage (`rememberSignedIn`). Leaving it behind would make
   * every test after the first one look like a reload of a browser with a live
   * SSO session, which is a different starting state from the one most of these
   * tests mean to set up.
   */
  localStorage.clear();
  cleanup();
});

describe('session_bar_reflects_expiry_without_a_reload', () => {
  it('shows signed-in, then signed-out with the expired note, with no remount', async () => {
    // No refresh token issued this time — the ONLY way the bar can learn the
    // session is gone is the interval re-check calling `currentSession()`,
    // which is exactly the path this test pins.
    issueRefreshToken = false;
    await signIn();

    render(<SessionControl audience="Practice admin" />);
    await settle();
    expect(screen.getByTestId('session-sign-out')).toBeTruthy();
    expect(screen.queryByTestId('session-sign-in')).toBeNull();

    // Past `expiresAt` (300s) and past at least one 30s poll tick.
    await advanceMs(310_000);
    await settle();

    expect(screen.getByTestId('session-sign-in')).toBeTruthy();
    expect(screen.queryByTestId('session-sign-out')).toBeNull();
    const note = screen.getByTestId('session-expired-note');
    expect(note.textContent).toContain(strings.auth.sessionExpiredNote);
  });

  it('a page never signed in shows no expired note at all', async () => {
    render(<SessionControl audience="Practice admin" />);
    await settle();
    expect(screen.getByTestId('session-sign-in')).toBeTruthy();
    expect(screen.queryByTestId('session-expired-note')).toBeNull();
  });

  it('AuthGate keeps the page content mounted and offers "sign in again" instead of blanking it', async () => {
    issueRefreshToken = false;
    await signIn();

    render(
      <AuthGate>
        <p data-testid="page-content">Whatever the person was doing</p>
      </AuthGate>,
    );
    await settle();
    expect(screen.getByTestId('page-content')).toBeTruthy();

    await advanceMs(310_000);
    await settle();

    // The content is STILL there — this is the whole point: nothing typed or
    // in progress is thrown away just because the session ended.
    expect(screen.getByTestId('page-content')).toBeTruthy();
    expect(screen.getByTestId('auth-gate-expired')).toBeTruthy();
    expect(screen.queryByTestId('auth-gate')).toBeNull();
    expect(screen.getByText(strings.auth.expiredHeading)).toBeTruthy();
  });

  it('a page that never had a session gets the full blocking gate, not the expired card', () => {
    render(
      <AuthGate>
        <p data-testid="page-content">Should not be reachable yet</p>
      </AuthGate>,
    );
    expect(screen.getByTestId('auth-gate')).toBeTruthy();
    expect(screen.queryByTestId('auth-gate-expired')).toBeNull();
    expect(screen.queryByTestId('page-content')).toBeNull();
  });

  it('a deliberate sign-out hides the page again — never the "sign in again" card', async () => {
    /*
     * THE CASE THE NON-BLOCKING CARD MUST NOT COVER. Leaving the amber card up
     * with the page's content still showing is right for a session that died
     * on its own; it is exactly wrong for somebody who pressed Sign Out
     * believing they had left a shared machine. `clearSession()` with no
     * argument defaults to the `'signed-out'` reason `signOut()` (auth.ts)
     * uses — this calls it directly rather than `signOut()` itself, which
     * also navigates the browser away (`window.location.assign`), something
     * jsdom does not implement.
     */
    await signIn();
    render(
      <AuthGate>
        <p data-testid="page-content">Practice data on screen</p>
      </AuthGate>,
    );
    await settle();
    expect(screen.getByTestId('page-content')).toBeTruthy();

    act(() => {
      clearSession();
    });
    await settle();

    expect(screen.getByTestId('auth-gate')).toBeTruthy();
    expect(screen.queryByTestId('auth-gate-expired')).toBeNull();
    expect(screen.queryByTestId('page-content')).toBeNull();
  });

  it('the bar never calls a deliberate sign-out an expiry', async () => {
    await signIn();
    render(<SessionControl audience="Practice admin" />);
    await settle();
    expect(screen.getByTestId('session-sign-out')).toBeTruthy();

    act(() => {
      clearSession();
    });
    await settle();

    expect(screen.getByTestId('session-sign-in')).toBeTruthy();
    expect(screen.queryByTestId('session-expired-note')).toBeNull();
  });
});

describe('expired_note_names_the_refresh_failure_reason_when_known', () => {
  it('a refresh that fails with a Keycloak error code shows it beside the expired note', async () => {
    await signIn(); // issues a refresh token this time
    render(<SessionControl audience="Practice admin" />);
    await settle();
    expect(screen.getByTestId('session-sign-out')).toBeTruthy();

    // The scheduled refresh fires at expiresAt − 60s = 240s from now.
    refreshOutcome = 'invalid_grant';
    await advanceMs(241_000);
    await settle();

    const note = screen.getByTestId('session-expired-note');
    expect(note.textContent).toContain('invalid_grant');
    expect(note.textContent).toBe(strings.auth.sessionExpiredNoteWithReason('invalid_grant'));
  });
});

/**
 * A RELOAD IS NOT A SIGN-OUT (Carl, 7 Sep 2026, pressing the browser's reload
 * on `/practice/setup`).
 *
 * The access token is memory-only by design, so a reload starts the tab with no
 * session and a `prompt=none` redirect then restores it from Keycloak's SSO
 * session without asking for anything. For that second the bar said "Sign in"
 * and the gate said "sign in again" — not early, WRONG: nobody had been signed
 * out, and there was no amber note either, because this tab had never held a
 * session to lose.
 */
describe('reload_shows_signing_back_in_not_sign_in', () => {
  /** What a reload of a browser that HAS signed in here looks like from cold. */
  function asReloadedTab(): void {
    /*
     * THROUGH THE REAL FUNCTION, not by writing the key. `rememberSignedIn` is
     * what a successful sign-in calls, and it does more than store a hint — it
     * reopens the restore question that an earlier sign-out settled. A test
     * that poked localStorage would be simulating half of a sign-in and would
     * pass or fail on what the test before it happened to do.
     */
    rememberSignedIn('web');
  }

  it('says it is signing you back in, and offers nothing while it does', async () => {
    asReloadedTab();
    render(<SessionControl audience="Practice admin" />);
    await settle();

    const restoring = screen.getByTestId('session-restoring');
    expect(restoring.textContent).toContain(strings.auth.signingBackIn);
    /*
     * NO SIGN-IN BUTTON. Pressing it would start a second, INTERACTIVE login
     * on top of the silent one about to land, and ask for a passkey nobody
     * needed to give.
     */
    expect(screen.queryByTestId('session-sign-in')).toBeNull();
    // AND NO AMBER NOTE. That note is for a session that lived in this tab and
    // died; this tab has not had one.
    expect(screen.queryByTestId('session-expired-note')).toBeNull();
  });

  it('the gate shows no card at all during that window', async () => {
    asReloadedTab();
    render(
      <AuthGate>
        <p data-testid="gated-content">the console</p>
      </AuthGate>,
    );
    await settle();

    expect(screen.queryByTestId('auth-gate')).toBeNull();
    expect(screen.queryByTestId('auth-gate-expired')).toBeNull();
    expect(screen.queryByTestId('gate-sign-in')).toBeNull();
  });

  it('falls through to the ordinary signed-out state when the restore does not land', async () => {
    asReloadedTab();
    render(<SessionControl audience="Practice admin" />);
    await settle();
    expect(screen.getByTestId('session-restoring')).toBeTruthy();

    /*
     * PAST THE GRACE PERIOD `attemptSilentLogin` ALREADY TRUSTS. A redirect
     * that has not landed by now is not coming — the reachable cause is an
     * origin Keycloak does not know — and a hopeful message that never resolves
     * is a worse lie than the one it replaced.
     */
    await advanceMs(6_000);
    await settle();

    expect(screen.queryByTestId('session-restoring')).toBeNull();
    expect(screen.getByTestId('session-sign-in')).toBeTruthy();
    // Still no amber note: nothing expired here, this browser simply has no
    // live SSO session any more.
    expect(screen.queryByTestId('session-expired-note')).toBeNull();
  });

  it('a tab whose own session expired keeps the amber note, not the promise', async () => {
    /*
     * THE DISTINCTION THIS MUST NOT BLUR. Both states have no session and both
     * happen in a browser that has signed in before; what separates them is
     * whether THIS page ever held one. It did, so it is told what happened
     * rather than promised something that is not coming.
     */
    issueRefreshToken = false;
    await signIn();

    render(<SessionControl audience="Practice admin" />);
    await settle();
    expect(screen.getByTestId('session-sign-out')).toBeTruthy();

    await advanceMs(310_000);
    await settle();

    expect(screen.queryByTestId('session-restoring')).toBeNull();
    expect(screen.getByTestId('session-sign-in')).toBeTruthy();
    expect(screen.getByTestId('session-expired-note').textContent).toContain(
      strings.auth.sessionExpiredNote,
    );
  });
});

/**
 * THE MARKER THAT OUTLIVED THE SIGN-IN IT WAS ABOUT (Carl, 7 Sep 2026).
 *
 * HIS SEQUENCE, EXACTLY: reload, the silent restore is refused because
 * Keycloak's SSO session had idled out, `aob.silentTried` stays set — it is
 * sessionStorage, which survives reloads — and he then signs in with his
 * passkey. The next reload found the marker, settled the question without
 * asking anybody, and offered him a sign-in prompt with a live Keycloak session
 * sitting behind it. The marker was answering a question about a state that no
 * longer existed.
 */
describe('reload_after_interactive_sign_in_restores_silently', () => {
  const SILENT_TRIED_KEY = 'aob.silentTried';

  /**
   * A `location` jsdom will let us watch. Its members live on the prototype, so
   * spreading the real one copies nothing — the three `auth.ts` actually reads
   * are given explicitly: `origin` for the redirect uri, `pathname`/`search`
   * for the return path, and `assign` for the navigation itself.
   */
  function stubNavigation(): ReturnType<typeof vi.fn> {
    const assign = vi.fn();
    vi.stubGlobal('location', {
      origin: 'http://localhost:3100',
      pathname: '/practice/setup',
      search: '',
      assign,
    });
    return assign;
  }

  it('a successful exchange clears the marker, so the next load may try again', async () => {
    // A refused attempt earlier in this tab left the marker behind.
    sessionStorage.setItem(SILENT_TRIED_KEY, 'true');

    await signIn();
    expect(sessionStorage.getItem(SILENT_TRIED_KEY)).toBeNull();

    /*
     * AND THE NEXT COLD LOAD ACTUALLY ASKS. Asserted through the redirect
     * itself rather than through the marker alone: `attemptSilentLogin`
     * returning without navigating is precisely the bug, and only the
     * `prompt=none` URL proves it did not.
     */
    clearSession('expired');
    const assign = stubNavigation();

    /*
     * NOT AWAITED. The real call resolves only after its five-second grace (or
     * never, because the document is torn down by the navigation), so awaiting
     * it here would be waiting for the wrong thing. What is asserted is the
     * REDIRECT: an `attemptSilentLogin` that settles without navigating is
     * precisely the bug, and only the `prompt=none` URL proves it did not.
     */
    let resolved: boolean | 'pending' = 'pending';
    void attemptSilentLogin('web').then((value) => {
      resolved = value;
    });
    await settle();

    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0][0])).toContain('prompt=none');
    expect(resolved).toBe('pending');
    // The loop guard is untouched: the marker is set again before it redirects.
    expect(sessionStorage.getItem(SILENT_TRIED_KEY)).toBe('true');
  });

  it('a second attempt in the SAME load is still refused', async () => {
    // The guard this fix must not remove: one attempt per page LOAD.
    rememberSignedIn('web');
    sessionStorage.setItem(SILENT_TRIED_KEY, 'true');
    const assign = stubNavigation();

    expect(await attemptSilentLogin('web')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});

/**
 * A REFUSED RESTORE SAYS WHY (Carl, 7 Sep 2026).
 *
 * "You are not signed in. This page shows real records…" is written for
 * somebody who has never been here. Carl HAD been, minutes earlier; the SSO
 * session had idled out. The generic gate described the state and hid the
 * cause, so the same thing kept happening with no explanation.
 */
describe('refused_restore_says_the_sign_in_ended_not_that_you_never_signed_in', () => {
  it('the gate names the rule and the way back, and the bar carries the heading', async () => {
    // A browser that HAS signed in here, whose silent restore Keycloak then
    // refused. `silentLoginFailed` is what the callback calls on
    // `error=login_required`.
    rememberSignedIn('web');
    silentLoginFailed('login_required');

    render(
      <AuthGate>
        <p data-testid="gated-content">the console</p>
      </AuthGate>,
    );
    render(<SessionControl audience="Practice admin" />);
    await settle();

    const card = screen.getByTestId('auth-gate-restore-refused');
    expect(card.textContent).toContain(strings.auth.restoreRefusedHeading);
    // The MINUTES come from the realm's own setting, never a number typed into
    // the sentence — `sessionIdleMinutes()` defaults to 30 with no env set.
    expect(card.textContent).toContain(strings.auth.restoreRefusedBody(30));
    expect(screen.getByTestId('gate-sign-in-after-idle')).toBeTruthy();

    // STILL BLOCKING: this page has never rendered its content, and a practice
    // screen with nobody signed in is a disclosure risk (auth.ts).
    expect(screen.queryByTestId('gated-content')).toBeNull();
    // And it is not the generic gate.
    expect(screen.queryByTestId('auth-gate')).toBeNull();

    expect(screen.getByTestId('session-restore-refused-note').textContent).toContain(
      strings.auth.restoreRefusedHeading,
    );
  });

  it('a browser that has never signed in here keeps the generic copy', async () => {
    /*
     * THE SAME CALL, WITHOUT THE HINT. `attemptSilentLogin` is not gated on the
     * hint, so a first-time browser also gets one `login_required` — and it
     * must not be told its sign-in "ended", because it never had one.
     */
    silentLoginFailed('login_required');

    render(
      <AuthGate>
        <p data-testid="gated-content">the console</p>
      </AuthGate>,
    );
    render(<SessionControl audience="Practice admin" />);
    await settle();

    expect(screen.getByTestId('auth-gate')).toBeTruthy();
    expect(screen.queryByTestId('auth-gate-restore-refused')).toBeNull();
    expect(screen.queryByTestId('session-restore-refused-note')).toBeNull();
    expect(screen.getByTestId('session-sign-in')).toBeTruthy();
  });

  it('a deliberate sign-out is not a refused restore', async () => {
    rememberSignedIn('web');
    silentLoginFailed('login_required');
    // Somebody pressing Sign out is told the ordinary thing: "your earlier
    // sign-in has ended" would be true and patronising.
    clearSession('signed-out');

    render(<SessionControl audience="Practice admin" />);
    await settle();

    expect(screen.queryByTestId('session-restore-refused-note')).toBeNull();
    expect(screen.getByTestId('session-sign-in')).toBeTruthy();
  });
});
