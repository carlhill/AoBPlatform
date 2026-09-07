/**
 * THE SILENT RESTORE IS ASKED FOR IN ONE PLACE (Carl, 7 Sep 2026, second
 * round).
 *
 * HIS SEQUENCE: a NEW tab on `/practice/setup` with a live Keycloak session
 * (admin API session-count = 1) showed "You are not signed in", and no redirect
 * ever left the page.
 *
 * THE CAUSE was structural rather than a mistake in any one line.
 * `attemptSilentLogin` was called from exactly two components — `usePractice`
 * and `PracticeList` — so whether a page asked Keycloak anything depended on
 * which hook it happened to mount, and `/practice/setup` mounts neither. Worse,
 * `AccessGuard` REPLACES the children of every non-public page when there is no
 * session, so on those pages neither caller was rendered at all: no console
 * page reliably attempted a restore.
 *
 * SO THESE TESTS DRIVE THE REAL `AccessGuard` around a child that mounts
 * nothing of its own — the shape of `/practice/setup` — and assert on the
 * redirect itself. They use the REAL `auth.ts`, because the whole subject is
 * which module state a page load leaves behind.
 *
 * REAL TIMERS, DELIBERATELY. `attemptSilentLogin` awaits a real SHA-256 digest
 * for the PKCE challenge before it navigates, and fake ticks do not move it
 * (the lesson of `0cf1eb0`), so every assertion here waits for the REDIRECT
 * rather than for a clock. The cost is that the function's own five-second
 * grace timeout is still pending when a test ends; it resolves a promise
 * nobody holds, and `afterEach` clears every piece of module and storage state
 * it could otherwise carry into the next one.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AccessGuard } from '../AccessGuard';
import { clearSession, rememberSignedIn, silentLoginFailed } from '../auth';
import { strings } from '../strings';

/** A gated console page in the page map, and one that mounts no hook of its own. */
const GATED_PAGE = '/practice/setup';

vi.mock('next/navigation', () => ({
  usePathname: () => GATED_PAGE,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/** What `attemptSilentLogin` reaches for when it decides to redirect. */
function watchNavigation(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  vi.stubGlobal('location', {
    origin: 'http://localhost:3100',
    pathname: GATED_PAGE,
    search: '',
    assign,
  });
  return assign;
}

function renderTheGatedPage(): void {
  render(
    <AccessGuard>
      <p data-testid="page-content">the setup hub</p>
    </AccessGuard>,
  );
}

beforeEach(() => {
  // Nothing on this screen needs the network; a page that tried would otherwise
  // fail loudly and drown the assertion.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response),
  );
});

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  // The "this browser has signed in here" hint lives in localStorage
  // (`rememberSignedIn`) and would otherwise make the next test look like a
  // returning browser.
  localStorage.clear();
  cleanup();
});

describe('setup_page_attempts_the_silent_restore', () => {
  it('asks Keycloak from the guard, on a page that mounts no hook of its own', async () => {
    // A browser that has signed in here, with no session in this document —
    // exactly a new tab after the token was thrown away.
    rememberSignedIn('web');
    const assign = watchNavigation();

    renderTheGatedPage();

    /*
     * WAIT FOR THE REDIRECT, NOT FOR A TICK. `attemptSilentLogin` awaits a real
     * SHA-256 digest for the PKCE challenge before it navigates, which runs on
     * Node's threadpool — the same lesson as `0cf1eb0`.
     */
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = String(assign.mock.calls[0][0]);
    // `prompt=none` is the whole point: answer from the existing SSO session or
    // refuse, and never put a sign-in screen in front of anybody.
    expect(url).toContain('prompt=none');
    expect(url).toContain('response_type=code');

    // AGAINST THE CLIENT THIS BROWSER SIGNED IN WITH.
    expect(url).toContain('client_id=web');

    // The page's own content stays hidden while there is no session — this
    // guard's existing rule, unchanged.
    expect(screen.queryByTestId('page-content')).toBeNull();
  });

  it('restores against the client the browser signed in with, not the default', async () => {
    /*
     * THE CONSOLE AND THE REVIEWER CONSOLE ARE SEPARATE KEYCLOAK CLIENTS on
     * purpose — a practice token and a platform token must never be
     * interchangeable (auth.ts). Restoring a reviewer's session against the
     * default `web` client would ask the wrong question of Keycloak. The hint
     * stores which one, and this is what reads it.
     */
    rememberSignedIn('console');
    const assign = watchNavigation();

    renderTheGatedPage();

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(String(assign.mock.calls[0][0])).toContain('client_id=console');
  });

  it('makes no attempt from a browser that has never signed in here', async () => {
    /*
     * NOTHING TO RESTORE, so nothing is claimed and nobody is sent on a round
     * trip. `hasSignedInBefore()` is a hint, not a credential — it holds no
     * token and grants nothing.
     */
    const assign = watchNavigation();

    renderTheGatedPage();

    await waitFor(() => expect(screen.getByTestId('access-signed-out')).toBeTruthy());
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByTestId('access-restoring')).toBeNull();
  });
});

describe('signing_back_in_is_shown_only_while_an_attempt_is_in_flight', () => {
  it('says it while the redirect is outstanding', async () => {
    rememberSignedIn('web');
    watchNavigation();

    renderTheGatedPage();

    await waitFor(() => expect(screen.getByTestId('access-restoring')).toBeTruthy());
    expect(screen.getByTestId('access-restoring').textContent).toContain(strings.auth.signingBackIn);
    // No sign-in prompt underneath it: pressing one would start a second,
    // interactive login on top of the silent one about to land.
    expect(screen.queryByTestId('access-signed-out')).toBeNull();
    expect(screen.queryByTestId('access-restore-refused')).toBeNull();
  });

  it('never says it when no attempt is made', async () => {
    /*
     * THE FAULT THIS NAMES. The window used to open on the PRECONDITIONS — no
     * session, and this browser has signed in here — which are true whether or
     * not anybody asked Keycloak anything. A tab that had already used its one
     * attempt therefore sat on "Signing you back in…" for five seconds with no
     * redirect behind it, then fell to a sign-in prompt.
     */
    rememberSignedIn('web');
    sessionStorage.setItem('aob.silentTried', 'true');
    const assign = watchNavigation();

    renderTheGatedPage();

    await waitFor(() => expect(screen.getByTestId('access-signed-out')).toBeTruthy());
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByTestId('access-restoring')).toBeNull();
  });

  it('a refused restore says the sign-in ended, on the page somebody opened', async () => {
    /*
     * THE OTHER END OF THE SAME SCREEN. Keycloak has answered `login_required`
     * for a browser that HAD signed in here, so this is not "you are not signed
     * in" — it is a session that ended, with the realm's own idle rule and the
     * way back.
     */
    rememberSignedIn('web');
    silentLoginFailed('login_required');
    const assign = watchNavigation();

    renderTheGatedPage();

    await waitFor(() => expect(screen.getByTestId('access-restore-refused')).toBeTruthy());
    expect(document.body.textContent).toContain(strings.auth.restoreRefusedHeading);
    // The minutes come from the realm's own setting, never a number typed into
    // the sentence; with no env set that is 30.
    expect(document.body.textContent).toContain(strings.auth.restoreRefusedBody(30));
    // And it does not ask Keycloak again — it has just been told there is
    // nothing to restore.
    expect(assign).not.toHaveBeenCalled();
  });
});
