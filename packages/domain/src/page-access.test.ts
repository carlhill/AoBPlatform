import { PAGES, PageAccessError, assertMayReach, audiencesOf, mayReach, pagesFor, ruleFor } from './page-access';

describe('who somebody is', () => {
  it('makes a practice claim, not a realm role, what says "practice user"', () => {
    /*
     * Deliberate, and it is what lets acting-as work: an operator with an open
     * session carries the claim, so they reach practice pages as the practice
     * and with a record of on whose behalf.
     */
    expect(audiencesOf({ practiceId: 'p1' })).toContain('practice');
    expect(audiencesOf({ roles: ['front_desk'] })).not.toContain('practice');
  });

  it('reads administrator from the staff row, never from a realm role', () => {
    // A realm role is a copy that drifts the moment somebody is promoted in our
    // console without Keycloak being told — and the copy would be deciding.
    expect(audiencesOf({ practiceId: 'p1', consoleRole: 'admin' })).toContain('practice_admin');
    expect(audiencesOf({ practiceId: 'p1', consoleRole: 'other' })).not.toContain('practice_admin');
    expect(audiencesOf({ practiceId: 'p1', roles: ['practice_principal'] })).not.toContain('practice_admin');
  });

  it('gives a withdrawn account nothing but public', () => {
    // Rows here are kept for ever, so role alone would let a former
    // administrator hold the door open indefinitely.
    const withdrawn = audiencesOf({
      practiceId: 'p1',
      consoleRole: 'admin',
      roles: ['platform_admin', 'provider'],
      deactivatedAt: new Date(),
    });
    expect(withdrawn).toEqual(['public']);
  });

  it('recognises the three party audiences', () => {
    expect(audiencesOf({ roles: ['provider'] })).toContain('practitioner');
    expect(audiencesOf({ roles: ['patient'] })).toContain('patient');
    expect(audiencesOf({ roles: ['assignor'] })).toContain('assignor');
  });

  it('lets somebody be several things at once', () => {
    // A practitioner who also runs a practice is one person with two jobs, not
    // two accounts.
    const both = audiencesOf({ practiceId: 'p1', consoleRole: 'admin', roles: ['provider'] });
    expect(both).toEqual(expect.arrayContaining(['practice', 'practice_admin', 'practitioner']));
  });
});

describe('matching a path to a rule', () => {
  it('matches token pages by prefix', () => {
    expect(ruleFor('/status/abc123')).toBe(PAGES['/status']);
    expect(ruleFor('/status/abc123/correct')).toBe(PAGES['/status']);
    expect(ruleFor('/invitation/xyz')).toBe(PAGES['/invitation']);
  });

  it('prefers the longest prefix, so a child is not answered by its parent', () => {
    // `/review/identity` has no entry of its own today and correctly falls to
    // `/review`; if one is added, this is what makes it win.
    expect(ruleFor('/review/identity')).toBe(PAGES['/review']);
    expect(ruleFor('/practice/users')).toBe(PAGES['/practice/users']);
    expect(ruleFor('/practice/users')).not.toBe(PAGES['/practice']);
  });

  it('ignores query strings and trailing slashes', () => {
    expect(ruleFor('/practice/users/')).toBe(PAGES['/practice/users']);
    expect(ruleFor('/practice/confirm-email?token=abc')).toBe(PAGES['/practice/confirm-email']);
  });
});

describe('reaching a page', () => {
  const ordinary = audiencesOf({ practiceId: 'p1', consoleRole: 'other' });
  const admin = audiencesOf({ practiceId: 'p1', consoleRole: 'admin' });
  const operator = audiencesOf({ roles: ['platform_admin'] });
  const practitioner = audiencesOf({ roles: ['provider'] });
  const stranger = audiencesOf({});

  it('REFUSES A PAGE NOBODY CLASSIFIED', () => {
    /*
     * The point of the whole table. Adding a screen and forgetting to say who
     * may open it fails closed and loudly, rather than quietly shipping an open
     * page — the failure that costs you is the one that looks like success.
     */
    expect(mayReach('/practice/some-new-screen', admin)).toBe(false);
    expect(() => assertMayReach('/nonsense', admin)).toThrow(PageAccessError);
    expect(() => assertMayReach('/nonsense', admin)).toThrow(/no such page|nobody has said/i);
  });

  it('keeps user management to the administrator', () => {
    expect(mayReach('/practice/users', admin)).toBe(true);
    expect(mayReach('/practice/users', ordinary)).toBe(false);
  });

  it('lets an ordinary practice account reach the ordinary practice pages', () => {
    expect(mayReach('/practice', ordinary)).toBe(true);
    expect(mayReach('/practice/practitioners', ordinary)).toBe(true);
    expect(mayReach('/practice/locations', ordinary)).toBe(true);
  });

  it('keeps the queue and review screens to the platform, despite their paths', () => {
    // Three platform screens live under /practice/ and are not practice pages
    // at all — they span every practice. The path is misleading; this is what
    // actually governs.
    for (const page of ['/practice/queue', '/practice/queuebyOrg', '/practice/reviews', '/review']) {
      expect(mayReach(page, operator)).toBe(true);
      expect(mayReach(page, admin)).toBe(false);
    }
  });

  it('does NOT let a platform operator open practice pages directly', () => {
    /*
     * They get there by acting as somebody at the practice, which carries a
     * practice claim. Naming `platform` on those pages would let an operator
     * read a practice's records with no session, no stated reason, and nothing
     * said to the practice.
     */
    expect(mayReach('/practice/application', operator)).toBe(false);

    const acting = audiencesOf({ roles: ['platform_admin'], practiceId: 'p1' });
    expect(mayReach('/practice/application', acting)).toBe(true);
  });

  it('leaves the token-bearing pages reachable without a session', () => {
    // The people answering these are precisely the people who cannot sign in:
    // a practitioner who has not accepted, an applicant with no account,
    // somebody proving they hold an address that is not yet the practice's.
    for (const page of ['/apply', '/invitation/abc', '/status/abc', '/verify/abc', '/practice/confirm-email']) {
      expect(mayReach(page, stranger)).toBe(true);
    }
  });

  it('keeps a practitioner out of the practice console', () => {
    // A practitioner works at several practices over time, and the platform
    // must never become a directory of who works where.
    expect(mayReach('/practitioner', practitioner)).toBe(true);
    expect(mayReach('/practice/practitioners', practitioner)).toBe(false);
    expect(mayReach('/practice/users', practitioner)).toBe(false);
  });
});

describe('navigation that does not lie', () => {
  it('lists only what an audience can actually open', () => {
    const forOrdinary = pagesFor(audiencesOf({ practiceId: 'p1', consoleRole: 'other' }));
    expect(forOrdinary).toContain('/practice');
    expect(forOrdinary).not.toContain('/practice/users');
    expect(forOrdinary).not.toContain('/practice/queue');
  });

  it('every page names at least one audience', () => {
    // A rule with an empty audience list is unreachable by anybody, which is
    // never what somebody meant to write.
    for (const [path, rule] of Object.entries(PAGES)) {
      expect(rule.audiences.length).toBeGreaterThan(0);
      expect(rule.why.length).toBeGreaterThan(10);
      expect(path.startsWith('/')).toBe(true);
    }
  });
});
