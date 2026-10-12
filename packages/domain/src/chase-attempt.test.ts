import {
  assertChaseAttemptAllowed,
  assertChaseSubjectChaseable,
  chaseAttemptOrdinal,
  CHASE_ATTEMPT_CHANNELS,
  CHASE_ATTEMPT_OUTCOMES,
  CHASE_OUTCOMES_BY_CHANNEL,
  isChaseAttemptChannel,
} from './chase-attempt';
import { OUTBOUND_CHANNELS } from './outbound-queue';

const ok = {
  subjectType: 'ServiceRecord',
  channel: 'phone',
  outcome: 'no_answer',
  attemptedBy: 'Sam Manager',
  attemptsMade: 1,
  daysRemaining: 200,
} as const;

describe('a human chase attempt (Carl, 3 Sep 2026 — "an audit-trail to show that a practice-user called the Patient")', () => {
  it('eightynineAA_notice_is_never_a_chase_subject (rule 7, REQ-CHASE-02, REQ-END-05)', () => {
    expect(() => assertChaseSubjectChaseable('Notice')).toThrow(/never chased/);
    expect(() => assertChaseAttemptAllowed({ ...ok, subjectType: 'Notice' })).toThrow(/REQ-CHASE-02/);
    // And nothing else sneaks in either — the list is closed.
    expect(() => assertChaseSubjectChaseable('NoticeDeliveryEvent')).toThrow(/not something a chase attempt/);
    expect(() => assertChaseSubjectChaseable('ServiceRecord')).not.toThrow();
    expect(() => assertChaseSubjectChaseable('Agreement')).not.toThrow();
  });

  it('reuses the platform words for the channels it shares with the platform', () => {
    for (const shared of ['email', 'sms'] as const) {
      expect(isChaseAttemptChannel(shared)).toBe(true);
      expect((OUTBOUND_CHANNELS as readonly string[]).includes(shared)).toBe(true);
    }
    // The three the platform cannot do are the point of the record.
    expect(CHASE_ATTEMPT_CHANNELS).toEqual(['phone', 'sms', 'email', 'in_person', 'post']);
  });

  it('needs a signed-in person — an unattributed attempt proves nothing', () => {
    expect(() => assertChaseAttemptAllowed({ ...ok, attemptedBy: null })).toThrow(/signed-in person/);
    expect(() => assertChaseAttemptAllowed({ ...ok, attemptedBy: '   ' })).toThrow(/signed-in person/);
  });

  it('refuses an outcome the channel cannot produce', () => {
    expect(() => assertChaseAttemptAllowed({ ...ok, channel: 'post', outcome: 'left_message' })).toThrow(
      /cannot end in "left_message"/,
    );
    expect(() => assertChaseAttemptAllowed({ ...ok, channel: 'in_person', outcome: 'wrong_contact' })).toThrow(
      /cannot end in "wrong_contact"/,
    );
    expect(() => assertChaseAttemptAllowed({ ...ok, channel: 'phone', outcome: 'left_message' })).not.toThrow();
    expect(() => assertChaseAttemptAllowed({ ...ok, channel: 'shouted', outcome: 'reached' })).toThrow(/not a way of contacting/);
    expect(() => assertChaseAttemptAllowed({ ...ok, outcome: 'gave_up' })).toThrow(/not an outcome/);
  });

  it('every channel can record a refusal — the outcome the practice most needs to keep', () => {
    for (const channel of CHASE_ATTEMPT_CHANNELS) {
      expect(CHASE_OUTCOMES_BY_CHANNEL[channel]).toContain('refused');
      expect(CHASE_OUTCOMES_BY_CHANNEL[channel].every((o) => (CHASE_ATTEMPT_OUTCOMES as readonly string[]).includes(o))).toBe(true);
    }
  });

  it('never_chase_past_the_deadline (REQ-CHASE-08) — the expired band takes no attempt at all', () => {
    expect(() => assertChaseAttemptAllowed({ ...ok, daysRemaining: 3, attemptsMade: 0 })).toThrow(/REQ-CHASE-08/);
    expect(() => assertChaseAttemptAllowed({ ...ok, daysRemaining: -40, attemptsMade: 0 })).toThrow(/revenue forgone/);
  });

  it('stops at the band cap, and asks chase.ts rather than restating it (REQ-CHASE-09)', () => {
    // standard band: three attempts.
    expect(() => assertChaseAttemptAllowed({ ...ok, daysRemaining: 200, attemptsMade: 2 })).not.toThrow();
    expect(() => assertChaseAttemptAllowed({ ...ok, daysRemaining: 200, attemptsMade: 3 })).toThrow(/attempts are used up/);
    // last_chance band: one.
    expect(() => assertChaseAttemptAllowed({ ...ok, daysRemaining: 20, attemptsMade: 0 })).not.toThrow();
    expect(() => assertChaseAttemptAllowed({ ...ok, daysRemaining: 20, attemptsMade: 1 })).toThrow(/attempts are used up/);
    // REQ-CHASE-10: the practice's own recorded instruction raises the cap, and never the deadline.
    expect(() =>
      assertChaseAttemptAllowed({ ...ok, daysRemaining: 200, attemptsMade: 3, practiceRaisedCapTo: 5 }),
    ).not.toThrow();
    expect(() =>
      assertChaseAttemptAllowed({ ...ok, daysRemaining: 3, attemptsMade: 0, practiceRaisedCapTo: 99 }),
    ).toThrow(/REQ-CHASE-08/);
  });

  it('a correction supersedes, needs a reason, and does not consume a rung', () => {
    const capped = { ...ok, daysRemaining: 200, attemptsMade: 3 } as const;
    expect(() => assertChaseAttemptAllowed({ ...capped, supersedes: 'row-1' })).toThrow(/what was wrong with it/);
    expect(() => assertChaseAttemptAllowed({ ...capped, supersedes: 'row-1', note: 'Rang the mother, not the patient.' })).not.toThrow();
    // Even past the deadline: a wrong record of what happened before it closed still has to be correctable.
    expect(() =>
      assertChaseAttemptAllowed({ ...ok, daysRemaining: -10, supersedes: 'row-1', note: 'Wrong channel recorded.' }),
    ).not.toThrow();
  });

  it('caps the note, which is the only free text on the record', () => {
    expect(() => assertChaseAttemptAllowed({ ...ok, note: 'x'.repeat(1001) })).toThrow(/at most 1000/);
    expect(() => assertChaseAttemptAllowed({ ...ok, note: 'x'.repeat(1000) })).not.toThrow();
  });

  it('numbers the rung it sits on', () => {
    expect(chaseAttemptOrdinal(0)).toBe(1);
    expect(chaseAttemptOrdinal(2)).toBe(3);
  });
});
