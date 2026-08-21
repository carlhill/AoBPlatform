import {
  ACCEPTANCE_MEANS,
  ACCEPTANCE_METHODS,
  ACCEPTANCE_STRENGTH,
  INVITATION_ATTEMPT_CAP,
  INVITATION_CONSEQUENCES,
  INVITATION_DAYS,
  InvitationError,
  assertCanAnswer,
  canAnswerInvitation,
  invitationMessage,
  invitationSummary,
  isInvitationCodeShaped,
  type InvitationState,
} from './invitation';

describe('the invitation code', () => {
  it('is exactly six digits', () => {
    expect(isInvitationCodeShaped('012345')).toBe(true);
    expect(isInvitationCodeShaped(' 483920 ')).toBe(true);
  });

  /*
   * A leading zero is real. Anything that parses the code as a NUMBER turns
   * "012345" into 12345 and it stops matching what was emailed — which is
   * exactly the bug the migration's lpad() exists to prevent at the other end.
   */
  it('keeps leading zeros, which are part of the code', () => {
    expect(isInvitationCodeShaped('000001')).toBe(true);
    expect(Number('000001').toString()).not.toBe('000001');
  });

  it('refuses anything that is not six digits', () => {
    expect(isInvitationCodeShaped('12345')).toBe(false);
    expect(isInvitationCodeShaped('1234567')).toBe(false);
    expect(isInvitationCodeShaped('12345a')).toBe(false);
    expect(isInvitationCodeShaped('')).toBe(false);
  });
});

describe('answering', () => {
  it('is possible only while the invitation is live', () => {
    expect(canAnswerInvitation('live')).toBe(true);
    const dead: InvitationState[] = [
      'expired',
      'locked',
      'already_accepted',
      'already_declined',
      'ended',
      'deregistered',
      'not_found',
    ];
    for (const state of dead) expect(canAnswerInvitation(state)).toBe(false);
  });

  it('throws with the reader-facing reason, not a code', () => {
    expect(() => assertCanAnswer('expired')).toThrow(InvitationError);
    expect(() => assertCanAnswer('expired')).toThrow(/expired/i);
    expect(() => assertCanAnswer('live')).not.toThrow();
  });
});

describe('what the reader is told', () => {
  /*
   * A dead end that does not say what to do next produces somebody who does
   * nothing — which the practice reads as a refusal.
   */
  it('always says what to do next', () => {
    const dead: InvitationState[] = ['expired', 'locked', 'already_declined', 'ended', 'not_found'];
    for (const state of dead) {
      expect(invitationMessage(state)).toMatch(/ask the practice|nothing further|AHPRA register/i);
    }
  });

  it('counts down remaining attempts so the lock is not a surprise', () => {
    expect(invitationMessage('live', 2)).toContain('2 attempts left');
    expect(invitationMessage('live', 1)).toContain('1 attempt left');
  });

  it('asks for the code when nothing has gone wrong yet', () => {
    expect(invitationMessage('live', INVITATION_ATTEMPT_CAP)).toMatch(/six-digit code/i);
  });

  it('does not blame the practitioner for the lock', () => {
    expect(invitationMessage('locked')).toMatch(/not a judgement/i);
  });

  it('names the expiry it is talking about', () => {
    expect(invitationMessage('expired')).toContain(String(INVITATION_DAYS));
  });
});

describe('what is being agreed to', () => {
  it('names the practice and the place, because consent needs a subject', () => {
    const summary = invitationSummary({
      practiceName: 'Sampletown Family Practice',
      locationCode: 'Main St',
      locationAddress: '1 Example Street, Sampletown NSW 2000',
    });
    expect(summary).toContain('Sampletown Family Practice');
    expect(summary).toContain('Main St');
    expect(summary).toContain('1 Example Street');
  });

  it('falls back to the address when the site has no name', () => {
    const summary = invitationSummary({
      practiceName: 'A Practice',
      locationAddress: '9 Nowhere Road',
      locationCode: null,
    });
    expect(summary).toContain('9 Nowhere Road');
    expect(summary).not.toContain('()');
  });

  it('names the department when there is one', () => {
    expect(
      invitationSummary({
        practiceName: 'A Practice',
        locationAddress: '9 Nowhere Road',
        departmentName: 'Emergency',
      }),
    ).toContain('in Emergency');
  });

  /*
   * The load-bearing half. A practitioner who believes they have just signed
   * something for a patient will not read the next thing we send them.
   */
  it('says plainly that this is NOT consent on a patient’s behalf', () => {
    expect(INVITATION_CONSEQUENCES.join(' ')).toMatch(/does NOT consent to anything on a patient/i);
  });

  it('says how to end it, because a relationship with no exit is a trap', () => {
    expect(INVITATION_CONSEQUENCES.join(' ')).toMatch(/end it at any time/i);
  });
});

describe('how an acceptance was obtained', () => {
  it('describes every method, so evidence never reads as a bare "accepted"', () => {
    for (const method of ACCEPTANCE_METHODS) {
      expect(ACCEPTANCE_MEANS[method]).toBeTruthy();
      expect(ACCEPTANCE_MEANS[method].length).toBeGreaterThan(40);
    }
  });

  /*
   * The distinction the acceptanceMethod column exists to preserve. A
   * biometric assertion and a forwarded email must never compare equal.
   */
  it('ranks a passkey above an emailed code above the practice’s own word', () => {
    expect(ACCEPTANCE_STRENGTH.passkey).toBeGreaterThan(ACCEPTANCE_STRENGTH.email_link_and_code);
    expect(ACCEPTANCE_STRENGTH.email_link_and_code).toBeGreaterThan(ACCEPTANCE_STRENGTH.console);
  });

  it('is honest that an emailed code proves an inbox, not a person', () => {
    expect(ACCEPTANCE_MEANS.email_link_and_code).toMatch(/does not prove who/i);
  });

  it('is honest that a console acceptance has only the practice as witness', () => {
    expect(ACCEPTANCE_MEANS.console).toMatch(/only witness is the practice/i);
  });
});
