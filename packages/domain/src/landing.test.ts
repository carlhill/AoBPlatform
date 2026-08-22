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

  it('has nowhere better for an account with neither', () => {
    expect(landingPath({})).toBe('/');
    expect(landingPath({ roles: ['practice_principal'] })).toBe('/');
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
});
