import {
  CONSOLE_ROLES,
  INACTIVITY_GRACE_MONTHS,
  INACTIVITY_WARN_MONTHS,
  MAX_ADMIN_ACCOUNTS,
  MAX_PASSKEYS_PER_ADMIN,
  MAX_USERS_PER_SCOPE,
  PracticeUserError,
  assertMayAddUser,
  countsToward,
  inactivityAction,
  passkeysRemaining,
  scopeOf,
  userStatus,
} from './practice-users';

const LOC = '11111111-1111-4111-8111-111111111111';
const LOC_B = '22222222-2222-4222-8222-222222222222';
const DEPT = '33333333-3333-4333-8333-333333333333';

/** Five active organisation-scoped users — the cap, exactly. */
function fullOrgScope() {
  return Array.from({ length: MAX_USERS_PER_SCOPE }, () => ({
    consoleRole: 'other',
    locationId: null,
    departmentId: null,
  }));
}

describe('the caps', () => {
  it('holds the agreed numbers', () => {
    expect(MAX_USERS_PER_SCOPE).toBe(5);
    expect(MAX_ADMIN_ACCOUNTS).toBe(1);
    expect(MAX_PASSKEYS_PER_ADMIN).toBe(6);
    expect(INACTIVITY_WARN_MONTHS).toBe(6);
    expect(INACTIVITY_GRACE_MONTHS).toBe(3);
    expect(CONSOLE_ROLES).toEqual(['admin', 'other']);
  });

  it('allows a sixth person once somebody is deactivated', () => {
    /*
     * Deactivated accounts are KEPT — a person who approved something must
     * stay identifiable long after they leave. If they also counted against
     * the cap, ordinary turnover would make a practice permanently unable to
     * add anybody, punishing them for the retention rule.
     */
    const full = fullOrgScope();
    expect(() => assertMayAddUser({ role: 'other', existing: full })).toThrow(PracticeUserError);

    const withOneGone = [...full.slice(1), { ...full[0], deactivatedAt: new Date('2026-01-01') }];
    expect(() => assertMayAddUser({ role: 'other', existing: withOneGone })).not.toThrow();
  });

  it('counts each scope INSTANCE separately', () => {
    // Five at one location must not block a different location.
    const atLocA = Array.from({ length: MAX_USERS_PER_SCOPE }, () => ({
      consoleRole: 'other',
      locationId: LOC,
      departmentId: null,
    }));
    expect(() => assertMayAddUser({ role: 'other', existing: atLocA, locationId: LOC })).toThrow();
    expect(() => assertMayAddUser({ role: 'other', existing: atLocA, locationId: LOC_B })).not.toThrow();
    // Nor the organisation scope.
    expect(() => assertMayAddUser({ role: 'other', existing: atLocA })).not.toThrow();
  });

  it('says what to do about a full scope, not merely that it is full', () => {
    const res = (() => {
      try {
        assertMayAddUser({ role: 'other', existing: fullOrgScope() });
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(res).toMatch(/Deactivate somebody/);
  });

  it('refuses a role that is not a console role', () => {
    expect(() => assertMayAddUser({ role: 'superuser', existing: [] })).toThrow(/not a console role/);
  });
});

describe('the single administrator account', () => {
  it('refuses a second one, and explains why it is not a person', () => {
    const existing = [{ consoleRole: 'admin', locationId: null, departmentId: null }];
    expect(() => assertMayAddUser({ role: 'admin', existing })).toThrow(PracticeUserError);
    expect(() => assertMayAddUser({ role: 'admin', existing })).toThrow(/belongs\s+to the practice/);
  });

  it('allows one after the previous is deactivated', () => {
    const existing = [{ consoleRole: 'admin', deactivatedAt: new Date('2026-02-01'), locationId: null, departmentId: null }];
    expect(() => assertMayAddUser({ role: 'admin', existing })).not.toThrow();
  });

  it('REFUSES TO SCOPE AN ADMIN TO A SITE', () => {
    // An administrator reaches the whole practice. A department-scoped "admin"
    // would be a narrower thing wearing the name of the broadest, and every
    // screen reading the role would over-grant.
    expect(() => assertMayAddUser({ role: 'admin', existing: [], locationId: LOC })).toThrow(/whole practice/);
  });

  it('does not let the admin consume an ordinary scope place', () => {
    const existing = [{ consoleRole: 'admin', locationId: null, departmentId: null }, ...fullOrgScope().slice(1)];
    // 1 admin + 4 others = the admin must not be the fifth "other".
    expect(() => assertMayAddUser({ role: 'other', existing })).not.toThrow();
  });
});

describe('a department needs its location', () => {
  it('refuses a department scope with no location', () => {
    expect(() => assertMayAddUser({ role: 'other', existing: [], departmentId: DEPT })).toThrow(/inside a location/);
  });

  it('accepts one with both', () => {
    expect(() =>
      assertMayAddUser({ role: 'other', existing: [], locationId: LOC, departmentId: DEPT }),
    ).not.toThrow();
  });
});

describe('countsToward and scopeOf', () => {
  it('ignores staff who have no console access at all', () => {
    // A staff record is not an account until somebody makes it one.
    expect(countsToward({ consoleRole: null }, {})).toBe(false);
  });

  it('names the narrowest scope', () => {
    expect(scopeOf({})).toBe('organisation');
    expect(scopeOf({ locationId: LOC })).toBe('location');
    expect(scopeOf({ locationId: LOC, departmentId: DEPT })).toBe('department');
  });
});

describe('the inactivity lifecycle', () => {
  const jan = new Date('2026-01-01T00:00:00Z');

  it('does nothing to somebody who signed in recently', () => {
    expect(inactivityAction({ consoleRole: 'other', lastSignInAt: jan }, new Date('2026-03-01T00:00:00Z'))).toBe('none');
  });

  it('warns at six months', () => {
    expect(inactivityAction({ consoleRole: 'other', lastSignInAt: jan }, new Date('2026-07-01T00:00:00Z'))).toBe('warn');
  });

  it('deactivates three months after the warning, not before', () => {
    const warned = { consoleRole: 'other', lastSignInAt: jan, inactivityWarnedAt: new Date('2026-07-01T00:00:00Z') };
    expect(inactivityAction(warned, new Date('2026-09-30T00:00:00Z'))).toBe('none');
    expect(inactivityAction(warned, new Date('2026-10-01T00:00:00Z'))).toBe('deactivate');
  });

  it('STOPS THE CLOCK WHEN THEY COME BACK', () => {
    /*
     * The one that matters. Somebody warned in July who signs in during August
     * has answered it. If the grace period kept running from the warning they
     * would be deactivated in October despite having done exactly what was
     * asked — and they would have no idea why.
     */
    const cameBack = {
      consoleRole: 'other',
      inactivityWarnedAt: new Date('2026-07-01T00:00:00Z'),
      lastSignInAt: new Date('2026-08-01T00:00:00Z'),
    };
    expect(inactivityAction(cameBack, new Date('2026-10-01T00:00:00Z'))).toBe('none');
    expect(inactivityAction(cameBack, new Date('2027-06-01T00:00:00Z'))).toBe('warn');
  });

  it('measures an unaccepted invitation from the invitation', () => {
    // An invitation left open for ever is a credential nobody is watching.
    expect(inactivityAction({ consoleRole: 'other', invitedAt: jan }, new Date('2026-07-01T00:00:00Z'))).toBe('warn');
  });

  it('leaves alone anybody already deactivated, and anybody with no access', () => {
    expect(inactivityAction({ consoleRole: 'other', lastSignInAt: jan, deactivatedAt: jan }, new Date('2027-01-01'))).toBe('none');
    expect(inactivityAction({ consoleRole: null, lastSignInAt: jan }, new Date('2027-01-01'))).toBe('none');
  });

  it('does nothing when there is no date to measure from', () => {
    expect(inactivityAction({ consoleRole: 'other' }, new Date('2027-01-01'))).toBe('none');
    expect(inactivityAction({ consoleRole: 'other', lastSignInAt: 'not a date' }, new Date('2027-01-01'))).toBe('none');
  });
});

describe('passkeysRemaining', () => {
  it('counts down from six and never below zero', () => {
    expect(passkeysRemaining(0)).toBe(6);
    expect(passkeysRemaining(6)).toBe(0);
    expect(passkeysRemaining(9)).toBe(0);
  });
});

describe('userStatus', () => {
  it('distinguishes the states a practice admin actually decides from', () => {
    expect(userStatus({ consoleRole: null }).key).toBe('no_access');
    expect(userStatus({ consoleRole: 'other', deactivatedAt: new Date() }).key).toBe('deactivated');
    expect(userStatus({ consoleRole: 'other', invitedAt: new Date() }).key).toBe('invited');
    // Added but never written to is its own state, not a synonym for invited.
    expect(userStatus({ consoleRole: 'other' }).key).toBe('added');
    expect(userStatus({ consoleRole: 'other', lastSignInAt: new Date() }).key).toBe('active');
    expect(userStatus({ consoleRole: 'other', inactivityWarnedAt: new Date() }).key).toBe('warned_never');
    expect(
      userStatus({ consoleRole: 'other', lastSignInAt: new Date(), inactivityWarnedAt: new Date() }).key,
    ).toBe('warned');
  });

  it('never labels a deactivated account as merely inactive', () => {
    // Deactivated is a decision; inactive is an observation. A screen that
    // blurs them invites somebody to "restore" an account nobody withdrew.
    const s = userStatus({ consoleRole: 'other', deactivatedAt: new Date(), inactivityWarnedAt: new Date() });
    expect(s.key).toBe('deactivated');
    expect(s.label).toMatch(/restored/);
  });
});

describe('added is not invited', () => {
  /*
   * The bug this pins: status was inferred from the absence of a sign-in, so
   * somebody nobody had written to appeared as "Invited — not signed in yet".
   * That reads as "the ball is in their court" when it is squarely in ours.
   */
  it('says nothing has been sent when nothing has been sent', () => {
    const s = userStatus({ consoleRole: 'other', invitedAt: null, lastSignInAt: null });
    expect(s.key).toBe('added');
    expect(s.label).toMatch(/no invitation sent/i);
    // Muted, not warn: nobody is late for anything yet.
    expect(s.tone).toBe('muted');
  });

  it('says invited once an invitation has actually gone out', () => {
    const s = userStatus({ consoleRole: 'other', invitedAt: new Date('2026-08-22'), lastSignInAt: null });
    expect(s.key).toBe('invited');
  });

  it('says active once they have signed in', () => {
    const s = userStatus({
      consoleRole: 'other',
      invitedAt: new Date('2026-08-22'),
      lastSignInAt: new Date('2026-08-23'),
    });
    expect(s.key).toBe('active');
  });

  it('never calls a signed-in account "added", whatever invitedAt says', () => {
    // Somebody who signed in was invited. If the column disagrees the column
    // is wrong, and the status must not contradict a sign-in that happened.
    expect(userStatus({ consoleRole: 'other', invitedAt: null, lastSignInAt: new Date() }).key).toBe('active');
  });

  it('still reports no access before it reports anything about invitations', () => {
    // Somebody on staff with no console role was never going to be invited,
    // and "no invitation sent yet" would imply one is coming.
    expect(userStatus({ consoleRole: null, invitedAt: null, lastSignInAt: null }).key).toBe('no_access');
  });
});

