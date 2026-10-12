import { shownAhpraNumber, telehealthProviderName } from './telehealth-provider';

describe('how the provider is named to the patient in telehealth (D-2026-10-12-03 item 10)', () => {
  it('dr_only_for_a_medical_practitioner', () => {
    expect(telehealthProviderName({ givenNames: 'Sample', familyName: 'Chen', profession: 'Medical Practitioner' })).toBe('Dr Sample Chen');
    expect(telehealthProviderName({ givenNames: 'Sample', familyName: 'Chen', profession: 'Nurse' })).toBe('Sample Chen');
    expect(telehealthProviderName({ givenNames: 'Sample', familyName: 'Chen', profession: null })).toBe('Sample Chen');
  });

  it('a_title_typed_into_the_name_is_dropped_never_dr_ms', () => {
    expect(telehealthProviderName({ givenNames: 'Ms Yu-Feng Judy', familyName: 'Huang', profession: 'Medical Practitioner' })).toBe(
      'Dr Yu-Feng Judy Huang',
    );
    expect(telehealthProviderName({ givenNames: 'Dr. Sample', familyName: 'Chen', profession: 'Psychologist' })).toBe('Sample Chen');
    // A name that merely starts with the letters of a title is kept whole.
    expect(telehealthProviderName({ givenNames: 'Mrinal', familyName: 'Fixture', profession: null })).toBe('Mrinal Fixture');
  });

  it('the_ahpra_number_only_when_sighted_and_registered', () => {
    const sighted = new Date('2026-08-22T00:00:00Z');
    expect(shownAhpraNumber({ ahpraNumber: 'MED0000000001', registrationStatus: 'Registered', registrationSightedAt: sighted })).toBe(
      'MED0000000001',
    );
    expect(shownAhpraNumber({ ahpraNumber: 'MED0000000001', registrationStatus: 'Registered', registrationSightedAt: null })).toBeNull();
    expect(shownAhpraNumber({ ahpraNumber: 'MED0000000001', registrationStatus: 'Suspended', registrationSightedAt: sighted })).toBeNull();
    expect(shownAhpraNumber({ ahpraNumber: null, registrationStatus: 'Registered', registrationSightedAt: sighted })).toBeNull();
  });
});
