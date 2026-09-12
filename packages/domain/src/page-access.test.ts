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
    // A practitioner is identified by their CLAIM, like a practice user — the
    // role says what kind of person, the claim says which person.
    expect(audiencesOf({ practitionerId: 'dr1' })).toContain('practitioner');
    expect(audiencesOf({ roles: ['provider'] })).not.toContain('practitioner');
    expect(audiencesOf({ roles: ['patient'] })).toContain('patient');
    expect(audiencesOf({ roles: ['assignor'] })).toContain('assignor');
  });

  it('lets somebody be several things at once', () => {
    // A practitioner who also runs a practice is one person with two jobs, not
    // two accounts.
    const both = audiencesOf({ practiceId: 'p1', consoleRole: 'admin', practitionerId: 'dr1' });
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
  const practitioner = audiencesOf({ practitionerId: 'dr1' });
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
    /*
     * THE FRONT DESK IS RECEPTION'S, EXACTLY LIKE THE TABLET PAGE (Carl,
     * 12 Sep 2026; FRONT-DESK-PAGE.md §11). The pair is asserted together
     * because the whole justification for the new page's audience is that it
     * is the same one — a drift between them would mean either that reception
     * cannot do its job or that a beginner's page grants more than the expert
     * one it simplifies.
     */
    expect(mayReach('/practice/tablet', ordinary)).toBe(true);
    expect(mayReach('/practice/frontdesk', ordinary)).toBe(true);
  });

  it('opens the day’s work to every practice account, and to nobody without a practice', () => {
    /*
     * WHERE PRACTICE STAFF LAND (PRACTICE-NAVIGATION.md §2, §3), so it must
     * open for the whole practice audience: an arrival that refuses the person
     * who was just sent to it is the worst failure this table can have.
     *
     * AND EVERY DESTINATION ON IT IS ALREADY OPEN TO THEM — asserted here, at
     * the table, because the page itself only renders links and cannot make a
     * door that this does not.
     */
    for (const audience of [ordinary, admin]) {
      expect(mayReach('/practice/today', audience)).toBe(true);
      for (const destination of [
        '/practice/frontdesk',
        '/practice/practitioner/waiting',
        '/practice/tablet',
        '/practice/patients',
        '/practice/correspondence',
      ]) {
        expect(mayReach(destination, audience)).toBe(true);
      }
    }

    // An operator reaches it by ACTING AS the practice, which is what grants
    // the claim — never directly, like every other page of a practice's work.
    expect(mayReach('/practice/today', operator)).toBe(false);
    expect(mayReach('/practice/today', audiencesOf({ roles: ['platform_admin'], practiceId: 'p1' }))).toBe(true);

    // A practitioner has their own landing and does not hold a practice claim.
    expect(mayReach('/practice/today', practitioner)).toBe(false);
    expect(mayReach('/practice/today', stranger)).toBe(false);
  });

  it('the_setup_hub_still_opens_from_its_own_url', () => {
    /*
     * NOTHING MOVED (PRACTICE-NAVIGATION.md §5 rule 3). Landing changed; the
     * hub did not. A practice account still reaches `/practice/setup` by
     * bookmark, and so does everything under it — this is the half of the
     * change that is defined by what did NOT happen, so it is asserted rather
     * than assumed.
     */
    for (const page of [
      '/practice/setup',
      '/practice/devices',
      '/practice/templates',
      '/practice/application',
      '/practice/reports',
      '/practice/reconciliation',
    ]) {
      expect(mayReach(page, admin)).toBe(true);
    }
    expect(mayReach('/practice/setup', ordinary)).toBe(true);
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

  it('lets a platform operator open the organisation list', () => {
    /*
     * THE ONE `/practice/...` PATH AN OPERATOR REACHES WITHOUT ACTING AS
     * ANYBODY. It was closed to them, which shut the exact audience it was
     * written for out of the page that lists every organisation — the
     * component sends practice-scoped users away, so nobody could open it.
     *
     * It is the directory an operator needs in order to CHOOSE a practice to
     * act as. Without it the only way to reach one is to already know its id.
     */
    expect(mayReach('/practice', operator)).toBe(true);

    // And it changes nothing below it: a practice's own work still needs a
    // practice claim, which acting-as is what grants.
    for (const page of ['/practice/setup', '/practice/application', '/practice/locations', '/practice/pms']) {
      expect(mayReach(page, operator)).toBe(false);
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

  it('reaches the tablets twins under /platform/practices, the same way every other twin does', () => {
    /*
     * `/practice/devices` and `/practice/tablet` are `practice_admin`/`practice`
     * only, exactly like `/practice/application` above — so an operator still
     * cannot open THOSE directly. Their read-only twins live under
     * `/platform/practices`, which already carries `matchesChildren: true`
     * for precisely this: a practice's pages, reached as the platform, for
     * looking rather than acting (see the entry's own comment). No page-specific
     * entry is needed for either twin — the prefix rule covers a new one the
     * moment its route exists, which is what stops this table and the read-only
     * tree drifting apart.
     */
    expect(mayReach('/practice/devices', operator)).toBe(false);
    expect(mayReach('/practice/tablet', operator)).toBe(false);
    expect(mayReach('/platform/practices/p1/devices', operator)).toBe(true);
    expect(mayReach('/platform/practices/p1/tablet', operator)).toBe(true);
    expect(mayReach('/platform/practices/p1/devices', ordinary)).toBe(false);
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

  /*
   * THE PRACTITIONER'S PAGES AT A PRACTICE (PRACTITIONER-QUEUE-PAGE.md §1,
   * §3; Carl 12 Sep 2026).
   */
  it('gives a practitioner their own home at a practice, and reception no reason to open it', () => {
    const practitioner = audiencesOf({ practitionerId: 'pr1' });
    const reception = audiencesOf({ practiceId: 'p1' });

    expect(mayReach('/practice/practitioner', practitioner)).toBe(true);
    expect(mayReach('/practice/practitioner', reception)).toBe(false);
  });

  it('opens the waiting list to reception as well, because knowing who is waiting for whom is their job', () => {
    // Carl, 12 Sep 2026, widening §3: a practitioner sees their own list, an
    // administrator, manager or receptionist sees every practitioner's,
    // grouped. WHOSE list is resolved from the token at the query, never here.
    const practitioner = audiencesOf({ practitionerId: 'pr1' });
    const reception = audiencesOf({ practiceId: 'p1' });
    const admin = audiencesOf({ practiceId: 'p1', consoleRole: 'admin' });
    const stranger = audiencesOf({});

    for (const who of [practitioner, reception, admin]) {
      expect(mayReach('/practice/practitioner/waiting', who)).toBe(true);
    }
    expect(mayReach('/practice/practitioner/waiting', stranger)).toBe(false);
  });

  it('does not let the practitioner landing page answer for its own child', () => {
    // `matchesChildren` is opt-in, and the parent is the NARROWER rule. An
    // unclassified page beneath it must still fail closed rather than inherit.
    expect(ruleFor('/practice/practitioner/waiting')).toBe(PAGES['/practice/practitioner/waiting']);
    expect(ruleFor('/practice/practitioner/something-nobody-classified')).toBeNull();
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
