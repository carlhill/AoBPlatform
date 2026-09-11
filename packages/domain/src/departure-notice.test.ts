import {
  DepartureNoticeError,
  EXTERNAL_NOTICE_KEYS,
  EXTERNAL_NOTICE_MEANS,
  assessDeparture,
  businessDaysBetween,
  externalNoticeMeans,
  needsExternalAttestation,
} from './departure-notice';
import type { BusinessDayCalendar } from './enduring';

/** No public holidays, so only weekends matter. Enough for the rule itself. */
const CAL: BusinessDayCalendar = { publicHolidays: new Set<string>(), state: 'NSW' };

/** A calendar with one holiday, to prove holidays are actually consulted. */
const CAL_WITH_HOLIDAY: BusinessDayCalendar = {
  publicHolidays: new Set(['2026-08-25']),
  state: 'NSW',
};

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('the catalogue', () => {
  it('has no duplicate keys and states limits for every means', () => {
    expect(new Set(EXTERNAL_NOTICE_KEYS).size).toBe(EXTERNAL_NOTICE_KEYS.length);
    for (const m of EXTERNAL_NOTICE_MEANS) {
      expect(m.establishes.trim().length).toBeGreaterThan(0);
      expect(m.limits.trim().length).toBeGreaterThan(0);
    }
  });

  it('rates a conversation below a written agreement', () => {
    // "They say they told them" is not the same evidence as a signed term,
    // and the ordering has to say so or it means nothing.
    expect(externalNoticeMeans('in_person')?.strength).toBe('WEAK');
    expect(externalNoticeMeans('employment_agreement')?.strength).toBe('STRONG');
  });
});

describe('businessDaysBetween', () => {
  it('skips weekends', () => {
    // Fri 21 Aug 2026 -> Mon 24 Aug 2026 is ONE business day, not three.
    expect(businessDaysBetween(d('2026-08-21'), d('2026-08-24'), CAL)).toBe(1);
  });

  it('consults the public-holiday calendar', () => {
    // Same span, but with Tue 25 Aug a holiday, Fri -> Wed 26 is 2 not 3.
    expect(businessDaysBetween(d('2026-08-21'), d('2026-08-26'), CAL)).toBe(3);
    expect(businessDaysBetween(d('2026-08-21'), d('2026-08-26'), CAL_WITH_HOLIDAY)).toBe(2);
  });

  it('goes negative when notice came after the departure', () => {
    expect(businessDaysBetween(d('2026-08-26'), d('2026-08-24'), CAL)).toBe(-2);
  });

  it('is zero for the same day', () => {
    expect(businessDaysBetween(d('2026-08-24'), d('2026-08-24'), CAL)).toBe(0);
  });
});

describe('a departure still in the future', () => {
  it('is ordinary platform notice when there is enough lead', () => {
    const result = assessDeparture({ now: d('2026-08-24'), endsAt: d('2026-08-28'), calendar: CAL });
    expect(result.basis).toBe('platform');
    expect(result.sufficientLead).toBe(true);
    expect(result.anomaly).toBeUndefined();
  });

  it('is RECORDED, not refused, when the lead is short', () => {
    /*
     * A practice giving one day's notice has a commercial problem, not a
     * recording problem. Refusing would leave the platform wrong about who
     * works where, which is worse than a flagged record.
     */
    const result = assessDeparture({ now: d('2026-08-24'), endsAt: d('2026-08-25'), calendar: CAL });
    expect(result.basis).toBe('platform');
    expect(result.sufficientLead).toBe(false);
    expect(result.anomaly).toMatch(/short of the 2/);
  });
});

describe('a departure recorded on the day it happens', () => {
  it('SAME DAY IS NOT THE PAST, and needs no attestation', () => {
    /*
     * The case that broke in front of Carl. A date input arrives as midnight;
     * `now` is whatever time of day it is. Compared as instants, "their last
     * day is today" recorded at 3:32pm looks like backdating. Compared as
     * days, which is what the rule is about, it is Tuesday.
     *
     * The domain always got this right; the DATABASE CONSTRAINT did not, and
     * the constraint won at runtime as a 500. Both compare dates now.
     */
    const now = new Date('2026-08-22T15:32:00Z');
    const endsAt = new Date('2026-08-22T00:00:00Z');
    expect(needsExternalAttestation({ now, endsAt })).toBe(false);

    const result = assessDeparture({ now, endsAt, calendar: CAL });
    expect(result.basis).toBe('platform');
    // Zero days notice is an anomaly worth naming, not a refusal.
    expect(result.leadBusinessDays).toBe(0);
    expect(result.sufficientLead).toBe(false);
    expect(result.anomaly).toMatch(/short of the 2/);
  });
});

