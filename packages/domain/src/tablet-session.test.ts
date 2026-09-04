/**
 * The push-to-device contract, asserted where both halves of the product read
 * it from. These are the rules the tablet, the console and the server would
 * otherwise each hold a private opinion about.
 */
import {
  ACTIVE_TABLET_SESSION_STATES,
  CONFIRMABLE_DETAIL_TYPES,
  TABLET_SESSION_IDLE_MS,
  TABLET_SESSION_PATIENT_FIELDS,
  canChangeTabletSessionState,
  isActiveTabletSessionState,
  isConfirmableDetailType,
  isDeviceSettableTabletSessionState,
  projectTabletSessionPatient,
  tabletSessionIsStale,
} from './tablet-session';
import { APPROVED_IDENTIFIER_TYPES } from './identifiers';

describe('the push-to-device session', () => {
  it('session_payload_never_carries_a_medicare_number — there is no field for one', () => {
    const projected = projectTabletSessionPatient({
      givenNames: 'Jamie',
      familyName: 'Sampleton',
      dateOfBirth: '1957-03-14',
      address: '12 Example Street, Sydney NSW 2000',
      mobile: '+61400000001',
      email: 'jamie.sampleton@example.invalid',
      // Everything below is on a real patient row and none of it may travel.
      ihi: '8003600000000000',
      patientRecordNumber: 'PRN-0001',
      confidentialityFlag: false,
      pmsLinkageKey: 'pms-1',
      medicareCard: '0000 00000 0',
    });

    expect(Object.keys(projected).sort()).toEqual([...TABLET_SESSION_PATIENT_FIELDS].sort());
    for (const key of Object.keys(projected)) expect(key).not.toMatch(/medicare/i);
    expect(JSON.stringify(projected)).not.toContain('8003600000000000');
    expect(JSON.stringify(projected)).not.toContain('PRN-0001');
    expect(JSON.stringify(projected)).not.toContain('0000 00000 0');
  });

  it('mobile_and_email_are_confirmable_but_are_not_identifiers — REQ-VER-02, one step sideways', () => {
    // The tick list and the identifier list overlap and are not the same list.
    expect(isConfirmableDetailType('mobile')).toBe(true);
    expect(isConfirmableDetailType('email')).toBe(true);
    expect((APPROVED_IDENTIFIER_TYPES as readonly string[])).not.toContain('mobile');
    expect((APPROVED_IDENTIFIER_TYPES as readonly string[])).not.toContain('email');
    // And the three that ARE identifiers are spelt the same on both sides, so
    // a verification event and a data-accuracy event can never disagree about
    // what "date_of_birth" is called.
    for (const type of ['name', 'date_of_birth', 'address']) {
      expect(CONFIRMABLE_DETAIL_TYPES as readonly string[]).toContain(type);
      expect(APPROVED_IDENTIFIER_TYPES as readonly string[]).toContain(type);
    }
    expect(isConfirmableDetailType('ihi')).toBe(false);
    expect(isConfirmableDetailType('medicare')).toBe(false);
  });

  it('an ended session never moves again — a late poll cannot re-open a recall', () => {
    for (const state of ACTIVE_TABLET_SESSION_STATES) {
      expect(isActiveTabletSessionState(state)).toBe(true);
      expect(canChangeTabletSessionState(state, 'walked_away')).toBe(true);
    }
    for (const ended of ['signed', 'walked_away', 'recalled', 'expired'] as const) {
      expect(isActiveTabletSessionState(ended)).toBe(false);
      expect(canChangeTabletSessionState(ended, 'reading')).toBe(false);
      expect(canChangeTabletSessionState(ended, 'signed')).toBe(false);
    }
    // Asking for the state it is already in is not a change.
    expect(canChangeTabletSessionState('reading', 'reading')).toBe(false);
  });

  it('a device may say it is reading or that somebody walked away, and nothing else', () => {
    expect(isDeviceSettableTabletSessionState('reading')).toBe(true);
    expect(isDeviceSettableTabletSessionState('walked_away')).toBe(true);
    // A device that could declare itself signed could declare a contract.
    expect(isDeviceSettableTabletSessionState('signed')).toBe(false);
    // Recall is a console act, like revoke.
    expect(isDeviceSettableTabletSessionState('recalled')).toBe(false);
    expect(isDeviceSettableTabletSessionState('expired')).toBe(false);
  });

  it('goes stale after thirty idle minutes, and not a moment before', () => {
    const now = new Date('2026-09-04T10:00:00.000Z');
    const fresh = new Date(now.getTime() - TABLET_SESSION_IDLE_MS + 1000);
    const stale = new Date(now.getTime() - TABLET_SESSION_IDLE_MS);
    expect(tabletSessionIsStale(fresh, now)).toBe(false);
    expect(tabletSessionIsStale(stale, now)).toBe(true);
    expect(tabletSessionIsStale(stale.toISOString(), now)).toBe(true);
  });
});
