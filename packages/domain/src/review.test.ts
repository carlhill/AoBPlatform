import { compareForReview, reviewFlags, worstSeverity } from './review';

const clean = {
  abnVerificationSource: 'abr_api',
  adminEmail: 'robin@practice.invalid',
  adminPhone: '0298765432',
  managerName: 'Alex Chen',
  managerEmail: 'alex@practice.invalid',
  managerPhone: '0298765433',
  entityType: 'PTY_LTD',
  credentialCount: 3,
};

describe('reviewFlags', () => {
  it('raises nothing on a complete, API-verified company application', () => {
    expect(reviewFlags(clean)).toEqual([]);
  });

  it('flags an attested ABN as HIGH — the register gate passed on a transcription', () => {
    const flags = reviewFlags({ ...clean, abnVerificationSource: 'manual_attestation' });
    expect(flags[0]).toEqual({ key: 'attested', severity: 'high' });
  });

  it('flags contacts that share a handset, and says which channel', () => {
    const flags = reviewFlags({ ...clean, managerPhone: '0298765432' });
    expect(flags).toContainEqual({ key: 'contacts_clash', severity: 'high', detail: 'phone' });
  });

  it('flags contacts that share an inbox', () => {
    const flags = reviewFlags({ ...clean, managerEmail: 'ROBIN@practice.invalid' });
    expect(flags).toContainEqual({ key: 'contacts_clash', severity: 'high', detail: 'email' });
  });

  it('flags a missing second contact as MEDIUM, not high — it is permitted', () => {
    const flags = reviewFlags({ ...clean, managerName: null, managerEmail: null, managerPhone: null });
    expect(flags).toContainEqual({ key: 'no_manager', severity: 'medium' });
  });

  it('notes a sole trader as LOW — context, not concern', () => {
    const flags = reviewFlags({ ...clean, entityType: 'INDIVIDUAL_SOLE_TRADER' });
    expect(flags).toContainEqual({ key: 'sole_trader', severity: 'low' });
  });

  it('notes a single proof, and does not note three', () => {
    expect(reviewFlags({ ...clean, credentialCount: 1 })).toContainEqual({
      key: 'weak_proof',
      severity: 'low',
    });
    expect(reviewFlags({ ...clean, credentialCount: 3 }).map((f) => f.key)).not.toContain('weak_proof');
  });

  it('counts a single credentialValue as one proof when no count is given', () => {
    const flags = reviewFlags({
      ...clean,
      credentialCount: undefined,
      credentialValue: 'MED0001234567',
    });
    expect(flags.map((f) => f.key)).toContain('weak_proof');
  });

  it('puts ABN provenance first when several fire', () => {
    const flags = reviewFlags({
      ...clean,
      abnVerificationSource: 'manual_attestation',
      managerName: null,
      credentialCount: 1,
    });
    expect(flags[0].key).toBe('attested');
  });

  // The real application that prompted this module.
  it('flags Carl’s own application on both counts', () => {
    const flags = reviewFlags({
      abnVerificationSource: 'manual_attestation',
      adminEmail: 'carl@example.invalid',
      adminPhone: '0408169971',
      managerName: 'Audrey Hill',
      managerEmail: 'audrey@example.invalid',
      managerPhone: '0408169971',
      entityType: 'TRUST',
      credentialCount: 1,
    });
    expect(flags.map((f) => f.key)).toEqual(['attested', 'contacts_clash', 'weak_proof']);
  });
});

describe('worstSeverity', () => {
  it('is null for a clean application', () => {
    expect(worstSeverity([])).toBeNull();
  });

  it('reports the worst, not the first', () => {
    expect(
      worstSeverity([
        { key: 'weak_proof', severity: 'low' },
        { key: 'attested', severity: 'high' },
      ]),
    ).toBe('high');
  });
});

describe('compareForReview', () => {
  const at = (iso: string) => new Date(iso);

  it('puts a flagged application ahead of a clean one that arrived earlier', () => {
    const flagged = { flags: [{ key: 'attested', severity: 'high' as const }], createdAt: at('2026-08-20') };
    const cleanOld = { flags: [], createdAt: at('2026-08-01') };
    expect(compareForReview(flagged, cleanOld)).toBeLessThan(0);
  });

  it('breaks ties by age, oldest first — nothing waits forever', () => {
    const older = { flags: [{ key: 'no_manager', severity: 'medium' as const }], createdAt: at('2026-08-01') };
    const newer = { flags: [{ key: 'no_manager', severity: 'medium' as const }], createdAt: at('2026-08-20') };
    expect(compareForReview(older, newer)).toBeLessThan(0);
  });

  it('sorts a mixed queue worst-first', () => {
    const queue = [
      { name: 'clean', flags: [], createdAt: at('2026-08-01') },
      { name: 'low', flags: [{ key: 'weak_proof', severity: 'low' as const }], createdAt: at('2026-08-02') },
      { name: 'high', flags: [{ key: 'attested', severity: 'high' as const }], createdAt: at('2026-08-03') },
      { name: 'medium', flags: [{ key: 'no_manager', severity: 'medium' as const }], createdAt: at('2026-08-04') },
    ];
    expect([...queue].sort(compareForReview).map((q) => q.name)).toEqual(['high', 'medium', 'low', 'clean']);
  });
});
