import { generateTelehealthCode, hashTelehealthCode, telehealthCodeMatches } from './telehealth-code';
import type { Prisma } from '@prisma/client';
import { TELEHEALTH_EVENT_TYPES, TELEHEALTH_VAULT_EVENTS_APPROVED, TelehealthEvidence, assertNoValues } from './telehealth-evidence';
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

describe('the telehealth vault events', () => {
  it('telehealth_vault_payloads_refuse_value_keys', () => {
    // A payload key that could carry a value is refused before it reaches any sink.
    for (const key of ['code', 'note', 'mobile', 'email', 'name', 'dateOfBirth', 'medicareNumber', 'pageKey']) {
      expect(() => assertNoValues({ [key]: 'x' })).toThrow(/hard rule 9/);
    }
    expect(() => assertNoValues({ identifierTypeCount: 3, reason: 'emergency', hasNote: true })).not.toThrow();
  });

  it('are_in_the_vault_list_as_carl_approved_them', () => {
    // Approved by Carl, 12 Oct 2026 (D-2026-10-12-02): the seven of ruling item 1 and `code_wrong` of item 8
    // are all listed, and the approval constant says so.
    const listed: readonly string[] = VAULT_EVENT_TYPES;
    expect(TELEHEALTH_VAULT_EVENTS_APPROVED).toBe(true);
    for (const type of TELEHEALTH_EVENT_TYPES) expect(listed).toContain(type);
    // Exactly the nine approved (the ninth, consultation_held, D-2026-10-12-03 item 6): no other telehealth type has crept into the vault list.
    expect([...TELEHEALTH_EVENT_TYPES].sort()).toEqual(
      [
        'telehealth.session_opened',
        'telehealth.link_sent',
        'telehealth.code_checked',
        'telehealth.code_wrong',
        'telehealth.code_locked_out',
        'telehealth.consent_recorded',
        'telehealth.not_done',
        'telehealth.did_not_proceed',
        'telehealth.consultation_held',
      ].sort(),
    );
    expect(listed.filter((t) => t.startsWith('telehealth.')).sort()).toEqual([...TELEHEALTH_EVENT_TYPES].sort());
  });

  it('go_to_the_outbox_on_the_callers_tx_with_scalar_payloads', async () => {
    const created: Array<{ data: Record<string, unknown> }> = [];
    const tx = { vaultOutbox: { create: async (args: { data: Record<string, unknown> }) => created.push(args) } };
    const evidence = new TelehealthEvidence();
    await evidence.record(tx as unknown as Prisma.TransactionClient, {
      event: {
        type: 'telehealth.did_not_proceed',
        payload: { fromState: 'opened', consultationAt: null, recordedAt: '2026-10-12T00:00:00.000Z' },
      },
      actor: { principalType: 'practitioner', id: 'p-1' },
      subject: { type: 'TelehealthSession', id: 's-1' },
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.data).toMatchObject({
      type: 'telehealth.did_not_proceed',
      subjectType: 'TelehealthSession',
      subjectId: 's-1',
      // A time not given is left out, not stored as null: a vault payload holds scalars.
      payload: { fromState: 'opened', recordedAt: '2026-10-12T00:00:00.000Z' },
    });
    expect(Object.keys(created[0]!.data.payload as object)).not.toContain('consultationAt');
  });
});
