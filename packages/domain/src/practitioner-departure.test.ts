import {
  DEPARTURE_REASONS,
  PractitionerDepartureError,
  assessPractitionerDeparture,
  isImmediate,
  departureNoticeToPractice,
  raisesConcern,
} from './practitioner-departure';

const NOW = new Date('2026-08-23T02:00:00Z');
const active = { status: 'active', startedAt: new Date('2026-01-01T00:00:00Z') };

describe('a practitioner leaving on their own say-so', () => {
  it('lets them leave without anybody agreeing to it', () => {
    /*
     * THE POINT OF THE WHOLE THING. If the practice had to agree, a practice
     * could keep somebody listed after they had gone — and a listed
     * practitioner is one under whose name consent can still be captured. That
     * is the fraud this platform exists to make impossible.
     */
    const result = assessPractitionerDeparture({
      affiliation: active,
      request: { reason: 'ending_employment', endsAt: new Date('2026-09-30T00:00:00Z') },
      now: NOW,
    });

    expect(result.endsAt.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(result.immediate).toBe(false);
  });

  it('takes effect NOW when the reason says the listing was wrong', () => {
    for (const reason of ['already_left', 'never_worked_here']) {
      const result = assessPractitionerDeparture({
        affiliation: active,
        request: { reason, note: 'I left in March.' },
        now: NOW,
      });
      expect(result.immediate).toBe(true);
      expect(result.endsAt).toEqual(NOW);
    }
  });

  it('ignores any date offered alongside an immediate reason', () => {
    // "I never worked here" and "…from next month" cannot both be true. The
    // reason wins, rather than the form quietly honouring a date that
    // contradicts it.
    const result = assessPractitionerDeparture({
      affiliation: active,
      request: { reason: 'never_worked_here', note: 'Never heard of them.', endsAt: new Date('2026-12-01') },
      now: NOW,
    });
    expect(result.endsAt).toEqual(NOW);
  });

  it('ALWAYS reaches a person when the listing is disputed', () => {
    /*
     * Not conditional on there being captures under the name. "Nobody used it"
     * is a fact for a reviewer to establish, not an assumption for this
     * function to make — and if it is wrong, the thing it was wrong about is
     * consent captured against a practitioner who was not there.
     */
    expect(assessPractitionerDeparture({
      affiliation: active,
      request: { reason: 'never_worked_here', note: 'x' },
      now: NOW,
    }).needsReview).toBe(true);

    expect(assessPractitionerDeparture({
      affiliation: active,
      request: { reason: 'ending_employment' },
      now: NOW,
    }).needsReview).toBe(false);
  });

  it('defaults to now when an ordinary departure names no date', () => {
    const result = assessPractitionerDeparture({
      affiliation: active,
      request: { reason: 'ending_employment' },
      now: NOW,
    });
    expect(result.endsAt).toEqual(NOW);
  });
});

describe('what it refuses', () => {
  it('refuses an affiliation that has already ended', () => {
    expect(() =>
      assessPractitionerDeparture({
        affiliation: { status: 'ended', endedAt: new Date('2026-06-01') },
        request: { reason: 'ending_employment' },
        now: NOW,
      }),
    ).toThrow(/already ended/i);
  });

  it('refuses an invitation that was never accepted, and says to reject it instead', () => {
    /*
     * Declining an invitation and leaving a job are different things. Recording
     * the first as the second would show employment that ended, which is a
     * claim about where somebody worked that would not be true.
     */
    expect(() =>
      assessPractitionerDeparture({
        affiliation: { status: 'invited' },
        request: { reason: 'ending_employment' },
        now: NOW,
      }),
    ).toThrow(/reject the invitation instead/i);
  });

  it('REFUSES A BACKDATED ORDINARY DEPARTURE', () => {
    /*
     * Backdating would retroactively invalidate consent captured in good faith
     * between then and now. "I have already left" is the supported way to say
     * it — that ends things today and puts it in front of a person, rather than
     * silently changing what was true last month.
     */
    expect(() =>
      assessPractitionerDeparture({
        affiliation: active,
        request: { reason: 'ending_employment', endsAt: new Date('2026-07-01') },
        now: NOW,
      }),
    ).toThrow(/already left/i);
  });

  it('insists on words for anything disputed or "other"', () => {
    for (const reason of ['already_left', 'never_worked_here', 'other']) {
      expect(() =>
        assessPractitionerDeparture({ affiliation: active, request: { reason }, now: NOW }),
      ).toThrow(/in your own words/i);
    }
  });

  it('refuses a reason it does not recognise', () => {
    expect(() =>
      assessPractitionerDeparture({ affiliation: active, request: { reason: 'because' }, now: NOW }),
    ).toThrow(PractitionerDepartureError);
  });
});

describe('what the practice is told', () => {
  it('states the fact and withholds the stated reason', () => {
    /*
     * The reason is between the practitioner and us until a reviewer decides
     * otherwise. A practice reading "they say they never worked here" before
     * anybody has checked helps nobody and prejudices the person who has to
     * check it.
     */
    const notice = departureNoticeToPractice({ practitionerName: 'Dr Savva', endsAt: NOW, immediate: true });
    const text = [notice.subject, ...notice.lines].join(' ');

    expect(text).toMatch(/no longer work/i);
    expect(text).not.toMatch(/never worked here/i);
    expect(text).not.toMatch(/already left/i);
  });

  it('tells them not to re-add somebody who has left', () => {
    // Re-adding creates a SECOND record of one person rather than correcting
    // the first, which is the thing the person-level record exists to prevent.
    const notice = departureNoticeToPractice({ practitionerName: 'Dr Savva', endsAt: NOW, immediate: true });
    expect(notice.lines.join(' ')).toMatch(/do not re-add/i);
  });

  it('says nothing changes yet when a date was given', () => {
    const notice = departureNoticeToPractice({
      practitionerName: 'Dr Savva',
      endsAt: new Date('2026-09-30T00:00:00Z'),
      immediate: false,
    });
    expect(notice.lines.join(' ')).toMatch(/nothing changes until then/i);
    expect(notice.lines.join(' ')).toContain('2026-09-30');
  });
});

describe('the reasons themselves', () => {
  it('marks exactly the two that dispute the listing', () => {
    const suspicious = DEPARTURE_REASONS.filter((r) => r.suspicious).map((r) => r.key);
    expect(suspicious.sort()).toEqual(['already_left', 'never_worked_here']);

    for (const key of suspicious) {
      expect(isImmediate(key)).toBe(true);
      expect(raisesConcern(key)).toBe(true);
    }
  });

  it('gives every reason words a person would recognise', () => {
    for (const reason of DEPARTURE_REASONS) {
      expect(reason.label.length).toBeGreaterThan(10);
      expect(reason.detail.length).toBeGreaterThan(20);
    }
  });
});
