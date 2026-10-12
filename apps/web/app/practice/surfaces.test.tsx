/**
 * THE CONSOLE'S HALF OF D-2026-09-14-04 — what a practice on the DB4 profile
 * is offered, and what it is told when it asks for something it has not got.
 *
 * WHY THE CONSOLE HALF IS ONLY HALF. Hiding a link is a courtesy; the control
 * is `SurfaceGuard` in core, which refuses the endpoint behind it
 * (`a_surface_that_is_off_is_refused_by_the_server_not_only_hidden`). What
 * these pin is the other failure — a practice offered a door that will not
 * open, which is a promise broken in front of somebody.
 *
 * THE PROFILE IS FETCHED, NOT MOCKED. `useSurfaceProfile` reads
 * `GET /practices/:id`, so these stub that response rather than the hook: a
 * test that mocked the hook would pass while the read that feeds it was
 * broken, and the read failing open is itself a rule worth proving.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TodayView } from './today/TodayView';
import { MainMenu } from '../MainMenu';
import { AccessGuard } from '../AccessGuard';
import { forgetSurfaceProfile } from '../surfaceProfile';
import { strings } from '../strings';

const PRACTICE = '821709fb-7f89-4fcf-95c0-27c5eb55cec8';

let pathname = '/practice/today';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('../auth', () => ({
  currentSession: () => ({ roles: ['front_desk'], practiceId: PRACTICE, consoleRole: 'admin' }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE }),
  attemptSilentLogin: vi.fn(),
  beginLogin: vi.fn(),
  hasSignedInBefore: () => null,
  restoreRefusalReason: () => null,
  sessionIdleMinutes: () => 0,
  silentRestoreInFlight: () => false,
}));

vi.mock('../effectivePractice', () => ({
  useEffectivePractice: () => ({ practiceId: PRACTICE, practiceName: 'Powell Street', settled: true }),
  forgetActingAs: vi.fn(),
}));

/** What `GET /practices/:id` says this practice has bought. */
function practiceOn(profile: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/practices/')) {
        return { ok: true, status: 200, json: async () => ({ id: PRACTICE, surfaceProfile: profile }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  pathname = '/practice/today';
  // The hook caches by practice for five minutes; without this the second test
  // would read the first one's answer.
  forgetSurfaceProfile();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('what a practice on the DB4 path is offered', () => {
  it('a_db4_practice_cannot_reach_the_queue_rails', async () => {
    practiceOn('db4');
    render(<TodayView practiceId={PRACTICE} />);

    // WAIT FOR THE ANSWER, NOT THE PAGE (wow.md §2.6). The cards render as soon
    // as the component mounts; the profile arrives on its own fetch, and a
    // synchronous read here would assert against whatever had landed by that
    // tick.
    await waitFor(() => expect(screen.queryByTestId('today-card-frontdesk')).toBeNull());
    expect(screen.queryByTestId('today-card-waiting')).toBeNull();
  });

  it('a_db4_practice_keeps_the_tablet_desk_and_the_day_register', async () => {
    practiceOn('db4');
    render(<TodayView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.queryByTestId('today-card-frontdesk')).toBeNull());
    // The half that is easy to break: switching surfaces off must not take away
    // the pages the first customer actually works from.
    expect(screen.getByTestId('today-card-tablet')).toBeTruthy();
    expect(screen.getByTestId('today-card-patients')).toBeTruthy();
    expect(screen.getByTestId('today-card-messages')).toBeTruthy();
  });

  it('an_existing_practice_sees_everything_by_default', async () => {
    /*
     * The release-safety claim, at the screen. Every practice that exists
     * carries `full`, so this build must change nothing for any of them — the
     * front desk card is still there, on the same page, in the same place.
     */
    practiceOn('full');
    render(<TodayView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('today-card-frontdesk')).toBeTruthy());
    expect(screen.getByTestId('today-card-waiting')).toBeTruthy();
    expect(screen.getByTestId('today-card-tablet')).toBeTruthy();
  });

  it('shows everything when the setting cannot be read at all', async () => {
    /*
     * IT FAILS OPEN, and that is the rule rather than an oversight (hard rule
     * 8). A practice whose console emptied out because one settings read
     * failed would be indistinguishable from an outage, and the endpoints
     * behind every one of these links refuse for themselves.
     */
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('the network is down'); }));
    render(<TodayView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('today-card-frontdesk')).toBeTruthy());
  });

  it('leaves the front desk out of the menu too, and keeps the tablet in it', async () => {
    // The menu is built from the access table; this is the second filter on it,
    // so that it cannot offer a door the practice has not bought.
    practiceOn('db4');
    render(<MainMenu />);
    // The panel is a Radix dialog: nothing of it is in the document until the
    // trigger is pressed.
    fireEvent.click(screen.getByTestId('main-menu'));

    await waitFor(() => expect(screen.queryByTestId('menu-/practice/patients')).toBeTruthy());
    expect(screen.queryByTestId('menu-/practice/frontdesk')).toBeNull();
  });
});

describe('what a practice is told when it opens one anyway', () => {
  it('says the practice does not use it, not that the account may not', async () => {
    /*
     * ITS OWN REFUSAL, and this is the point of it. "That page is not for this
     * account" would be a lie — the account is perfectly entitled to the page
     * — and somebody told it goes off to check their sign-in, which cannot
     * help them. This one names the part, says nothing has been deleted, and
     * links to where it is switched on (CLAUDE.md §7).
     */
    practiceOn('db4');
    pathname = '/practice/frontdesk';

    render(
      <AccessGuard>
        <p data-testid="page-content">the front desk</p>
      </AccessGuard>,
    );

    await waitFor(() => expect(screen.getByTestId('access-surface-off')).toBeTruthy());
    expect(screen.queryByTestId('page-content')).toBeNull();
    expect(screen.queryByText(strings.access.refusedTitle)).toBeNull();
    expect(screen.getByTestId('access-surface-name').textContent).toContain(
      strings.channels.surfaceNames.queue_rails,
    );
    expect(
      (screen.getByTestId('access-surface-off-channels') as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/practice/channels');
  });

  it('lets the same page through for a practice that uses it', async () => {
    practiceOn('full');
    pathname = '/practice/frontdesk';

    render(
      <AccessGuard>
        <p data-testid="page-content">the front desk</p>
      </AccessGuard>,
    );

    await waitFor(() => expect(screen.getByTestId('page-content')).toBeTruthy());
    expect(screen.queryByTestId('access-surface-off')).toBeNull();
  });
});
