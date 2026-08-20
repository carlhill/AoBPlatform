import { constantTimeMatch, evaluateChallenge, normaliseStatedValue, normalisedHeldValue } from './identifier-matching';

const record = {
  familyName: 'Testpatient',
  givenNames: 'Alex',
  dateOfBirth: new Date('1957-03-14'),
  genderAsIdentified: 'Male',
  address: '1 Example Street, Sampletown NSW 2000',
  patientRecordNumber: 'sample-0001',
  ihi: '8003 6011 2345 6789',
};

describe('identifier normalisation', () => {
  it('treats family + given names as ONE identifier, case/whitespace-insensitive', () => {
    expect(normalisedHeldValue('name', record)).toBe('testpatient alex');
    expect(normaliseStatedValue('name', '  TESTPATIENT   alex ')).toBe('testpatient alex');
  });

  it('normalises addresses through punctuation and case', () => {
    expect(normaliseStatedValue('address', '1 example street  sampletown nsw 2000')).toBe(
      normalisedHeldValue('address', record),
    );
  });

  it('normalises IHI to digits only', () => {
    expect(normalisedHeldValue('ihi', record)).toBe('8003601123456789');
    expect(normaliseStatedValue('ihi', '8003-6011-2345-6789')).toBe('8003601123456789');
  });

  it('returns null for identifiers the record does not hold — a missing value can never match', () => {
    expect(normalisedHeldValue('gender', { ...record, genderAsIdentified: null })).toBeNull();
  });
});

describe('constantTimeMatch', () => {
  it('matches equal values and rejects different ones regardless of length', () => {
    expect(constantTimeMatch('abc', 'abc')).toBe(true);
    expect(constantTimeMatch('abc', 'abd')).toBe(false);
    expect(constantTimeMatch('abc', 'abcdef')).toBe(false);
  });
});

describe('evaluateChallenge', () => {
  const types = ['name', 'date_of_birth', 'address'] as const;

  it('passes only when every challenged identifier matches', () => {
    expect(
      evaluateChallenge(types as never, {
        name: 'Testpatient Alex',
        date_of_birth: '1957-03-14',
        address: '1 Example Street, Sampletown NSW 2000',
      }, record),
    ).toBe(true);
  });

  it('fails on any single mismatch, and on missing stated values', () => {
    expect(
      evaluateChallenge(types as never, {
        name: 'Testpatient Alex',
        date_of_birth: '1957-03-15',
        address: '1 Example Street, Sampletown NSW 2000',
      }, record),
    ).toBe(false);
    expect(evaluateChallenge(types as never, { name: 'Testpatient Alex' }, record)).toBe(false);
  });

  it('evaluates every identifier rather than short-circuiting (uniform work per attempt)', () => {
    // Behavioural proxy for the timing property: a first-identifier mismatch
    // and a last-identifier mismatch take the same code path — both evaluate
    // all three comparisons. Asserted structurally: evaluateChallenge has no
    // early return (see implementation); here we just pin the outcomes.
    expect(evaluateChallenge(types as never, { name: 'x', date_of_birth: '1957-03-14', address: '1 Example Street, Sampletown NSW 2000' }, record)).toBe(false);
    expect(evaluateChallenge(types as never, { name: 'Testpatient Alex', date_of_birth: '1957-03-14', address: 'x' }, record)).toBe(false);
  });
});
