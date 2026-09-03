import { addressMatches, constantTimeMatch, evaluateChallenge, nameMatches, normaliseStatedValue, normalisedHeldValue } from './identifier-matching';

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
    expect(normalisedHeldValue('name', record)).toBe('alex testpatient');
    expect(normaliseStatedValue('name', '  TESTPATIENT   alex ')).toBe('alex testpatient');
  });

  it('name_matches_in_either_order', () => {
    // The PMS holds family name first; a patient types given name first.
    expect(normaliseStatedValue('name', 'Alex Testpatient')).toBe(normalisedHeldValue('name', record));
    expect(normaliseStatedValue('name', 'Testpatient Alex')).toBe(normalisedHeldValue('name', record));
    // A different name with the same first token is still a mismatch.
    expect(normaliseStatedValue('name', 'Alex Other')).not.toBe(normalisedHeldValue('name', record));
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

describe('name rule — family name + first given name', () => {
  const held = { ...record, familyName: 'Sampleton', givenNames: 'Jamie Lee' };

  it('name_matches_on_family_and_first_given_in_any_order', () => {
    expect(nameMatches('Jamie Sampleton', held)).toBe(true);
    expect(nameMatches('Sampleton Jamie', held)).toBe(true);
    expect(nameMatches('Jamie Lee Sampleton', held)).toBe(true);
    expect(nameMatches('  JAMIE   sampleton ', held)).toBe(true);
  });

  it('fails when the family name or the first given name is missing', () => {
    expect(nameMatches('Lee Sampleton', held)).toBe(false);
    expect(nameMatches('Jamie Smith', held)).toBe(false);
    expect(nameMatches('Jamie', held)).toBe(false);
    expect(nameMatches('', held)).toBe(false);
  });

  it('treats hyphens and apostrophes as spaces, and keeps multi-word family names whole', () => {
    const hyphen = { ...record, familyName: 'Smith-Jones', givenNames: 'Pat' };
    expect(nameMatches('Pat Smith Jones', hyphen)).toBe(true);
    expect(nameMatches('Pat Smith', hyphen)).toBe(false);
    const dutch = { ...record, familyName: 'van der Berg', givenNames: 'Anna' };
    expect(nameMatches('Anna van der Berg', dutch)).toBe(true);
    expect(nameMatches('Anna Berg', dutch)).toBe(false);
  });

  it('applies through evaluateChallenge', () => {
    expect(evaluateChallenge(['name'] as never, { name: 'Jamie Sampleton' }, held)).toBe(true);
    expect(evaluateChallenge(['name'] as never, { name: 'Lee Sampleton' }, held)).toBe(false);
  });
});

describe('address rule — components, not formatting', () => {
  const held = { ...record, address: '2 Example Street, Sampletown NSW 2000' };

  it('address_matches_on_components_not_formatting', () => {
    // The same address, four ways somebody might give it. Punctuation, case
    // and spacing are formatting; the components are the identifier.
    expect(addressMatches('2 Example Street, Sampletown NSW 2000', held)).toBe(true);
    expect(addressMatches('2 Example Street Sampletown NSW 2000', held)).toBe(true);
    expect(addressMatches('  2   EXAMPLE  street,, sampletown  nsw  2000 ', held)).toBe(true);
    // A component the practice holds but the patient left out is not a failure.
    expect(addressMatches('2 Example Street Sampletown 2000', held)).toBe(true);
  });

  it('expands street-type abbreviations on both sides', () => {
    // The kiosk case: the patient types "St", the PMS holds "Street".
    expect(addressMatches('2 Example St Sampletown NSW 2000', held)).toBe(true);
    // ...and the reverse, where the practice is the one abbreviating.
    const abbreviated = { ...record, address: '7 Sample Rd, Sampletown NSW 2000' };
    expect(addressMatches('7 Sample Road Sampletown NSW 2000', abbreviated)).toBe(true);
    expect(addressMatches('7 Sample Rd Sampletown NSW 2000', abbreviated)).toBe(true);
    for (const [short, long] of [['Ave', 'Avenue'], ['Cres', 'Crescent'], ['Pde', 'Parade'], ['Tce', 'Terrace']]) {
      const heldShort = { ...record, address: `9 Sample ${short}, Sampletown NSW 2000` };
      expect(addressMatches(`9 Sample ${long} Sampletown NSW 2000`, heldShort)).toBe(true);
    }
  });

  it('fails without a postcode — containment alone is not an address', () => {
    expect(addressMatches('2 Example Street Sampletown NSW', held)).toBe(false);
    expect(addressMatches('NSW', held)).toBe(false);
    expect(addressMatches('Sampletown', held)).toBe(false);
    // A postcode with no street or unit number is equally not an address.
    expect(addressMatches('Sampletown NSW 2000', held)).toBe(false);
  });

  it('fails on a wrong street number', () => {
    expect(addressMatches('3 Example Street Sampletown NSW 2000', held)).toBe(false);
    // ...and on a wrong postcode, and a wrong street.
    expect(addressMatches('2 Example Street Sampletown NSW 2001', held)).toBe(false);
    expect(addressMatches('2 Other Street Sampletown NSW 2000', held)).toBe(false);
  });

  it('fails on a stated token the practice does not hold — country included', () => {
    // The kiosk collects a country and deliberately leaves it OUT of the
    // composed string, because the practice does not record one and the server
    // does not compare one. This is what would happen if it sent it anyway.
    expect(addressMatches('2 Example Street Sampletown NSW 2000 Australia', held)).toBe(false);
    expect(addressMatches('Unit 4 2 Example Street Sampletown NSW 2000', held)).toBe(false);
  });

  it('routes through evaluateChallenge the way the name rule does', () => {
    expect(evaluateChallenge(['address'] as never, { address: '2 Example St Sampletown NSW 2000' }, held)).toBe(true);
    expect(evaluateChallenge(['address'] as never, { address: '2 Example St Sampletown NSW' }, held)).toBe(false);
    // A record with no address on it can never match.
    expect(addressMatches('2 Example Street Sampletown NSW 2000', { ...record, address: null })).toBe(false);
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
