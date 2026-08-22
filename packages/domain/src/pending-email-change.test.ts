import {
  MAX_CONFIRMATION_ATTEMPTS,
  PENDING_EMAIL_EXPIRY_DAYS,
  PendingEmailChangeError,
  afterStop,
  assertConfirmable,
  assertMayRequest,
  assertStoppable,
  expiresAt,
  isLive,
  mayAttemptConfirmation,
  recipientsFor,
} from './pending-email-change';

const AT = new Date('2026-08-22T10:00:00Z');

describe('who gets told about an administrator email change', () => {
  it('writes to the old address, which is the only one the requester does not control', () => {
    const to = recipientsFor({
      requestedEmail: 'new@practice.example',
      previousAdminEmail: 'old@practice.example',
      previousGroupEmail: 'reception@practice.example',
    });

    expect(to).toEqual([
      { to: 'new@practice.example', role: 'confirm' },
      { to: 'old@practice.example', role: 'notify_old' },
      { to: 'reception@practice.example', role: 'notify_group' },
    ]);
  });

  it('takes the group address as it was BEFORE the save', () => {
    /*
     * The attack this defeats: change the administrator address and the group
     * address in one save, so both notices land somewhere the requester holds
     * and nobody at the practice ever hears about it. Passing the before-state
     * is what makes changing both at once no better than changing one.
     */
    const to = recipientsFor({
      requestedEmail: 'attacker@elsewhere.example',
      previousAdminEmail: 'real.admin@practice.example',
      previousGroupEmail: 'reception@practice.example',
    });

    expect(to.map((r) => r.to)).toContain('reception@practice.example');
    expect(to.map((r) => r.to)).toContain('real.admin@practice.example');
  });

  it('does not warn the address that did not change', () => {
    // Recapitalising is not a handover. Sending "your address was changed" to
    // the address that did not change is how people learn to ignore the notice.
    const to = recipientsFor({
      requestedEmail: 'Admin@Practice.example',
      previousAdminEmail: 'admin@practice.example',
      previousGroupEmail: null,
    });

    expect(to).toHaveLength(1);
    expect(to[0].role).toBe('confirm');
  });

  it('does not write to the group address twice when it is also the admin address', () => {
    const to = recipientsFor({
      requestedEmail: 'new@practice.example',
      previousAdminEmail: 'shared@practice.example',
      previousGroupEmail: 'shared@practice.example',
    });

    expect(to.filter((r) => r.to === 'shared@practice.example')).toHaveLength(1);
  });

  it('still confirms when there is no old address to warn', () => {
    const to = recipientsFor({ requestedEmail: 'new@practice.example', previousAdminEmail: null, previousGroupEmail: null });
    expect(to).toEqual([{ to: 'new@practice.example', role: 'confirm' }]);
  });
});

describe('whether the change may be asked for', () => {
  const ok = { requestedEmail: 'new@practice.example', currentAdminEmail: 'old@practice.example', otherContactEmails: [] };

  it('allows an ordinary change', () => {
    expect(() => assertMayRequest(ok)).not.toThrow();
  });

  it('refuses an address that is not one', () => {
    expect(() => assertMayRequest({ ...ok, requestedEmail: 'not-an-address' })).toThrow(PendingEmailChangeError);
  });

  it('refuses a change to the address already in force', () => {
    expect(() => assertMayRequest({ ...ok, requestedEmail: 'OLD@practice.example' })).toThrow(/already the administrator/i);
  });

  it('refuses an address another contact already uses', () => {
    // Two roles sharing an inbox means the person asking for the change is
    // also the person who confirms it, and the second pair of eyes is nobody.
    expect(() =>
      assertMayRequest({ ...ok, otherContactEmails: ['manager@practice.example', 'new@practice.example'] }),
    ).toThrow(/another contact/i);
  });
});

describe('the life of a pending change', () => {
  it('expires five days out', () => {
    expect(expiresAt(AT).toISOString()).toBe('2026-08-27T10:00:00.000Z');
    expect(PENDING_EMAIL_EXPIRY_DAYS).toBe(5);
  });

  it('is live until then', () => {
    const p = { expiresAt: expiresAt(AT), outcome: null };
    expect(isLive(p, new Date('2026-08-26T10:00:00Z'))).toBe(true);
    expect(isLive(p, new Date('2026-08-28T10:00:00Z'))).toBe(false);
  });

  it('is not live once it has an outcome, whatever the clock says', () => {
    // Computed from the outcome and the clock rather than a status column, so
    // nothing is left looking live because a sweep did not run.
    const p = { expiresAt: expiresAt(AT), outcome: 'stopped' };
    expect(isLive(p, new Date('2026-08-23T10:00:00Z'))).toBe(false);
  });
});

describe('confirming', () => {
  const live = { expiresAt: expiresAt(AT), outcome: null, attempts: 0 };

  it('accepts a live request', () => {
    expect(() => assertConfirmable(live, new Date('2026-08-23T10:00:00Z'))).not.toThrow();
  });

  it('refuses one that was stopped, and says so plainly', () => {
    expect(() => assertConfirmable({ ...live, outcome: 'stopped' }, new Date('2026-08-23T10:00:00Z'))).toThrow(
      /stopped from the practice/i,
    );
  });

  it('refuses one that expired', () => {
    expect(() => assertConfirmable(live, new Date('2026-08-29T10:00:00Z'))).toThrow(/expired/i);
  });

  it('caps the attempts, because the code is short enough to guess', () => {
    expect(mayAttemptConfirmation({ attempts: MAX_CONFIRMATION_ATTEMPTS - 1 })).toBe(true);
    expect(mayAttemptConfirmation({ attempts: MAX_CONFIRMATION_ATTEMPTS })).toBe(false);
    expect(() => assertConfirmable({ ...live, attempts: MAX_CONFIRMATION_ATTEMPTS }, AT)).toThrow(/too many/i);
  });
});

describe('stopping', () => {
  it('is allowed after expiry, unlike confirming', () => {
    /*
     * Somebody reading the warning a week late must still be able to say no.
     * Refusing them would give the alarm a shorter life than the thing it
     * warns about.
     */
    expect(() => assertStoppable({ outcome: null })).not.toThrow();
  });

  it('is refused once the change went through, and points at a person', () => {
    expect(() => assertStoppable({ outcome: 'confirmed' })).toThrow(/already confirmed/i);
  });

  it('always raises a task no automated check may close', () => {
    // "This was not me", about the address that holds a credential. Whether or
    // not it turns out to be genuine, a person looks at the account.
    expect(afterStop()).toEqual({ raiseTask: true, kind: 'admin_contact_changed', stakes: 'high' });
  });
});
