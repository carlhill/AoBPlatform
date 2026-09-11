import {
  AffiliationError,
  assertNoticeValid,
  assertAffiliationTransition,
  canCaptureUnder,
  canAffiliationTransition,
  captureBlockReason,
  deregistrationTakesEffect,
  endOfAffiliationEffects,
  isAffiliationVelocityAnomalous,
  noticeDays,
  type Affiliation,
} from './affiliation';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-01T09:00:00Z');

const affiliation = (over: Partial<Affiliation> = {}): Affiliation => ({
  status: 'active',
  providerNumber: '1234567A',
  startedAt: at('2026-01-01T00:00:00Z'),
  ...over,
});

describe('affiliation transitions', () => {
  it('invited goes to active on acceptance, or rejected on refusal', () => {
    expect(canAffiliationTransition('invited', 'active')).toBe(true);
    expect(canAffiliationTransition('invited', 'rejected')).toBe(true);
  });

  it('an invitation cannot skip straight to ending', () => {
    expect(canAffiliationTransition('invited', 'ending')).toBe(false);
    expect(() => assertAffiliationTransition('invited', 'ending')).toThrow(AffiliationError);
  });

  it('ended and rejected are terminal — nothing reopens them', () => {
    for (const to of ['active', 'ending', 'invited', 'rejected'] as const) {
      expect(canAffiliationTransition('ended', to)).toBe(false);
    }
    expect(canAffiliationTransition('rejected', 'active')).toBe(false);
  });

  it('notice can be withdrawn while it is still running', () => {
    expect(canAffiliationTransition('ending', 'active')).toBe(true);
  });
});

describe('capture during the notice period', () => {
  it('active affiliations capture', () => {
    expect(canCaptureUnder(affiliation(), NOW)).toBe(true);
  });

  it('ENDING STILL CAPTURES — notice runs before the end date, not after', () => {
    const ending = affiliation({
      status: 'ending',
      noticeGivenAt: at('2026-08-25T00:00:00Z'),
      endsAt: at('2026-09-10T00:00:00Z'),
    });
    expect(canCaptureUnder(ending, NOW)).toBe(true);
    expect(captureBlockReason(ending, NOW)).toBeNull();
  });

  it('stops at the end date, and says agreements CEASED rather than "blocked"', () => {
    const past = affiliation({ status: 'ending', endsAt: at('2026-08-30T00:00:00Z') });
    expect(canCaptureUnder(past, NOW)).toBe(false);
    expect(captureBlockReason(past, NOW)).toMatch(/CEASED/);
    expect(captureBlockReason(past, NOW)).toMatch(/65CA\(8\)/);
  });

  it('an unaccepted invitation captures nothing', () => {
    const invited = affiliation({ status: 'invited', startedAt: null });
    expect(canCaptureUnder(invited, NOW)).toBe(false);
    expect(captureBlockReason(invited, NOW)).toMatch(/not yet accepted/);
  });

  it('a rejected invitation captures nothing', () => {
    expect(canCaptureUnder(affiliation({ status: 'rejected' }), NOW)).toBe(false);
  });

  it('deregistration_is_an_immediate_hard_stop — it outranks an active status', () => {
    const deregistered = affiliation({ deregisteredAt: at('2026-08-31T00:00:00Z') });
    expect(deregistered.status).toBe('active');
    expect(canCaptureUnder(deregistered, NOW)).toBe(false);
    expect(captureBlockReason(deregistered, NOW)).toMatch(/REQ-XFER-08/);
    expect(captureBlockReason(deregistered, NOW)).toMatch(/no notice period/);
  });

  it('and it outranks a notice period that has not yet run out', () => {
    const both = affiliation({
      status: 'ending',
      endsAt: at('2026-12-01T00:00:00Z'),
      deregisteredAt: at('2026-08-31T00:00:00Z'),
    });
    expect(canCaptureUnder(both, NOW)).toBe(false);
  });

  it('deregistration takes effect the moment we learn, not when the practice tells us', () => {
    expect(deregistrationTakesEffect(NOW)).toEqual(NOW);
  });
});

