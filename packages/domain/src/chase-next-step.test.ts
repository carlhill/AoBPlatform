import { CHASE_BAND_POLICIES, chaseBandFor, chaseNextStep } from './chase';

const policy = (band: string) => CHASE_BAND_POLICIES.find((p) => p.band === band)!;

describe('chaseNextStep — the ladder read off the evidence (REQ-CHASE-05)', () => {
  it('standard: ai, ai, then a person, then handback', () => {
    expect(chaseNextStep(policy('standard'), 0)).toBe('ai');
    expect(chaseNextStep(policy('standard'), 1)).toBe('ai');
    expect(chaseNextStep(policy('standard'), 2)).toBe('human');
    expect(chaseNextStep(policy('standard'), 3)).toBe('handback');
  });

  it('urgent: a person FIRST — the AI attempt is skipped when the deadline is near', () => {
    expect(chaseNextStep(policy('urgent'), 0)).toBe('human');
    expect(chaseNextStep(policy('urgent'), 1)).toBe('ai');
    expect(chaseNextStep(policy('urgent'), 2)).toBe('human');
  });

  it('last chance: one attempt, by a person, then straight to the principal', () => {
    expect(chaseNextStep(policy('last_chance'), 0)).toBe('human');
    expect(chaseNextStep(policy('last_chance'), 1)).toBe('handback');
  });

  it('expired: nothing, ever (REQ-CHASE-08)', () => {
    expect(chaseNextStep(policy('expired'), 0)).toBeNull();
    expect(chaseNextStep(chaseBandFor(-40), 5)).toBeNull();
  });
});
