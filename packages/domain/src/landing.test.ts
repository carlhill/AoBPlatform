import { isPlatformOperator, isPracticeUser, landingPath, mayChoosePractice } from './landing';

describe('landingPath', () => {
  it('sends a practice user to their own hub', () => {
    expect(landingPath({ practiceId: 'p1' })).toBe('/practice/setup');
  });

  it('sends a platform operator to the queue', () => {
    expect(landingPath({ roles: ['platform_admin'] })).toBe('/review');
  });

  /*
   * The bug this rule exists for: a practice administrator signed in with a
   * passkey and landed on the developer scaffold, because nothing decided
   * where they should go.
   */
  it('never leaves somebody on the root when it knows who they are', () => {
    expect(landingPath({ practiceId: 'p1' })).not.toBe('/');
    expect(landingPath({ roles: ['platform_admin'] })).not.toBe('/');
  });

  it('sends an account with neither to help, not to the scaffold', () => {
    // This used to expect '/', which is the developer scaffold. Landing a
    // signed-in person there tells them nothing about why they are stuck and
    // offers them practice onboarding they have no business doing.
    expect(landingPath({})).toBe('/help');
    expect(landingPath({ roles: ['practice_principal'] })).toBe('/help');
  });

  /*
   * The claim is the narrower, more specific fact. Somebody holding both is
   * acting for a practice in this session.
   */
  it('PREFERS THE PRACTICE CLAIM over a platform role', () => {
    expect(landingPath({ roles: ['platform_admin'], practiceId: 'p1' })).toBe('/practice/setup');
  });

  it('honours where they were actually heading', () => {
    expect(landingPath({ practiceId: 'p1', intended: '/practice/locations' })).toBe('/practice/locations');
    expect(landingPath({ roles: ['platform_admin'], intended: '/review/abc' })).toBe('/review/abc');
  });

  /*
   * The intended path still goes through safeReturnPath, so an open redirect
   * cannot be smuggled in through the thing that decides where people land.
   */
  it('REFUSES a foreign destination and decides one itself', () => {
    expect(landingPath({ practiceId: 'p1', intended: 'https://evil.example' })).toBe('/practice/setup');
    expect(landingPath({ practiceId: 'p1', intended: '//evil.example' })).toBe('/practice/setup');
    expect(landingPath({ roles: ['platform_admin'], intended: '/callback' })).toBe('/review');
  });
});

describe('who is a practice user', () => {
  /*
   * The CLAIM, not the role. Roles say what somebody may do; the claim says
   * which practice they are. A practice_principal with no claim has not been
   * scoped, and sending it to a practice screen would ask it to choose one.
   */
  it('is decided by the practice claim, not by a role', () => {
    expect(isPracticeUser({ practiceId: 'p1' })).toBe(true);
    expect(isPracticeUser({ roles: ['practice_principal'] })).toBe(false);
  });

  it('treats a blank claim as no claim', () => {
    expect(isPracticeUser({ practiceId: '' })).toBe(false);
    expect(isPracticeUser({ practiceId: '   ' })).toBe(false);
    expect(isPracticeUser({ practiceId: null })).toBe(false);
  });

  it('recognises a platform operator by role', () => {
    expect(isPlatformOperator({ roles: ['platform_admin'] })).toBe(true);
    expect(isPlatformOperator({ roles: ['practice_principal'] })).toBe(false);
    expect(isPlatformOperator({})).toBe(false);
  });
});

describe('choosing a practice', () => {
  /*
   * A practice user has exactly one, written into their token. Offering them a
   * list would be offering them other people's practices, and honouring a
   * stored selection would let a client-side value override a server-issued
   * claim.
   */
  it('IS REFUSED to anybody carrying a practice claim', () => {
    expect(mayChoosePractice({ practiceId: 'p1' })).toBe(false);
    expect(mayChoosePractice({ roles: ['platform_admin'], practiceId: 'p1' })).toBe(false);
  });

  it('is allowed to an operator with no claim, who has to pick one', () => {
    expect(mayChoosePractice({ roles: ['platform_admin'] })).toBe(true);
    expect(mayChoosePractice({})).toBe(true);
  });

  describe('a practitioner', () => {
    it('is sent to their own hub', () => {
      /*
       * The failure this prevents actually happened twice. A practice
       * administrator signed in and landed on the developer scaffold; it was
       * fixed for them, and the day practitioners could first sign in they
       * landed on the same page — offering practice onboarding they have no
       * business doing.
       */
      expect(landingPath({ roles: ['provider'], practitionerId: 'p1' })).toBe('/practitioner');
    });

    it('is NOT identified by the provider role alone', () => {
      // The role says what kind of person they are; the claim says which
      // person. Without one there is nobody to show, and the hub would refuse.
      // They go to /help, not to the scaffold.
      expect(landingPath({ roles: ['provider'] })).toBe('/help');
    });

    it('yields to a practice claim when somebody has both', () => {
      // One person, two jobs. The practice hub is the one with work waiting.
      expect(landingPath({ roles: ['provider'], practitionerId: 'p1', practiceId: 'prac1' })).toBe(
        '/practice/setup',
      );
    });

    it('still honours where they were heading before signing in', () => {
      expect(landingPath({ roles: ['provider'], practitionerId: 'p1', intended: '/practitioner/affiliations' })).toBe(
        '/practitioner/affiliations',
      );
    });
  });

  describe('somebody we cannot place', () => {
    it('is sent to help, NEVER to the developer scaffold', () => {
      /*
       * The scaffold is headed "Scaffold status view" and offers practice
       * onboarding to whoever lands on it. Showing that to a signed-in person
       * we could not place is alarming in production and useless everywhere —
       * it says nothing about why they are stuck.
       */
      expect(landingPath({ roles: [] })).toBe('/help');
      expect(landingPath({ roles: ['front_desk'] })).toBe('/help');
      expect(landingPath({ practiceId: '   ' })).toBe('/help');
    });

    it('still honours where they were heading', () => {
      // Being unplaceable does not mean they were going nowhere.
      expect(landingPath({ roles: [], intended: '/status/abc' })).toBe('/status/abc');
    });
  });
});
