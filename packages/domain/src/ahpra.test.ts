import {
  AhpraError,
  assertRegistrationPermitsPractice,
  assertSightingAttributable,
  hasRestriction,
  registrationWarnings,
  type AhpraRecord,
} from './ahpra';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-08-21T00:00:00Z');

// Shaped on a real register record, with an invented practitioner.
const record = (over: Partial<AhpraRecord> = {}): AhpraRecord => ({
  registrationNumber: 'MED0009999999',
  familyName: 'Example',
  givenNames: 'Jo',
  profession: 'Medical Practitioner',
  division: 'General',
  registrationStatus: 'Registered',
  conditions: 'None',
  undertakings: 'None',
  reprimands: 'None',
  dateOfFirstRegistration: at('1991-11-25T00:00:00Z'),
  registrationTypes: [
    { registrationType: 'General', expiryDate: at('2027-09-30T00:00:00Z'), conditions: 'None' },
    {
      registrationType: 'Specialist',
      specialty: 'General practice',
      expiryDate: at('2027-09-30T00:00:00Z'),
      conditions: 'None',
    },
  ],
  principalSuburb: 'YAGOONA',
  principalState: 'NSW',
  principalPostcode: '2199',
  principalCountry: 'Australia',
  ...over,
});

describe('registration status is the only blocking check', () => {
  it('permits a Registered practitioner', () => {
    expect(() => assertRegistrationPermitsPractice(record())).not.toThrow();
  });

  for (const status of ['Suspended', 'Cancelled', 'Surrendered', 'Lapsed', 'Not currently registered']) {
    it(`refuses ${status}, and says the stop is immediate`, () => {
      expect(() => assertRegistrationPermitsPractice(record({ registrationStatus: status }))).toThrow(
        /no notice period/,
      );
    });
  }

  it('treats an UNRECOGNISED status as not-registered rather than waving it through', () => {
    expect(() => assertRegistrationPermitsPractice(record({ registrationStatus: 'Something New' }))).toThrow(
      /never read as permission/,
    );
  });

  it('refuses when no status was recorded at all', () => {
    expect(() => assertRegistrationPermitsPractice(record({ registrationStatus: '' }))).toThrow(AhpraError);
  });
});

describe('a past expiry date is a warning, NEVER a block', () => {
  const expired = record({
    registrationTypes: [{ registrationType: 'General', expiryDate: at('2026-06-30T00:00:00Z'), conditions: 'None' }],
  });

  it('still permits practice — AHPRA says they may still be practising', () => {
    expect(() => assertRegistrationPermitsPractice(expired)).not.toThrow();
  });

  it('warns, and explains why it is not a refusal', () => {
    const warnings = registrationWarnings(expired, { now: NOW });
    const expiry = warnings.find((w) => w.code === 'expiry_passed');
    expect(expiry).toBeDefined();
    expect(expiry!.message).toMatch(/NOT A BLOCK/);
    expect(expiry!.message).toMatch(/late period/);
  });

  it('names which registration types have passed, not just that one has', () => {
    const mixed = record({
      registrationTypes: [
        { registrationType: 'General', expiryDate: at('2027-09-30T00:00:00Z') },
        { registrationType: 'Specialist', specialty: 'General practice', expiryDate: at('2026-01-01T00:00:00Z') },
      ],
    });
    const warning = registrationWarnings(mixed, { now: NOW }).find((w) => w.code === 'expiry_passed');
    expect(warning!.message).toContain('Specialist');
    expect(warning!.message).not.toContain('General,');
  });

  it('says nothing when every type is current', () => {
    expect(registrationWarnings(record(), { now: NOW }).some((w) => w.code === 'expiry_passed')).toBe(false);
  });
});

describe('restrictions are surfaced, because they are easy to skim past', () => {
  it('reads "None" as no restriction', () => {
    expect(hasRestriction('None')).toBe(false);
    expect(hasRestriction('  none  ')).toBe(false);
    expect(hasRestriction('')).toBe(false);
    expect(hasRestriction(null)).toBe(false);
  });

  it('reads any real text as a restriction', () => {
    expect(hasRestriction('Must not prescribe schedule 8 medicines')).toBe(true);
  });

  it('warns on practitioner-level conditions', () => {
    const w = registrationWarnings(record({ conditions: 'Supervised practice required' }), { now: NOW });
    expect(w.find((x) => x.code === 'conditions')!.message).toMatch(/fully registered and still restricted/);
  });

  it('warns on conditions attached to ONE registration type', () => {
    const w = registrationWarnings(
      record({
        registrationTypes: [{ registrationType: 'General', conditions: 'No solo practice', expiryDate: at('2027-09-30T00:00:00Z') }],
      }),
      { now: NOW },
    );
    expect(w.some((x) => x.code === 'conditions')).toBe(true);
  });

  it('warns on undertakings and reprimands separately', () => {
    const w = registrationWarnings(record({ undertakings: 'Agreed not to practise', reprimands: 'Reprimanded 2024' }), {
      now: NOW,
    });
    expect(w.some((x) => x.code === 'undertakings')).toBe(true);
    expect(w.some((x) => x.code === 'reprimands')).toBe(true);
  });

  it('none of them block', () => {
    const restricted = record({ conditions: 'Supervised practice required', reprimands: 'Reprimanded 2024' });
    expect(() => assertRegistrationPermitsPractice(restricted)).not.toThrow();
  });
});

describe('a sighting goes stale', () => {
  it('warns once the register has not been looked at for a while', () => {
    const w = registrationWarnings(record(), { now: NOW, sightedAt: at('2026-01-01T00:00:00Z') });
    expect(w.find((x) => x.code === 'stale_check')!.message).toMatch(/lapse or be suspended/);
  });

  it('says nothing about a recent sighting', () => {
    const w = registrationWarnings(record(), { now: NOW, sightedAt: at('2026-08-01T00:00:00Z') });
    expect(w.some((x) => x.code === 'stale_check')).toBe(false);
  });
});

describe('a manual sighting must name somebody', () => {
  it('refuses an unattributed manual check', () => {
    expect(() => assertSightingAttributable('ahpra_manual', '')).toThrow(/is not a check/);
  });

  it('accepts a named one', () => {
    expect(() => assertSightingAttributable('ahpra_manual', 'Carl Hill')).not.toThrow();
  });

  it('does not demand a name of the PIE API — it is not a person', () => {
    expect(() => assertSightingAttributable('pie_api', null)).not.toThrow();
  });

  it('rejects an unknown source', () => {
    expect(() => assertSightingAttributable('vibes', 'Carl Hill')).toThrow(AhpraError);
  });
});

describe('what the register does NOT contain', () => {
  it('has no field capable of carrying a street address, email or phone', () => {
    // The register publishes suburb + postcode only. If a future change adds a
    // street address here, it did not come from AHPRA — and this fails.
    const keys = Object.keys(record()).join(' ').toLowerCase();
    for (const forbidden of ['street', 'email', 'phone', 'mobile']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('has no notion of a practice — AHPRA registers individuals only', () => {
    const keys = Object.keys(record()).join(' ').toLowerCase();
    expect(keys).not.toContain('practicename');
    expect(keys).not.toContain('abn');
  });
});
