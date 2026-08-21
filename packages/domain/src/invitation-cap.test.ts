import {
  DEFAULT_INVITATION_CEILING,
  hasInvitationCapacity,
  invitationCapMessage,
  invitationLimitFor,
} from './affiliation';
import { compareProfession } from './ahpra';

describe('the invitation cap', () => {
  it('gives a stated headcount 20% of room to grow', () => {
    expect(invitationLimitFor({ statedPractitionerCount: 10, currentCount: 0 })).toBe(12);
    expect(invitationLimitFor({ statedPractitionerCount: 5, currentCount: 0 })).toBe(6);
  });

  it('rounds up, so a small practice is not squeezed by arithmetic', () => {
    // 3 × 1.2 = 3.6 → 4, not 3.
    expect(invitationLimitFor({ statedPractitionerCount: 3, currentCount: 0 })).toBe(4);
  });

  it('falls back to the ceiling when no headcount was stated', () => {
    expect(invitationLimitFor({ currentCount: 0 })).toBe(DEFAULT_INVITATION_CEILING);
    expect(invitationLimitFor({ statedPractitionerCount: 0, currentCount: 0 })).toBe(DEFAULT_INVITATION_CEILING);
  });

  it('never exceeds the default ceiling on a stated headcount alone', () => {
    // A practice claiming 500 practitioners does not get 600 by saying so.
    expect(invitationLimitFor({ statedPractitionerCount: 500, currentCount: 0 })).toBe(DEFAULT_INVITATION_CEILING);
  });

  it('lets a CONTRACTED cap exceed the ceiling — hospitals are real', () => {
    expect(invitationLimitFor({ statedPractitionerCount: 10, contractedCap: 400, currentCount: 0 })).toBe(400);
  });

  it('has capacity below the limit and none at it', () => {
    expect(hasInvitationCapacity({ statedPractitionerCount: 10, currentCount: 11 })).toBe(true);
    expect(hasInvitationCapacity({ statedPractitionerCount: 10, currentCount: 12 })).toBe(false);
    expect(hasInvitationCapacity({ statedPractitionerCount: 10, currentCount: 99 })).toBe(false);
  });

  describe('the message when the wall is hit', () => {
    const message = invitationCapMessage();

    it('DOES NOT REVEAL the limit or how it was derived', () => {
      // Telling an applicant "four remaining" hands an attacker their budget.
      expect(message).not.toMatch(/\d/);
      expect(message.toLowerCase()).not.toContain('20%');
      expect(message.toLowerCase()).not.toContain('headcount');
    });

    it('but DOES say a limit exists and how to lift it', () => {
      // A silent refusal is indistinguishable from a broken platform.
      expect(message.toLowerCase()).toContain('limit');
      expect(message.toLowerCase()).toContain('contact us');
    });

    it('says it is not a judgement about them', () => {
      expect(message.toLowerCase()).toContain('not a judgement');
    });
  });
});

describe('profession versus the provider type a practice asserts', () => {
  it('accepts a medical practitioner affiliated as a GP', () => {
    expect(compareProfession('general_practitioner', 'Medical Practitioner').result).toBe('consistent');
  });

  it('FLAGS A NURSE AFFILIATED AS A GP — the scenario this exists for', () => {
    const result = compareProfession('general_practitioner', 'Nurse');
    expect(result.result).toBe('mismatch');
    expect(result.message).toMatch(/belongs to somebody else/);
  });

  it('states both readings, because either could be the true one', () => {
    const result = compareProfession('general_practitioner', 'Nurse');
    expect(result.message).toMatch(/provider type is wrong/);
    expect(result.message).toMatch(/registration number belongs to somebody else/);
  });

  it('is NOT A BLOCK — scopes overlap and names vary', () => {
    expect(compareProfession('general_practitioner', 'Nurse').message).toMatch(/NOT A BLOCK/);
  });

  it('accepts a nurse affiliated as a nurse practitioner', () => {
    expect(compareProfession('nurse_practitioner', 'Nurse').result).toBe('consistent');
  });

  it('accepts allied health professions', () => {
    expect(compareProfession('allied_health', 'Physiotherapist').result).toBe('consistent');
    expect(compareProfession('allied_health', 'Psychologist').result).toBe('consistent');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(compareProfession('general_practitioner', '  medical practitioner ').result).toBe('consistent');
  });

  it('says UNKNOWN rather than guessing when the register has not been checked', () => {
    // Silence is not consent: an unchecked register must never read as a pass.
    expect(compareProfession('general_practitioner', null).result).toBe('unknown');
    expect(compareProfession('general_practitioner', '').result).toBe('unknown');
  });

  it('says unknown for a provider type with no expectation defined', () => {
    expect(compareProfession('other', 'Medical Practitioner').result).toBe('unknown');
  });
});
