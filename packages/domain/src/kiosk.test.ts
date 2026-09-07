import {
  KIOSK_CAPTURABLE_STATUSES,
  KIOSK_COMMAND_TTL_MS,
  KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS,
  KIOSK_IDLE_TIMEOUT_MAX_SECONDS,
  KIOSK_IDLE_TIMEOUT_MIN_SECONDS,
  KIOSK_POLL_MS,
  KIOSK_SCREENS,
  KIOSK_WAITING_ROW_FIELDS,
  computeSignability,
  isKioskCapturableStatus,
  isKioskIdleTimeoutInRange,
  isKioskScreen,
  kioskCommandIsLive,
  kioskIdleTimeoutOrDefault,
  kioskPollMs,
  kioskScreenIsCeremony,
  projectKioskWaitingRow,
} from './kiosk';
import { isServiceDescription, SERVICE_DESCRIPTIONS } from './service-descriptions';

/**
 * A patient record as the database holds one — everything the kiosk must not
 * put on a screen in a waiting room, plus the two things it must.
 */
const wholePatientRecord = {
  captureRequestId: 'cr-1',
  agreementId: 'ag-1',
  patientId: 'pt-1',
  patientName: 'Robin Reachable',
  providerName: 'Dr Example Provider',
  appointmentDate: '2026-09-03',
  appointmentTime: '09:00',
  agreementStatus: 'verification_pending',
  waitingSince: '2026-09-03T08:00:00.000Z',
  // None of the following may survive the projection.
  dateOfBirth: '1957-03-14',
  gender: 'female',
  address: '12 Example Street, Sydney NSW 2000',
  patientRecordNumber: 'PRN-0001',
  ihi: '8003608166690503',
  medicareNumber: '2950 12345 1',
  mobile: '+61400000001',
  email: 'robin@example.invalid',
};

describe('the kiosk waiting list', () => {
  it('kiosk_waiting_list_carries_no_identifier_values — the projection drops everything but the name', () => {
    const row = projectKioskWaitingRow(wholePatientRecord) as unknown as Record<string, unknown>;

    expect(Object.keys(row).sort()).toEqual([...KIOSK_WAITING_ROW_FIELDS].sort());
    for (const forbidden of [
      'dateOfBirth',
      'gender',
      'address',
      'patientRecordNumber',
      'ihi',
      'mobile',
      'email',
    ]) {
      expect(row).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(row)).not.toContain('1957-03-14');
    expect(JSON.stringify(row)).not.toContain('8003608166690503');

    // The name IS an approved identifier and IS shown: a list that names
    // nobody cannot be used to pick the person standing at the desk.
    expect(row.patientName).toBe('Robin Reachable');
  });

  it('medicare_number_never_reaches_the_kiosk — not even when the source object carries one', () => {
    const row = projectKioskWaitingRow(wholePatientRecord) as unknown as Record<string, unknown>;
    expect(row).not.toHaveProperty('medicareNumber');
    expect(JSON.stringify(row)).not.toContain('2950');
  });

  it('fills a missing optional with null rather than leaving the key off', () => {
    const walkIn = projectKioskWaitingRow({
      captureRequestId: 'cr-2',
      agreementId: 'ag-2',
      patientId: 'pt-2',
      patientName: 'Casey Walkin',
      agreementStatus: 'draft',
      waitingSince: '2026-09-03T08:05:00.000Z',
    });
    expect(walkIn.appointmentDate).toBeNull();
    expect(walkIn.appointmentTime).toBeNull();
    expect(walkIn.providerName).toBeNull();
  });

  it('only lists statuses that are still waiting for the ceremony', () => {
    expect([...KIOSK_CAPTURABLE_STATUSES]).toEqual([
      'draft',
      'verification_pending',
      'verification_failed',
      'awaiting_signature',
    ]);
    expect(isKioskCapturableStatus('signed')).toBe(false);
    expect(isKioskCapturableStatus('stored')).toBe(false);
    expect(isKioskCapturableStatus('declined')).toBe(false);
    expect(isKioskCapturableStatus('awaiting_signature')).toBe(true);
  });

  it('polls fast while somebody is waiting and slowly when nobody is — never not at all', () => {
    expect(kioskPollMs(3)).toBe(KIOSK_POLL_MS.waitingMs);
    expect(kioskPollMs(0)).toBe(KIOSK_POLL_MS.idleMs);
    // The plan's band is 1–2 seconds while an arrival is expected (§9.4).
    expect(KIOSK_POLL_MS.waitingMs).toBeGreaterThanOrEqual(1_000);
    expect(KIOSK_POLL_MS.waitingMs).toBeLessThanOrEqual(2_000);
    // An idle tablet still asks: a walk-in nobody booked is the case the
    // critical lane exists for.
    expect(KIOSK_POLL_MS.idleMs).toBeGreaterThan(0);
  });

  describe('waiting_row_says_whether_it_is_signable — the pairing-day ruling (TODO.md, 4 Sep 2026)', () => {
    it('is unsignable, with a code and no free text, when D6a is missing', () => {
      const result = computeSignability(
        { particularsLockedAt: null, basicServiceDescription: null },
        isServiceDescription,
      );
      expect(result).toEqual({ signable: false, blockedReason: 'service_description_missing' });
    });

    it('is unsignable when D6a is set but does not match the current mapping', () => {
      const result = computeSignability(
        { particularsLockedAt: null, basicServiceDescription: 'Not a real description' },
        isServiceDescription,
      );
      expect(result).toEqual({ signable: false, blockedReason: 'service_description_missing' });
    });

    it('is signable once D6a is set to a description the current mapping actually offers', () => {
      const result = computeSignability(
        { particularsLockedAt: null, basicServiceDescription: SERVICE_DESCRIPTIONS[0] },
        isServiceDescription,
      );
      expect(result).toEqual({ signable: true });
    });

    it('is signable once particulars are already locked, regardless of D6a — the lock already asked the rules engine', () => {
      const result = computeSignability(
        { particularsLockedAt: '2026-09-04T00:00:00.000Z', basicServiceDescription: null },
        isServiceDescription,
      );
      expect(result).toEqual({ signable: true });
    });

    it('never produces a message, only a code — this is what keeps a rules sentence off a waiting-room list', () => {
      const result = computeSignability(
        { particularsLockedAt: null, basicServiceDescription: undefined },
        isServiceDescription,
      );
      expect(result.signable).toBe(false);
      if (!result.signable) {
        expect(['service_description_missing', 'particulars_incomplete', 'other']).toContain(result.blockedReason);
      }
    });
  });
});

