import {
  AbnError,
  assertOrganisationApplicationValid,
  deriveAcnFromAbn,
  isValidAbnChecksum,
  isValidAcnChecksum,
  matchOrganisationName,
  normaliseAbn,
  type AbrLookup,
} from './abn';

// A checksum-valid ABN carrying a checksum-valid ACN in its last nine digits.
// Constructed for the test, not looked up — no real entity is named here.
const COMPANY_ABN = '53004085616';
const COMPANY_ACN = '004085616';

describe('ABN checksum', () => {
  it('accepts a well-formed ABN', () => {
    expect(isValidAbnChecksum(COMPANY_ABN)).toBe(true);
  });

  it('tolerates the spacing the ABR itself prints', () => {
    expect(normaliseAbn('53 004 085 616')).toBe(COMPANY_ABN);
    expect(isValidAbnChecksum('53 004 085 616')).toBe(true);
  });

  it('rejects a single-digit typo', () => {
    expect(isValidAbnChecksum('53004085617')).toBe(false);
  });

  it('rejects anything not eleven digits', () => {
    for (const bad of ['', '5300408561', '530040856160', '5300408561A', 'not an abn']) {
      expect(isValidAbnChecksum(bad)).toBe(false);
    }
  });
});

describe('ACN checksum and derivation', () => {
  it('accepts a well-formed ACN', () => {
    expect(isValidAcnChecksum(COMPANY_ACN)).toBe(true);
  });

  it('derives the ACN from a company ABN — we never ask for it', () => {
    expect(deriveAcnFromAbn(COMPANY_ABN)).toBe(COMPANY_ACN);
  });

  it('returns null when the trailing digits are not an ACN (sole traders have no ACN)', () => {
    // A checksum-valid ABN whose last nine digits fail the ACN check.
    const soleTraderAbn = '51824753556';
    expect(isValidAbnChecksum(soleTraderAbn)).toBe(true);
    expect(deriveAcnFromAbn(soleTraderAbn)).toBeNull();
  });

  it('returns null for a malformed ABN rather than guessing', () => {
    expect(deriveAcnFromAbn('nope')).toBeNull();
  });
});

describe('name matching', () => {
  const registered = {
    legalName: 'Smith Medical Pty Ltd',
    businessNames: ['Sampletown Family Practice', 'Sampletown Skin Clinic'],
  };

  it('matches the legal name exactly', () => {
    const match = matchOrganisationName('Smith Medical Pty Ltd', registered);
    expect(match.tier).toBe('exact');
    expect(match.source).toBe('legal_name');
  });

  it('MATCHES A TRADING NAME — the reason this is not a strict legal-name check', () => {
    const match = matchOrganisationName('Sampletown Family Practice', registered);
    expect(match.tier).toBe('exact');
    expect(match.source).toBe('business_name');
    expect(match.matched).toBe('Sampletown Family Practice');
  });

  it('matches a second registered business name', () => {
    expect(matchOrganisationName('Sampletown Skin Clinic', registered).tier).toBe('exact');
  });

  it('ignores case and punctuation', () => {
    expect(matchOrganisationName('smith medical pty. ltd.', registered).tier).toBe('exact');
  });

  it('reports a suffix-insensitive match as a WEAKER tier, not silently as exact', () => {
    const match = matchOrganisationName('Smith Medical', registered);
    expect(match.tier).toBe('entity_suffix_insensitive');
    expect(match.matched).toBe('Smith Medical Pty Ltd');
  });

  it('does not match an unrelated name', () => {
    expect(matchOrganisationName('Otherville Medical Centre', registered).tier).toBe('none');
  });

  it('does not let an empty typed name match anything', () => {
    expect(matchOrganisationName('   ', registered).tier).toBe('none');
  });
});

