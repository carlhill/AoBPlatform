import {
  assertCeremonySufficient,
  CeremonyError,
  CEREMONY_FRESHNESS_DAYS,
  isValidAhpraNumberFormat,
  type CeremonyContext,
  type CeremonyRecord,
} from './enrolment-ceremony';

const NOW = new Date('2026-08-21T00:00:00Z');

const goodCeremony = (overrides: Partial<CeremonyRecord> = {}): CeremonyRecord => ({
  ahpraNumber: 'MED0001234567',
  ahpraRegistrationCurrent: true,
  providerNumber: '1234567A',
  providerNumberLocation: '1 Example Street, Sampletown NSW 2000',
  providerNumberVerified: true,
  personVerificationMethod: 'video',
  verifiedByName: 'Robin Practicemanager',
  verifiedByStaffId: 'staff-1',
  performedAt: new Date('2026-08-20T00:00:00Z'),
  ...overrides,
});

const firstEnrolment: CeremonyContext = { isReEnrolment: false, now: NOW };

describe('ahpra_number_format_validated (FR-1.11)', () => {
  it('accepts the three-letter, ten-digit shape', () => {
    expect(isValidAhpraNumberFormat('MED0001234567')).toBe(true);
    expect(isValidAhpraNumberFormat('nmw0009876543')).toBe(true); // case-insensitive
  });

  it('rejects malformed numbers', () => {
    for (const bad of ['MED123', '0001234567', 'MEDI0001234567', 'MED00012345678', '']) {
      expect(isValidAhpraNumberFormat(bad)).toBe(false);
    }
  });

  it('does NOT whitelist profession prefixes — an incomplete list would reject real practitioners', () => {
    // Deliberate: shape only. A prefix we have not heard of must still pass.
    expect(isValidAhpraNumberFormat('XYZ0001234567')).toBe(true);
  });
});

describe('ceremony_gates_key_binding (REQ-PKI-01)', () => {
  it('passes a complete, fresh, third-party-attested ceremony', () => {
    expect(() => assertCeremonySufficient(goodCeremony(), firstEnrolment)).not.toThrow();
  });

  it('refuses when AHPRA registration is not verified as current', () => {
    expect(() =>
      assertCeremonySufficient(goodCeremony({ ahpraRegistrationCurrent: false }), firstEnrolment),
    ).toThrow(/CURRENT/);
  });

  it('refuses a malformed AHPRA number', () => {
    expect(() => assertCeremonySufficient(goodCeremony({ ahpraNumber: 'nope' }), firstEnrolment)).toThrow(
      CeremonyError,
    );
  });

  it('refuses a provider number with no location — valid elsewhere proves nothing here', () => {
    expect(() =>
      assertCeremonySufficient(goodCeremony({ providerNumberLocation: '' }), firstEnrolment),
    ).toThrow(/AT A LOCATION/);
  });

  it('refuses an unverified provider number', () => {
    expect(() =>
      assertCeremonySufficient(goodCeremony({ providerNumberVerified: false }), firstEnrolment),
    ).toThrow(/not verified/);
  });

  it('person_verified_by_video_or_in_person_only — email and phone do not prove a person', () => {
    expect(() =>
      assertCeremonySufficient(goodCeremony({ personVerificationMethod: 'video' }), firstEnrolment),
    ).not.toThrow();
    expect(() =>
      assertCeremonySufficient(goodCeremony({ personVerificationMethod: 'in_person' }), firstEnrolment),
    ).not.toThrow();
    for (const weak of ['email', 'phone', 'sms', 'trusted'] as const) {
      expect(() =>
        assertCeremonySufficient(
          goodCeremony({ personVerificationMethod: weak as never }),
          firstEnrolment,
        ),
      ).toThrow(/answered the email proves nothing/);
    }
  });

  it('requires a NAMED human — never an unattributed or system attestation', () => {
    expect(() => assertCeremonySufficient(goodCeremony({ verifiedByName: '' }), firstEnrolment)).toThrow(
      /name the human/,
    );
  });

  it('self_attestation_blocked — a practitioner cannot verify their own enrolment', () => {
    expect(() =>
      assertCeremonySufficient(goodCeremony({ verifiedByStaffId: 'staff-9' }), {
        ...firstEnrolment,
        providerStaffId: 'staff-9',
      }),
    ).toThrow(/cannot attest their own enrolment/);
  });
});

describe('ceremony_must_be_fresh (REQ-PKI-04)', () => {
  it('accepts a ceremony inside the freshness window', () => {
    const performedAt = new Date(NOW.getTime() - (CEREMONY_FRESHNESS_DAYS - 1) * 86_400_000);
    expect(() => assertCeremonySufficient(goodCeremony({ performedAt }), firstEnrolment)).not.toThrow();
  });

  it('refuses a stale ceremony — the practitioner may have been deregistered since', () => {
    const performedAt = new Date(NOW.getTime() - (CEREMONY_FRESHNESS_DAYS + 1) * 86_400_000);
    expect(() => assertCeremonySufficient(goodCeremony({ performedAt }), firstEnrolment)).toThrow(
      /days old/,
    );
  });

  it('refuses a future-dated ceremony', () => {
    const performedAt = new Date(NOW.getTime() + 86_400_000);
    expect(() => assertCeremonySufficient(goodCeremony({ performedAt }), firstEnrolment)).toThrow(
      /future/,
    );
  });
});

describe('re_enrolment_requires_stepped_up_ceremony (REQ-PKI-05)', () => {
  const reEnrolment: CeremonyContext = { isReEnrolment: true, now: NOW };

  it('refuses an ordinary ceremony for a practitioner who already holds a key', () => {
    expect(() => assertCeremonySufficient(goodCeremony(), reEnrolment)).toThrow(/RE-ENROLMENT/);
    expect(() => assertCeremonySufficient(goodCeremony(), reEnrolment)).toThrow(/REQ-PKI-05/);
  });

  it('accepts an explicitly stepped-up ceremony', () => {
    expect(() => assertCeremonySufficient(goodCeremony({ steppedUp: true }), reEnrolment)).not.toThrow();
  });

  it('a stepped-up ceremony still has to pass every other check', () => {
    expect(() =>
      assertCeremonySufficient(
        goodCeremony({ steppedUp: true, ahpraRegistrationCurrent: false }),
        reEnrolment,
      ),
    ).toThrow(/CURRENT/);
  });
});
