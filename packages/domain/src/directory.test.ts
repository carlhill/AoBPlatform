import {
  DirectoryError,
  assertDirectoryQueryAllowed,
  assertNoProviderNumber,
  toDirectoryEntry,
  toRosterEntry,
  type PractitionerRecord,
} from './directory';

const practitioner: PractitionerRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  familyName: 'Example',
  givenNames: 'Jo',
  ahpraNumber: 'MED0001234567',
  providerType: 'general_practitioner',
  email: 'jo.example@example.invalid',
  verifiedAt: new Date('2026-08-01T00:00:00Z'),
  // The kind of column that gets added later and leaks through a spread.
  providerNumber: '1234567A',
  homeAddress: '1 Example Street, Sampletown NSW 2000',
};

describe('the directory projection', () => {
  const entry = toDirectoryEntry(practitioner);

  it('carries the AHPRA number, which is already public', () => {
    expect(entry.ahpraNumber).toBe('MED0001234567');
  });

  it('NEVER_CARRIES_THE_PROVIDER_NUMBER', () => {
    expect(JSON.stringify(entry)).not.toContain('1234567A');
    expect(entry as Record<string, unknown>).not.toHaveProperty('providerNumber');
  });

  it('does not leak contact details or address either', () => {
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('example.invalid');
    expect(serialised).not.toContain('Example Street');
  });

  it('exposes only that a ceremony happened, not who attested it', () => {
    expect(entry.verified).toBe(true);
    expect(entry as Record<string, unknown>).not.toHaveProperty('verifiedAt');
  });

  it('reports an unverified practitioner as unverified rather than omitting them', () => {
    expect(toDirectoryEntry({ ...practitioner, verifiedAt: null }).verified).toBe(false);
  });

  it('is built field-by-field, so a new column cannot ride along', () => {
    expect(Object.keys(toDirectoryEntry(practitioner)).sort()).toEqual([
      'ahpraNumber',
      'familyName',
      'givenNames',
      'practitionerId',
      'providerType',
      'verified',
    ]);
  });
});

describe('directory search is AHPRA-number-only', () => {
  it('accepts a well-formed AHPRA number and normalises it', () => {
    expect(assertDirectoryQueryAllowed(' med0001234567 ')).toBe('MED0001234567');
  });

  it('NO_NAME_BROWSE — a name search is refused', () => {
    expect(() => assertDirectoryQueryAllowed('Smith')).toThrow(DirectoryError);
    expect(() => assertDirectoryQueryAllowed('Smith')).toThrow(/AHPRA registration number only/);
  });

  it('refuses a wildcard or partial number', () => {
    for (const bad of ['MED*', 'MED000', '', '   ', 'MED00012345678']) {
      expect(() => assertDirectoryQueryAllowed(bad)).toThrow(DirectoryError);
    }
  });

  it('tells the operator how to get the number legitimately', () => {
    expect(() => assertDirectoryQueryAllowed('Smith')).toThrow(/registration certificate/);
  });
});

describe('the boundary guard', () => {
  it('catches a provider number in an outbound payload', () => {
    expect(() => assertNoProviderNumber({ providerNumber: '1234567A' }, 'directory response')).toThrow(
      /never cross a practice boundary/,
    );
  });

  it('catches the snake_case spelling too', () => {
    expect(() => assertNoProviderNumber({ provider_number: '1234567A' }, 'x')).toThrow(DirectoryError);
  });

  it('catches one buried in a nested list', () => {
    expect(() =>
      assertNoProviderNumber({ results: [{ ok: true }, { nested: { providerNumber: 'X' } }] }, 'x'),
    ).toThrow(DirectoryError);
  });

  it('passes a clean directory entry', () => {
    expect(() => assertNoProviderNumber(toDirectoryEntry(practitioner), 'directory response')).not.toThrow();
  });

  it('handles null and undefined without throwing', () => {
    expect(() => assertNoProviderNumber(null, 'x')).not.toThrow();
    expect(() => assertNoProviderNumber(undefined, 'x')).not.toThrow();
  });
});

describe('toRosterEntry', () => {
  const practitioner = {
    id: 'p1',
    familyName: 'Nguyen',
    givenNames: 'Mai',
    ahpraNumber: 'MED0001234567',
    providerType: 'general_practitioner',
    email: 'mai@example.com',
    invitedByPracticeId: 'practice-a',
    verifiedAt: null,
    registrationStatus: 'Registered',
    profession: 'Medical Practitioner',
    division: null,
    conditions: null,
    registrationSightedByName: 'A Reviewer',
    registrationSightedAt: new Date('2026-01-05T00:00:00Z'),
    registrationSource: 'ahpra_manual',
    deregisteredAt: null,
    /** A column that must never appear in the projection. */
    providerNumber: '1234567A',
  };

  it('gives the practice that created the record the email it typed in', () => {
    const entry = toRosterEntry(practitioner, 'practice-a');
    expect(entry.invitedByThisPractice).toBe(true);
    expect(entry.email).toBe('mai@example.com');
    expect(entry.hasEmail).toBe(true);
  });

  /*
   * The load-bearing case. A practitioner's address is theirs, not a shared
   * contact record — and a second practice does not need it, because
   * invitations are sent by us and inviting is keyed on the AHPRA number.
   */
  it('WITHHOLDS the email from a practice that did not supply it', () => {
    const entry = toRosterEntry(practitioner, 'practice-b');
    expect(entry.invitedByThisPractice).toBe(false);
    expect(entry.email).toBeUndefined();
    // But it still says an address EXISTS, which is what a practice needs to
    // know: an invitation has somewhere to go.
    expect(entry.hasEmail).toBe(true);
  });

  it('says so when there is no address at all', () => {
    const entry = toRosterEntry({ ...practitioner, email: null }, 'practice-a');
    expect(entry.hasEmail).toBe(false);
    expect(entry.email).toBeNull();
  });

  it('NEVER carries a provider number, whoever is asking', () => {
    for (const viewer of ['practice-a', 'practice-b']) {
      // The same guard the boundary itself uses, so this test fails the way a
      // real disclosure would.
      expect(() => assertNoProviderNumber(toRosterEntry(practitioner, viewer), 'roster')).not.toThrow();
    }
  });

  it('carries what the register said, because AHPRA publishes it anyway', () => {
    const entry = toRosterEntry(practitioner, 'practice-b');
    expect(entry.registrationStatus).toBe('Registered');
    expect(entry.profession).toBe('Medical Practitioner');
  });

  /*
   * The single fact the setup hub's practitioners card is about: has anybody
   * actually looked at the register, or are we repeating what we were told?
   */
  it('reports whether the register was checked, not merely what it said', () => {
    expect(toRosterEntry(practitioner, 'practice-a').registerChecked).toBe(true);
    expect(toRosterEntry({ ...practitioner, registrationSightedAt: null }, 'practice-a').registerChecked).toBe(
      false,
    );
  });

  it('surfaces deregistration, which is an immediate hard stop', () => {
    const entry = toRosterEntry({ ...practitioner, deregisteredAt: new Date('2026-02-01') }, 'practice-a');
    expect(entry.deregisteredAt).toEqual(new Date('2026-02-01'));
  });
});