describe('the organisation onboarding gate', () => {
  const lookup: AbrLookup = {
    abn: COMPANY_ABN,
    abnStatus: 'ACTIVE',
    legalName: 'Smith Medical Pty Ltd',
    businessNames: ['Sampletown Family Practice'],
    entityType: 'PTY_LTD',
    gstRegistered: true,
  };

  it('passes a good application and returns the derived ACN', () => {
    const result = assertOrganisationApplicationValid(
      { typedName: 'Sampletown Family Practice', abn: COMPANY_ABN },
      lookup,
    );
    expect(result.acn).toBe(COMPANY_ACN);
    expect(result.nameMatch.source).toBe('business_name');
    expect(result.gstRegistered).toBe(true);
  });

  it('abn_must_be_active — a cancelled ABN cannot be onboarded', () => {
    expect(() =>
      assertOrganisationApplicationValid({ typedName: 'Smith Medical Pty Ltd', abn: COMPANY_ABN }, {
        ...lookup,
        abnStatus: 'CANCELLED',
      }),
    ).toThrow(/not ACTIVE/);
  });

  it('rejects a checksum failure before any lookup is trusted', () => {
    expect(() =>
      assertOrganisationApplicationValid({ typedName: 'Smith Medical Pty Ltd', abn: '53004085617' }, lookup),
    ).toThrow(AbnError);
  });

  it('refuses when the lookup answers about a different ABN', () => {
    expect(() =>
      assertOrganisationApplicationValid({ typedName: 'Smith Medical Pty Ltd', abn: COMPANY_ABN }, {
        ...lookup,
        abn: '51824753556',
      }),
    ).toThrow(/different ABN/);
  });

  it('names the registered alternatives when the typed name does not match', () => {
    expect(() =>
      assertOrganisationApplicationValid({ typedName: 'Completely Different Clinic', abn: COMPANY_ABN }, lookup),
    ).toThrow(/Sampletown Family Practice/);
  });

  it('rejects a supplied ACN that disagrees with the ABN', () => {
    expect(() =>
      assertOrganisationApplicationValid(
        { typedName: 'Smith Medical Pty Ltd', abn: COMPANY_ABN, acn: '000000019' },
        lookup,
      ),
    ).toThrow(/can never legitimately differ/);
  });

  it('accepts a supplied ACN that agrees', () => {
    expect(
      assertOrganisationApplicationValid(
        { typedName: 'Smith Medical Pty Ltd', abn: COMPANY_ABN, acn: COMPANY_ACN },
        lookup,
      ).acn,
    ).toBe(COMPANY_ACN);
  });

  it('refers a company with no derivable ACN to human validation', () => {
    expect(() =>
      assertOrganisationApplicationValid({ typedName: 'Smith Medical Pty Ltd', abn: '51824753556' }, {
        ...lookup,
        abn: '51824753556',
        entityType: 'PTY_LTD',
      }),
    ).toThrow(/human validation/);
  });

  it('points at the ENTITY TYPE when the name reads like a trust', () => {
    // The real-world trap: "The trustee for X Family Trust" picked as PTY_LTD.
    // The ABN is fine; the entity type is not. The message must say so.
    expect(() =>
      assertOrganisationApplicationValid({ typedName: 'XLEVELUP', abn: '27734610304' }, {
        abn: '27734610304',
        abnStatus: 'ACTIVE',
        legalName: 'The trustee for Example Family Trust',
        businessNames: ['XLEVELUP'],
        entityType: 'PTY_LTD',
      }),
    ).toThrow(/reads like a TRUST/);
  });

  it('registers that same entity happily once TRUST is chosen', () => {
    const result = assertOrganisationApplicationValid({ typedName: 'XLEVELUP', abn: '27734610304' }, {
      abn: '27734610304',
      abnStatus: 'ACTIVE',
      legalName: 'The trustee for Example Family Trust',
      businessNames: ['XLEVELUP'],
      entityType: 'TRUST',
    });
    expect(result.acn).toBeNull();
    expect(result.nameMatch.source).toBe('business_name');
  });

  it('does NOT demand an ACN of a sole trader', () => {
    const result = assertOrganisationApplicationValid({ typedName: 'Jo Example', abn: '51824753556' }, {
      abn: '51824753556',
      abnStatus: 'ACTIVE',
      legalName: 'Jo Example',
      entityType: 'INDIVIDUAL_SOLE_TRADER',
    });
    expect(result.acn).toBeNull();
  });
});
