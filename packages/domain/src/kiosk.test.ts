import {
  KIOSK_CAPTURABLE_STATUSES,
  KIOSK_POLL_MS,
  KIOSK_WAITING_ROW_FIELDS,
  isKioskCapturableStatus,
  kioskPollMs,
  projectKioskWaitingRow,
} from './kiosk';

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
    const row = projectKioskWaitingRow(wholePatientRecord) as Record<string, unknown>;

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
    const row = projectKioskWaitingRow(wholePatientRecord) as Record<string, unknown>;
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
});
