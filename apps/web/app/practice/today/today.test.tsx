/**
 * `/practice/today` — THE DAY'S WORK, RENDERED (PRACTICE-NAVIGATION.md §6).
 *
 * WHAT IT PINS, and each is a rule from the plan rather than a preference:
 *
 *  - EVERY DAILY DESTINATION IS ONE CLICK AWAY (§2, §6). Asserted as five
 *    real hrefs, because "the card is on the page" is not the claim — the
 *    claim is that pressing it lands on the page it names.
 *  - VIEW-ONLY AND ACTING-AS BOTH STILL WORK (§5 rule 4). The read-only
 *    operator's links are the `/platform/practices/<id>` twins; an operator
 *    acting as a practice gets the ordinary practice routes, because a claim
 *    is what acting-as grants.
 *  - THE PAGE IS FIVE THINGS AND NO MORE (§2). A sixth card is the way the
 *    setup hub reached twelve, so the count is a test rather than a comment.
 *  - IT NEVER OFFERS A DOOR THAT WOULD SHUT. `canOpen` is the same `mayReach`
 *    each destination applies.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { audiencesOf, mayReach } from '@aobplatform/domain';
import { TodayView } from './TodayView';
import { strings } from '../../strings';

const PRACTICE = '821709fb-7f89-4fcf-95c0-27c5eb55cec8';

/**
 * THE FIVE, AND WHERE EACH LANDS (§2). Written out here rather than imported
 * from the component: a test that reads the same list it is checking would
 * pass whatever that list said.
 */
const DAILY: ReadonlyArray<readonly [string, string]> = [
  ['frontdesk', '/practice/frontdesk'],
  ['waiting', '/practice/practitioner/waiting'],
  ['tablet', '/practice/tablet'],
  ['patients', '/practice/patients'],
  ['messages', '/practice/correspondence'],
];

let session: {
  roles: string[];
  practiceId: string | null;
  practitionerId?: string;
  consoleRole?: string;
} | null = null;

vi.mock('next/navigation', () => ({
  usePathname: () => '/practice/today',
}));

vi.mock('../../auth', () => ({
  currentSession: () => session,
  apiHeaders: () => ({ 'x-practice-id': PRACTICE }),
}));

afterEach(() => {
  cleanup();
});

function hrefOf(key: string): string | null {
  return (screen.getByTestId(`today-to-${key}`) as HTMLAnchorElement).getAttribute('href');
}

