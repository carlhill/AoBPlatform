/**
 * A PRACTITIONER WHO HAS JUST REGISTERED A PASSKEY IS NOT TOLD THEY ARE A
 * STRANGER (Carl, 12 Sep 2026).
 *
 * HIS SEQUENCE, three times over: open the "Set up your sign-in" email, press
 * Register, Keycloak says "your account has been updated", press Back to
 * Application — and the console answers "You are not signed in". The realm HAD
 * authenticated them; the app simply had no token, because an action-token flow
 * never goes through the app's own redirect.
 *
 * WHY NOTHING CAUGHT IT. `AccessGuard` attempts a silent restore only for a
 * browser carrying `hasSignedInBefore()`, which is right for a stranger and
 * wrong for exactly this person: their browser has never completed a sign-in
 * here, so no attempt was made and the first sentence the platform ever showed
 * them was that they were not signed in.
 *
 * REAL TIMERS AND THE REAL `auth.ts`, for the reasons `access-restore.test.tsx`
 * sets out: the PKCE challenge is a real digest and fake ticks do not move it,
 * so every assertion waits for the redirect rather than for a clock.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SILENT_RESTORE_PARAM } from '@aobplatform/contracts';
import { AccessGuard } from '../AccessGuard';
import { clearSession } from '../auth';

const GATED_PAGE = '/practice';

vi.mock('next/navigation', () => ({
  usePathname: () => GATED_PAGE,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/**
 * The address bar as it is the instant the invitation returns. `history` is
 * stubbed too, because the guard erases the marker and a test that let it reach
 * jsdom's real history would leak the change into the next one.
 */
function arrivingFromAnInvitation(value: string): {
  assign: ReturnType<typeof vi.fn>;
  replaceState: ReturnType<typeof vi.fn>;
} {
  const assign = vi.fn();
  const replaceState = vi.fn();
  const href = `http://localhost:3100${GATED_PAGE}?${SILENT_RESTORE_PARAM}=${value}`;
  vi.stubGlobal('location', {
    href,
    origin: 'http://localhost:3100',
    pathname: GATED_PAGE,
    search: `?${SILENT_RESTORE_PARAM}=${value}`,
    assign,
  });
  vi.stubGlobal('history', { replaceState });
  return { assign, replaceState };
}

function renderTheGatedPage(): void {
  render(
    <AccessGuard>
      <p data-testid="page-content">the practice console</p>
    </AccessGuard>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response),
  );
});

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  cleanup();
});

describe('a_passkey_setup_return_restores_without_the_signed_in_before_hint', () => {
  it('asks Keycloak even though this browser has never signed in here', async () => {
    // No `rememberSignedIn` anywhere: this is the state that used to mean
    // "stranger, do not ask".
    const { assign } = arrivingFromAnInvitation('web');

    renderTheGatedPage();

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = String(assign.mock.calls[0][0]);
    expect(url).toContain('prompt=none');
    expect(url).toContain('client_id=web');
  });

  /**
   * AGAINST THE CLIENT THE INVITATION NAMED. A reviewer invited to the platform
   * console must not be restored against the practice client — the two tokens
   * are deliberately not interchangeable.
   */
  it('restores against the client the invitation named', async () => {
    const { assign } = arrivingFromAnInvitation('console');

    renderTheGatedPage();

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(String(assign.mock.calls[0][0])).toContain('client_id=console');
  });

  /**
   * THE MARKER IS ERASED FROM THE ADDRESS BAR. Left there it would ride into a
   * bookmark, a shared link and the back button, asking Keycloak again on every
   * visit for no reason.
   */
  it('takes the marker out of the URL once it has been read', async () => {
    const { replaceState } = arrivingFromAnInvitation('web');

    renderTheGatedPage();

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    const rewritten = String(replaceState.mock.calls[0][2]);
    expect(rewritten).not.toContain(SILENT_RESTORE_PARAM);
    expect(rewritten).toContain(GATED_PAGE);
  });

  /**
   * A VALUE THAT NAMES NO REAL CLIENT IS IGNORED, not forwarded. The parameter
   * is permission to ask; it is not somewhere to type a client id and have it
   * handed to Keycloak.
   */
  it('ignores a marker naming a client that does not exist', async () => {
    const { assign } = arrivingFromAnInvitation('wordpress');

    renderTheGatedPage();

    await waitFor(() => expect(screen.getByTestId('access-signed-out')).toBeTruthy());
    expect(assign).not.toHaveBeenCalled();
  });

  /** And an ordinary visit with no marker behaves exactly as it always did. */
  it('still says nothing to a stranger arriving without a marker', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', {
      href: `http://localhost:3100${GATED_PAGE}`,
      origin: 'http://localhost:3100',
      pathname: GATED_PAGE,
      search: '',
      assign,
    });
    vi.stubGlobal('history', { replaceState: vi.fn() });

    renderTheGatedPage();

    await waitFor(() => expect(screen.getByTestId('access-signed-out')).toBeTruthy());
    expect(assign).not.toHaveBeenCalled();
  });
});