describe('a departure that already happened', () => {
  it('IS REFUSED WITH NO ATTESTATION, and says what to do instead', () => {
    /*
     * The old behaviour, kept — but only for the case where recording it would
     * actually be false. Without an attestation we would be asserting that we
     * gave notice before a date that has passed, and nothing in the record
     * would say otherwise.
     */
    expect(() => assessDeparture({ now: d('2026-08-22'), endsAt: d('2026-08-19'), calendar: CAL })).toThrow(
      DepartureNoticeError,
    );
    expect(() => assessDeparture({ now: d('2026-08-22'), endsAt: d('2026-08-19'), calendar: CAL })).toThrow(
      /outside the platform/,
    );
  });

  it('IS RECORDED when notice is attested as given elsewhere', () => {
    // Carl's case exactly: left on the 19th, recorded on the 22nd, told in
    // advance by their employment agreement.
    const result = assessDeparture({
      now: d('2026-08-22'),
      endsAt: d('2026-08-19'),
      calendar: CAL,
      external: { means: 'employment_agreement', givenAt: d('2026-07-01') },
    });
    expect(result.basis).toBe('external_attested');
    expect(result.sufficientLead).toBe(true);
    expect(result.anomaly).toBeUndefined();
    // And the cessation date is the DEPARTURE, not the recording.
    expect(result.agreementsCeasedOn.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  it('NEVER MOVES THE CESSATION DATE, whatever is attested', () => {
    /*
     * The point the old refusal was right about. Recording something on the
     * 22nd does not mean the agreements survived until the 22nd — they ceased
     * when the practitioner left, and this must never imply otherwise.
     */
    const result = assessDeparture({
      now: d('2026-09-30'),
      endsAt: d('2026-08-19'),
      calendar: CAL,
      external: { means: 'letter', givenAt: d('2026-08-01') },
    });
    expect(result.agreementsCeasedOn.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  it('flags an attested notice that itself came after the departure', () => {
    // Recorded, because the departure is a fact — but the record says plainly
    // that nobody was told in advance.
    const result = assessDeparture({
      now: d('2026-08-30'),
      endsAt: d('2026-08-19'),
      calendar: CAL,
      external: { means: 'in_person', givenAt: d('2026-08-24') },
    });
    expect(result.basis).toBe('external_attested');
    expect(result.leadBusinessDays).toBeLessThan(0);
    expect(result.anomaly).toMatch(/dated AFTER/);
  });

  it('flags an attested notice that was too short', () => {
    const result = assessDeparture({
      now: d('2026-08-22'),
      endsAt: d('2026-08-19'),
      calendar: CAL,
      external: { means: 'email_outside_platform', givenAt: d('2026-08-18') },
    });
    expect(result.sufficientLead).toBe(false);
    expect(result.anomaly).toMatch(/short of the 2/);
  });

  it('refuses a means that is not in the catalogue', () => {
    expect(() =>
      assessDeparture({
        now: d('2026-08-22'),
        endsAt: d('2026-08-19'),
        calendar: CAL,
        external: { means: 'i_just_know', givenAt: d('2026-08-01') },
      }),
    ).toThrow(/not a way notice can have been given/);
  });

  it('refuses "other" with no note', () => {
    expect(() =>
      assessDeparture({
        now: d('2026-08-22'),
        endsAt: d('2026-08-19'),
        calendar: CAL,
        external: { means: 'other', givenAt: d('2026-08-01') },
      }),
    ).toThrow(/the note is the record/);
  });
});

describe('needsExternalAttestation', () => {
  it('asks only when the date has already passed', () => {
    expect(needsExternalAttestation({ now: d('2026-08-22'), endsAt: d('2026-08-19') })).toBe(true);
    expect(needsExternalAttestation({ now: d('2026-08-22'), endsAt: d('2026-08-22') })).toBe(false);
    expect(needsExternalAttestation({ now: d('2026-08-22'), endsAt: d('2026-08-28') })).toBe(false);
  });
});
