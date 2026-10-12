import { calendarDayOf, dateColumnOf, draftMatchesService } from './pre-agreement-association';

/**
 * THE MATCH RULE, without a database (D-2026-10-10-09 option (b)): same
 * patient, same practice-local day, same servicing provider -- by affiliation,
 * or by the legacy provider row where one side predates affiliations.
 */
describe('draftMatchesService', () => {
  const draft = { patientId: 'patient-a', forDay: '2026-10-06', affiliationId: 'aff-1', providerId: null };
  const service = { patientId: 'patient-a', day: '2026-10-06', affiliationId: 'aff-1', providerId: 'prov-legacy' };

  it('same_patient_day_and_affiliation_match', () => {
    expect(draftMatchesService(draft, service)).toBe(true);
  });

  it('a_different_patient_day_or_affiliation_does_not_match', () => {
    expect(draftMatchesService(draft, { ...service, patientId: 'patient-b' })).toBe(false);
    expect(draftMatchesService(draft, { ...service, day: '2026-10-07' })).toBe(false);
    expect(draftMatchesService(draft, { ...service, affiliationId: 'aff-2' })).toBe(false);
  });

  it('a_service_with_no_patient_never_matches', () => {
    expect(draftMatchesService(draft, { ...service, patientId: null })).toBe(false);
  });

  it('a_legacy_draft_matches_on_the_legacy_provider_row', () => {
    const legacy = { ...draft, affiliationId: null, providerId: 'prov-legacy' };
    expect(draftMatchesService(legacy, { ...service, affiliationId: null })).toBe(true);
    expect(draftMatchesService(legacy, { ...service, providerId: 'prov-other', affiliationId: null })).toBe(false);
  });

  it('two_unknown_providers_are_not_the_same_provider', () => {
    expect(
      draftMatchesService({ ...draft, affiliationId: null }, { ...service, affiliationId: null, providerId: null }),
    ).toBe(false);
  });
});

describe('calendar day helpers', () => {
  it('a_date_column_round_trips_as_its_calendar_day', () => {
    expect(calendarDayOf(dateColumnOf('2026-10-04'))).toBe('2026-10-04');
    expect(dateColumnOf('2026-10-04').toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });
});
