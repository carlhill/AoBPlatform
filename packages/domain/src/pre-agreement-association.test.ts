/**
 * AN UNSIGNED PRE-AGREEMENT IS ASSOCIATED WITH ITS VISIT'S SERVICE, NEVER
 * LINKED TO IT (D-2026-10-10-09, Carl's option (b)).
 *
 * These pin the pure half: which statuses are still unsigned, which day a
 * draft is for, and what the number of matching drafts means. The database
 * half is `test/pre-agreement-association.e2e-spec.ts` in apps/core.
 */
import {
  PRE_AGREEMENT_ASSOCIATION_HOW,
  UNSIGNED_OPEN_STATUSES,
  associationOutcomeFor,
  isPreAgreementAssociationHow,
  visitDayOf,
} from './pre-agreement-association';

describe('pre-agreement association (option b)', () => {
  it('unsigned_open_statuses_are_exactly_the_ones_the_lifecycle_lets_expire', () => {
    // Derived from STATUS_TRANSITIONS, not a second list somebody keeps in step.
    expect([...UNSIGNED_OPEN_STATUSES].sort()).toEqual(
      ['awaiting_signature', 'draft', 'verification_failed', 'verification_pending'].sort(),
    );
  });

  it('one_candidate_associates_two_or_more_ask_a_person_none_does_nothing', () => {
    expect(associationOutcomeFor(0)).toBe('none');
    expect(associationOutcomeFor(1)).toBe('associate');
    expect(associationOutcomeFor(2)).toBe('choose');
    expect(associationOutcomeFor(5)).toBe('choose');
  });

  it('the_day_a_draft_is_for_is_its_appointment_date_where_it_has_one', () => {
    const createdAt = new Date('2026-10-05T23:30:00Z'); // 10:30 on 6 Oct in Sydney
    expect(visitDayOf({ createdAt }, new Date('2026-10-09T00:00:00Z'))).toBe('2026-10-09');
  });

  it('local_day_boundary_a_draft_made_before_midnight_utc_is_the_next_sydney_day', () => {
    // 22:00 UTC on 5 Oct is 09:00 on 6 Oct in Sydney (AEDT, +11).
    expect(visitDayOf({ createdAt: new Date('2026-10-05T22:00:00Z') }, null)).toBe('2026-10-06');
    // 12:59 UTC on 5 Oct is 23:59 on 5 Oct in Sydney.
    expect(visitDayOf({ createdAt: new Date('2026-10-05T12:59:00Z') }, null)).toBe('2026-10-05');
    // 13:00 UTC on 5 Oct is midnight on 6 Oct in Sydney.
    expect(visitDayOf({ createdAt: new Date('2026-10-05T13:00:00Z') }, null)).toBe('2026-10-06');
  });

  it('only_automatic_and_chosen_say_how_an_association_was_made', () => {
    expect(PRE_AGREEMENT_ASSOCIATION_HOW).toEqual(['automatic', 'chosen']);
    expect(isPreAgreementAssociationHow('automatic')).toBe(true);
    expect(isPreAgreementAssociationHow('chosen')).toBe(true);
    expect(isPreAgreementAssociationHow('linked')).toBe(false);
    expect(isPreAgreementAssociationHow(undefined)).toBe(false);
  });
});
