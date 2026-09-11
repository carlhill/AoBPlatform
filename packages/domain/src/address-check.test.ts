import {
  ADDRESS_CHECK_KEYS,
  ADDRESS_CHECK_METHODS,
  ADDRESS_REJECTION_KEYS,
  ADDRESS_REJECTION_REASONS,
  AddressCheckError,
  addressCheckMethod,
  addressRejectionReason,
  assertRecordableCheck,
  assertSendableRejection,
  locationEditability,
} from './address-check';

describe('address check catalogue', () => {
  it('has no duplicate keys', () => {
    expect(new Set(ADDRESS_CHECK_KEYS).size).toBe(ADDRESS_CHECK_KEYS.length);
    expect(new Set(ADDRESS_REJECTION_KEYS).size).toBe(ADDRESS_REJECTION_KEYS.length);
  });

  it('states the LIMITS of every method, not just what it proves', () => {
    // The half people skip. A catalogue that only says what a check
    // establishes teaches reviewers to over-read their own evidence.
    for (const method of ADDRESS_CHECK_METHODS) {
      expect(method.establishes.trim().length).toBeGreaterThan(0);
      expect(method.limits.trim().length).toBeGreaterThan(0);
    }
  });

  it('tells the PRACTICE what to do for every rejection reason', () => {
    // A reason the practice cannot act on is a dead end that generates a
    // phone call, which is the thing this whole loop exists to avoid.
    for (const reason of ADDRESS_REJECTION_REASONS) {
      expect(reason.practiceGuidance.trim().length).toBeGreaterThan(0);
    }
  });

  it('looks methods and reasons up by key, and answers undefined for anything else', () => {
    expect(addressCheckMethod('site_visit')?.strength).toBe('STRONG');
    expect(addressCheckMethod('nonsense')).toBeUndefined();
    expect(addressRejectionReason('address_incomplete')?.requiresDetail).toBe(false);
    expect(addressRejectionReason('nonsense')).toBeUndefined();
  });

  it('rates practice-produced evidence below independent evidence', () => {
    // Letterhead is produced entirely by the claimant. If it ever rates as
    // highly as a site visit, the ordering has lost its meaning.
    expect(addressCheckMethod('practice_letterhead')?.strength).toBe('WEAK');
    expect(addressCheckMethod('site_visit')?.strength).toBe('STRONG');
  });
});

describe('assertRecordableCheck', () => {
  it('accepts a method that needs no document', () => {
    expect(assertRecordableCheck({ method: 'site_visit' }).key).toBe('site_visit');
  });

  it('REFUSES A DOCUMENT CHECK WITH NO DOCUMENT', () => {
    /*
     * The important one. Recording "matched against a government register"
     * with nothing attached does not produce a weaker check — it produces a
     * record that reads, for ever, as though a document was examined when
     * none was. That is worse than no check, because it invites reliance.
     */
    expect(() => assertRecordableCheck({ method: 'government_register' })).toThrow(AddressCheckError);
    expect(() => assertRecordableCheck({ method: 'government_register' })).toThrow(/document has to be attached/);
    expect(() =>
      assertRecordableCheck({ method: 'government_register', artefactId: 'a-real-id' }),
    ).not.toThrow();
  });

  it('refuses "other" with no note, because the note IS the record', () => {
    expect(() => assertRecordableCheck({ method: 'other' })).toThrow(/note IS the record/);
    expect(() => assertRecordableCheck({ method: 'other', note: '   ' })).toThrow(AddressCheckError);
    expect(() => assertRecordableCheck({ method: 'other', note: 'Rang the landlord.' })).not.toThrow();
  });

  it('refuses a method that is not in the catalogue, and says what is', () => {
    expect(() => assertRecordableCheck({ method: 'vibes' })).toThrow(/not an address check method/);
    expect(() => assertRecordableCheck({ method: 'vibes' })).toThrow(/site_visit/);
  });
});

describe('assertSendableRejection', () => {
  it('accepts a reason that stands on its own', () => {
    expect(assertSendableRejection({ reason: 'address_incomplete' }).key).toBe('address_incomplete');
  });

  it('refuses a reason the practice could not act on without detail', () => {
    // "Our evidence shows a different address" — without saying what we found,
    // the practice cannot tell what to change.
    expect(() => assertSendableRejection({ reason: 'evidence_inconsistent' })).toThrow(/what we found/);
    expect(() =>
      assertSendableRejection({ reason: 'evidence_inconsistent', detail: 'ASIC shows 12 Other St.' }),
    ).not.toThrow();
  });

  it('refuses an unknown reason', () => {
    expect(() => assertSendableRejection({ reason: 'because' })).toThrow(AddressCheckError);
  });
});

describe('locationEditability', () => {
  it('lets the practice edit an address nobody has confirmed', () => {
    expect(locationEditability({ addressValidated: false })).toEqual({
      mayEdit: true,
      awaitingCorrection: false,
    });
  });

  it('STOPS EDITING ONCE CONFIRMED', () => {
    /*
     * The rule this module exists for. After confirmation the address may
     * already be printed on captured agreements, so a silent edit would
     * invalidate the check while leaving the confirmation record standing —
     * an address nobody checked, wearing a confirmation.
     */
    const result = locationEditability({ addressValidated: true, active: true });
    expect(result.mayEdit).toBe(false);
    expect(result.reason).toMatch(/confirmed/i);
    expect(result.awaitingCorrection).toBe(false);
  });

  it('flags a rejected address as awaiting correction, and still editable', () => {
    const result = locationEditability({
      addressValidated: false,
      addressRejectedAt: new Date('2026-08-22T00:00:00Z'),
    });
    expect(result.mayEdit).toBe(true);
    expect(result.awaitingCorrection).toBe(true);
  });

  it('does not call a CONFIRMED address awaiting correction, even if it was once rejected', () => {
    // A rejection that was answered and then confirmed is history, not a
    // standing request. Showing "please correct this" under a confirmed
    // address would send the practice chasing a resolved problem.
    const result = locationEditability({
      addressValidated: true,
      addressRejectedAt: new Date('2026-08-01T00:00:00Z'),
    });
    expect(result.awaitingCorrection).toBe(false);
    expect(result.mayEdit).toBe(false);
  });
});