describe('notice must precede the end date', () => {
  it('accepts an ordinary ten-business-day commercial notice', () => {
    const notice = { noticeGivenAt: at('2026-09-01T00:00:00Z'), endsAt: at('2026-09-15T00:00:00Z') };
    expect(() => assertNoticeValid(notice)).not.toThrow();
    expect(noticeDays(notice)).toBe(14);
  });

  it('accepts same-day notice — short, but not backwards', () => {
    expect(() =>
      assertNoticeValid({ noticeGivenAt: at('2026-09-01T00:00:00Z'), endsAt: at('2026-09-01T00:00:00Z') }),
    ).not.toThrow();
  });

  it('NO_COOL_OFF_AFTER_DEPARTURE — an end date before the notice is refused', () => {
    expect(() =>
      assertNoticeValid({ noticeGivenAt: at('2026-09-11T00:00:00Z'), endsAt: at('2026-09-01T00:00:00Z') }),
    ).toThrow(/BEFORE the affiliation ends/);
  });

  it('and explains why backdating does not help', () => {
    try {
      assertNoticeValid({ noticeGivenAt: at('2026-09-11T00:00:00Z'), endsAt: at('2026-09-01T00:00:00Z') });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/un-cease/);
    }
  });
});

describe('what ending an affiliation actually does', () => {
  const effects = endOfAffiliationEffects();

  it('ceases enduring agreements under 65CA(8)', () => {
    expect(effects.enduringAgreementsCease).toBe(true);
    expect(effects.cessationReason).toBe('practitioner_left_location');
  });

  it('leaves claims for services rendered BEFORE the end date valid', () => {
    expect(effects.priorClaimsRemainValid).toBe(true);
  });

  it('retains the evidence — ceasing is not deleting (REQ-OFF-07)', () => {
    expect(effects.evidenceRetained).toBe(true);
  });
});

describe('no cap on affiliations, velocity is a signal', () => {
  it('does not flag a practitioner who simply works at many practices', () => {
    expect(
      isAffiliationVelocityAnomalous({ activeCount: 12, addedInLastDays: 0, windowDays: 7 }),
    ).toBe(false);
  });

  it('flags a sudden burst', () => {
    expect(
      isAffiliationVelocityAnomalous({ activeCount: 30, addedInLastDays: 28, windowDays: 7 }),
    ).toBe(true);
  });

  it('is a signal, not a block — nothing here refuses capture', () => {
    const busy = affiliation();
    expect(canCaptureUnder(busy, NOW)).toBe(true);
  });
});

describe('the last day is a whole day', () => {
  it('CAPTURE RUNS TO THE END OF THE LAST DAY, not to its midnight', () => {
    /*
     * Found on screen: a card said both "capture continues until then" and
     * "this affiliation has ended", on the morning of the end date.
     *
     * A date input arrives as midnight. Comparing endsAt > now meant capture
     * was blocked from 00:00 on somebody’s LAST WORKING DAY — a full day
     * early — so agreements that should have been captured were refused.
     */
    const endsAt = new Date('2026-08-22T00:00:00Z');
    const affiliation = { status: 'ending', endsAt } as never;

    expect(canCaptureUnder(affiliation, new Date('2026-08-22T00:00:01Z'))).toBe(true);
    expect(canCaptureUnder(affiliation, new Date('2026-08-22T15:32:00Z'))).toBe(true);
    expect(canCaptureUnder(affiliation, new Date('2026-08-22T23:59:00Z'))).toBe(true);
    // And stops once the day is over.
    expect(canCaptureUnder(affiliation, new Date('2026-08-23T00:00:01Z'))).toBe(false);
  });

  it('gives no block reason while the last day is still running', () => {
    // The two halves must agree. They did not, which is the bug.
    const affiliation = { status: 'ending', endsAt: new Date('2026-08-22T00:00:00Z') } as never;
    expect(captureBlockReason(affiliation, new Date('2026-08-22T15:32:00Z'))).toBeNull();
  });
});