/**
 * THE INACTIVITY RESET'S BOUNDS (Carl, 4 September 2026). The interesting half
 * is the fallback: everything the tablet cannot believe answers the DEFAULT,
 * never "no timeout", because the failure mode of an absent setting must be a
 * screen that clears itself rather than one holding an address all afternoon.
 */
describe('the kiosk idle timeout', () => {
  it('defaults to five minutes, and is bounded at a minute and half an hour', () => {
    expect(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS).toBe(300);
    expect(KIOSK_IDLE_TIMEOUT_MIN_SECONDS).toBe(60);
    expect(KIOSK_IDLE_TIMEOUT_MAX_SECONDS).toBe(1_800);
    expect(isKioskIdleTimeoutInRange(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS)).toBe(true);
  });

  it('refuses anything outside the bounds, and anything that is not a whole number of seconds', () => {
    for (const bad of [0, 59, 1_801, 90.5, -300]) {
      expect(isKioskIdleTimeoutInRange(bad)).toBe(false);
    }
    for (const good of [60, 300, 1_800]) {
      expect(isKioskIdleTimeoutInRange(good)).toBe(true);
    }
  });

  it('falls back to the default rather than to no timeout at all', () => {
    for (const unusable of [undefined, null, 'five minutes', 0, 10, 99_999, Number.NaN]) {
      expect(kioskIdleTimeoutOrDefault(unusable)).toBe(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS);
    }
    expect(kioskIdleTimeoutOrDefault(120)).toBe(120);
  });
});

/**
 * WHERE THE TABLET IS — the ten words a heartbeat may carry (Carl, 4–5 Sep
 * 2026; TODO.md "Tablet heartbeat and Return to Begin").
 *
 * THE LIST IS THE GUARD RAIL, not documentation. `POST /kiosk/heartbeat` is
 * made from every screen in the ceremony, including the ones with a person's
 * name, date of birth and address on them; a free-text `screen` would be a
 * field somebody could one day fill with a heading, and the headings on this
 * product's screens are frequently a person's name (REQ-VER-04, hard rule 9).
 */
describe('KIOSK_SCREENS', () => {
  it('is exactly the ten screens the tablet can be on, and holds no identifier type', () => {
    expect([...KIOSK_SCREENS]).toEqual([
      'begin',
      'list',
      'verify',
      'assignor',
      'particulars',
      'signature',
      'check-details',
      'complete',
      'handover',
      'outage',
    ]);
    /*
     * NOT AN IDENTIFIER TYPE AMONG THEM, and least of all a Medicare number.
     * A screen name is a place; the moment one of these reads like a piece of
     * a person, the list has stopped being what it is for (hard rule 1).
     */
    for (const banned of ['name', 'date_of_birth', 'address', 'medicare', 'ihi']) {
      expect(KIOSK_SCREENS as readonly string[]).not.toContain(banned);
    }
  });

  it('accepts only its own words', () => {
    expect(isKioskScreen('verify')).toBe(true);
    expect(isKioskScreen('Jamie Sampleton — check your details')).toBe(false);
    expect(isKioskScreen('date_of_birth')).toBe(false);
    expect(isKioskScreen(undefined)).toBe(false);
  });

  it('knows which screens have somebody standing at them', () => {
    // Begin and the test device's list are the between-patients screens; every
    // other one is what turns "seen 4 s ago" into "walk-up in progress".
    expect(kioskScreenIsCeremony('begin')).toBe(false);
    expect(kioskScreenIsCeremony('list')).toBe(false);
    expect(kioskScreenIsCeremony('verify')).toBe(true);
    expect(kioskScreenIsCeremony('signature')).toBe(true);
  });
});

/**
 * TWO MINUTES, AND THEN THE COMMAND IS DROPPED (Carl, 4 Sep 2026).
 *
 * "Return to Begin" is pressed by somebody standing next to the tablet who
 * wants it back now. A tablet that was asleep, off, or off the wifi at that
 * moment must not wake up tomorrow morning and clear the screen of tomorrow's
 * patient. Reception presses it again; that costs one tap and no surprise.
 */
describe('kioskCommandIsLive', () => {
  const now = new Date('2026-09-05T09:00:00.000Z');

  it('is live inside two minutes and dead outside them', () => {
    expect(kioskCommandIsLive(new Date(now.getTime() - 1_000), now)).toBe(true);
    expect(kioskCommandIsLive(new Date(now.getTime() - KIOSK_COMMAND_TTL_MS + 1), now)).toBe(true);
    expect(kioskCommandIsLive(new Date(now.getTime() - KIOSK_COMMAND_TTL_MS - 1), now)).toBe(false);
  });

  it('treats an unreadable timestamp as dead — fail closed on a command that clears a screen', () => {
    expect(kioskCommandIsLive('not a date', now)).toBe(false);
  });
});
