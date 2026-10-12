import { generateTelehealthCode, hashTelehealthCode, telehealthCodeMatches } from './telehealth-code';
import { PROPOSED_TELEHEALTH_EVENT_TYPES, TELEHEALTH_VAULT_EVENTS_APPROVED, assertNoValues } from './telehealth-evidence';
import { VAULT_EVENT_TYPES } from '@aobplatform/contracts';

describe('the telehealth code', () => {
  it('is_six_digits_from_a_csprng_with_leading_zeros_kept', () => {
    for (let i = 0; i < 200; i += 1) expect(generateTelehealthCode(6)).toMatch(/^[0-9]{6}$/);
  });

  it('telehealth_code_stored_hashed', async () => {
    const code = '042917';
    const stored = await hashTelehealthCode(code);
    // The shape the migration's CHECK insists on: a salted scrypt, so the code itself is not in it.
    expect(stored).toMatch(/^scrypt\$[0-9]+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(stored.split('$')).not.toContain(code);
    // Salted: the same code twice is two different hashes.
    expect(await hashTelehealthCode(code)).not.toBe(stored);
    expect(await telehealthCodeMatches(code, stored)).toBe(true);
    expect(await telehealthCodeMatches('042918', stored)).toBe(false);
    expect(await telehealthCodeMatches('', stored)).toBe(false);
    expect(await telehealthCodeMatches(code, null)).toBe(false);
    expect(await telehealthCodeMatches(code, 'sha256$abc')).toBe(false);
  });
});

describe('the proposed telehealth vault events', () => {
  it('telehealth_vault_payloads_refuse_value_keys', () => {
    // A payload key that could carry a value is refused before it reaches any sink.
    for (const key of ['code', 'note', 'mobile', 'email', 'name', 'dateOfBirth', 'medicareNumber', 'pageKey']) {
      expect(() => assertNoValues({ [key]: 'x' })).toThrow(/hard rule 9/);
    }
    expect(() => assertNoValues({ identifierTypeCount: 3, reason: 'emergency', hasNote: true })).not.toThrow();
  });

  it('are_not_in_the_vault_list_until_carl_approves_them', () => {
    // When this fails, approval has landed: flip TELEHEALTH_VAULT_EVENTS_APPROVED and wire the sink to the outbox.
    const listed: readonly string[] = VAULT_EVENT_TYPES;
    expect(PROPOSED_TELEHEALTH_EVENT_TYPES.some((t) => listed.includes(t))).toBe(TELEHEALTH_VAULT_EVENTS_APPROVED);
  });
});