describe('the day’s work', () => {
  it('every_daily_destination_is_reachable_from_today_in_one_click', () => {
    /*
     * RECEPTION, WHICH IS THE HARDEST CASE: not an administrator, so anything
     * gated to `practice_admin` would be missing. All five are reception's own
     * work and all five must be here.
     */
    session = { roles: ['front_desk'], practiceId: PRACTICE, consoleRole: 'other' };
    render(<TodayView practiceId={PRACTICE} />);

    for (const [key, path] of DAILY) {
      expect(hrefOf(key)).toBe(path);
    }
  });

  it('is five things and no more', () => {
    /*
     * THE COUNT IS THE RULE (§2, §5 rule 1). The setup hub reached twelve
     * destinations one reasonable card at a time; this fails the moment a
     * sixth is added without the plan being changed first.
     */
    session = { roles: [], practiceId: PRACTICE, consoleRole: 'admin' };
    const { container } = render(<TodayView practiceId={PRACTICE} />);

    expect(container.querySelectorAll('[data-testid^="today-card-"]')).toHaveLength(DAILY.length);
    // And nothing configuration-shaped has crept back on.
    for (const stray of ['/practice/setup', '/practice/users', '/practice/devices', '/practice/templates']) {
      expect(container.querySelector(`a[href="${stray}"]`)).toBeNull();
    }
  });

  it('says which desk is which, because there are two of them', () => {
    // §7: two desks side by side needs one sentence saying which is which.
    session = { roles: [], practiceId: PRACTICE, consoleRole: 'admin' };
    render(<TodayView practiceId={PRACTICE} />);

    expect(screen.getByTestId('today-two-desks').textContent).toBe(strings.today.twoDesks);
  });

  it('never says a form is certified, approved or accredited', () => {
    // Hard rule 12, on a page whose whole content is copy about our own pages.
    session = { roles: [], practiceId: PRACTICE, consoleRole: 'admin' };
    const { container } = render(<TodayView practiceId={PRACTICE} />);

    const text = (container.textContent ?? '').toLowerCase();
    for (const banned of ['certified', 'accredited', 'government-approved']) {
      expect(text).not.toContain(banned);
    }
    // And the domain's own words stay off the first screen of a shift
    // (FRONT-DESK-PAGE.md §5).
    for (const jargon of ['assignor', 'particulars', 'episodic', 'artefact']) {
      expect(text).not.toContain(jargon);
    }
  });

  it('an_operator_acting_as_a_practice_lands_where_practice_staff_land', () => {
    /*
     * THE PAGE HALF OF THE RULE; the landing half is `landingPath`'s own test.
     * Acting as a practice grants a practice CLAIM, so an operator holding one
     * is a practice user here: the same five cards, and the ORDINARY practice
     * routes rather than the read-only twins, because they are working rather
     * than looking (§5 rule 4).
     */
    session = { roles: ['platform_admin'], practiceId: PRACTICE, consoleRole: 'other' };
    render(<TodayView practiceId={PRACTICE} />);

    for (const [key, path] of DAILY) {
      expect(hrefOf(key)).toBe(path);
    }
  });

  it('a read-only operator gets the twins, never a route that would refuse them', () => {
    /*
     * The other half of §5 rule 4. An operator with no practice claim is
     * refused by every `/practice/...` route, so the links must be rewritten —
     * and a destination with no twin yet goes to that practice's hub, which is
     * the truthful answer until one exists rather than a dead link.
     */
    session = { roles: ['platform_admin'], practiceId: null };
    render(<TodayView practiceId={PRACTICE} viewOnly />);

    expect(hrefOf('tablet')).toBe(`/platform/practices/${PRACTICE}/tablet`);
    expect(hrefOf('patients')).toBe(`/platform/practices/${PRACTICE}/patients`);
    expect(hrefOf('messages')).toBe(`/platform/practices/${PRACTICE}/correspondence`);
    // No twin yet for either desk, so both land on the practice's own hub.
    expect(hrefOf('frontdesk')).toBe(`/platform/practices/${PRACTICE}`);
    expect(hrefOf('waiting')).toBe(`/platform/practices/${PRACTICE}`);

    for (const [, path] of DAILY) {
      expect(screen.queryByRole('link', { name: new RegExp(path) })).toBeNull();
    }
  });

  it('offers no door that would shut in the reader’s face', () => {
    /*
     * `canOpen` IS `mayReach`, ASKED OF THE DOMAIN, not a second judgement
     * written here — the drift between a card and the page it opens is a
     * failure the setup hub has already had twice.
     *
     * Asserted by putting every rendered link back through `mayReach` with the
     * reader's own audiences, rather than by rendering an account that can
     * open nothing: on this page there is no such account, because every
     * destination is `practice` and the practice claim is what the gate above
     * has already resolved. The empty state in the component is the guard for
     * a destination gated more narrowly LATER, not a state reachable today.
     */
    session = { roles: ['front_desk'], practiceId: PRACTICE, consoleRole: 'other' };
    const audiences = audiencesOf({ roles: ['front_desk'], practiceId: PRACTICE, consoleRole: 'other' });
    const { container } = render(<TodayView practiceId={PRACTICE} />);

    const hrefs = [...container.querySelectorAll('main a[href^="/practice"]')].map((a) => a.getAttribute('href')!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(mayReach(href, audiences)).toBe(true);
    }
  });
});
