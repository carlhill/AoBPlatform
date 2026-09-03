/**
 * The content file is load-bearing: C6 refuses anything that is not exactly
 * one of these strings, so a bad edit is a pre-agreement nobody can sign.
 *
 * The other half of this — that the list agrees with the rules engine's own
 * mapping — is `service_descriptions_agree_with_rules_mapping` in
 * `apps/core/test`, which can import both packages. This suite guards the file
 * itself.
 */
import {
  SERVICE_DESCRIPTIONS,
  SERVICE_DESCRIPTIONS_VERSION,
  isServiceDescription,
  parseServiceDescriptionContent,
} from './service-descriptions';

describe('service descriptions — versioned content (hard rule 14)', () => {
  it('loads a non-empty, versioned list', () => {
    expect(SERVICE_DESCRIPTIONS.length).toBeGreaterThan(0);
    expect(SERVICE_DESCRIPTIONS_VERSION).toMatch(/\S/);
  });

  it('matches exactly and case-sensitively, exactly as C6 does', () => {
    const first = SERVICE_DESCRIPTIONS[0];
    expect(isServiceDescription(first)).toBe(true);
    expect(isServiceDescription(first.toLowerCase())).toBe(false);
    expect(isServiceDescription(` ${first} `)).toBe(false);
    expect(isServiceDescription('Something a receptionist typed')).toBe(false);
    expect(isServiceDescription(undefined)).toBe(false);
  });

  it('carries no dollar amount and no benefit wording (hard rule 4)', () => {
    for (const description of SERVICE_DESCRIPTIONS) {
      expect(description).not.toMatch(/\$|\bbenefit\b|\brebate\b|\bfee\b/i);
    }
  });

  it('never claims the forms are certified, approved or accredited (hard rule 12)', () => {
    for (const description of SERVICE_DESCRIPTIONS) {
      expect(description).not.toMatch(/certified|approved|accredited|government-approved/i);
    }
  });

  describe('a bad edit fails at load rather than at a front desk', () => {
    it.each([
      [null, 'not an object'],
      [{ descriptions: ['A'] }, 'no version'],
      [{ version: ' ', descriptions: ['A'] }, 'blank version'],
      [{ version: 'v1' }, 'no descriptions'],
      [{ version: 'v1', descriptions: [] }, 'empty descriptions'],
      [{ version: 'v1', descriptions: [''] }, 'an empty description'],
      [{ version: 'v1', descriptions: [42] }, 'a description that is not a string'],
      [{ version: 'v1', descriptions: ['A ', 'B'] }, 'trailing whitespace C6 would refuse'],
      [{ version: 'v1', descriptions: ['A', 'A'] }, 'a duplicate'],
    ])('refuses %j — %s', (raw) => {
      expect(() => parseServiceDescriptionContent(raw)).toThrow(/service-descriptions\.json is not usable/);
    });
  });
});
