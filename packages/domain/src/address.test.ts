import {
  AddressError,
  addressWarnings,
  assertAddressUsable,
  compareLocality,
  formatAddress,
  isKnownState,
  isValidPostcodeFormat,
  parseSingleLine,
  postcodeMatchesState,
  type StructuredAddress,
} from './address';

const address = (over: Partial<StructuredAddress> = {}): StructuredAddress => ({
  addressLine1: '1 Example Street',
  addressLine2: null,
  suburb: 'Sampletown',
  state: 'NSW',
  postcode: '2000',
  country: 'Australia',
  ...over,
});

describe('states and postcodes', () => {
  it('knows the eight states and territories', () => {
    for (const s of ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']) {
      expect(isKnownState(s)).toBe(true);
    }
    expect(isKnownState('ZZZ')).toBe(false);
  });

  it('accepts leading-zero postcodes — NT and ACT use them', () => {
    expect(isValidPostcodeFormat('0800')).toBe(true);
    expect(isValidPostcodeFormat('0200')).toBe(true);
    expect(postcodeMatchesState('0800', 'NT')).toBe(true);
    expect(postcodeMatchesState('0200', 'ACT')).toBe(true);
  });

  it('rejects anything that is not four digits', () => {
    for (const bad of ['200', '20000', '2a00', '', ' ']) {
      expect(isValidPostcodeFormat(bad)).toBe(false);
    }
  });

  it('places well-known postcodes in the right state', () => {
    expect(postcodeMatchesState('2000', 'NSW')).toBe(true);
    expect(postcodeMatchesState('3000', 'VIC')).toBe(true);
    expect(postcodeMatchesState('4000', 'QLD')).toBe(true);
    expect(postcodeMatchesState('5000', 'SA')).toBe(true);
    expect(postcodeMatchesState('6000', 'WA')).toBe(true);
    expect(postcodeMatchesState('7000', 'TAS')).toBe(true);
  });

  it('knows a NSW postcode is not a VIC one', () => {
    expect(postcodeMatchesState('2000', 'VIC')).toBe(false);
  });
});

describe('what a place of practice must have', () => {
  it('accepts a complete address', () => {
    expect(() => assertAddressUsable(address())).not.toThrow();
  });

  it('does not require line 2 — most addresses have none', () => {
    expect(() => assertAddressUsable(address({ addressLine2: null }))).not.toThrow();
  });

  it('requires line 1', () => {
    expect(() => assertAddressUsable(address({ addressLine1: '  ' }))).toThrow(/line 1 is required/);
  });

  it('requires a suburb, and says why', () => {
    expect(() => assertAddressUsable(address({ suburb: '' }))).toThrow(/AHPRA register and G-NAF match on/);
  });

  it('requires a state, and cites the holiday calendar', () => {
    expect(() => assertAddressUsable(address({ state: '' }))).toThrow(/public-holiday calendar/);
  });

  it('rejects a state that is not one', () => {
    expect(() => assertAddressUsable(address({ state: 'Middlesex' }))).toThrow(AddressError);
  });

  it('rejects a malformed postcode', () => {
    expect(() => assertAddressUsable(address({ postcode: '20' }))).toThrow(/four-digit/);
  });
});

describe('warnings never block', () => {
  it('flags a postcode outside its state ranges, but does not refuse it', () => {
    const odd = address({ state: 'VIC', postcode: '2000' });
    expect(() => assertAddressUsable(odd)).not.toThrow();
    const warning = addressWarnings(odd).find((w) => w.code === 'postcode_state_mismatch');
    expect(warning!.message).toMatch(/NOT A BLOCK/);
    expect(warning!.message).toMatch(/unverified/);
  });

  it('says nothing when the postcode fits the state', () => {
    expect(addressWarnings(address())).toHaveLength(0);
  });

  it('flags a non-Australian country', () => {
    const overseas = address({ country: 'New Zealand' });
    expect(addressWarnings(overseas).some((w) => w.code === 'non_australian')).toBe(true);
    expect(() => assertAddressUsable(overseas)).not.toThrow();
  });

  it('treats a missing country as Australia', () => {
    expect(addressWarnings(address({ country: null }))).toHaveLength(0);
  });
});

describe('formatting for the s 65C particulars', () => {
  it('renders a plain address', () => {
    expect(formatAddress(address())).toBe('1 Example Street, Sampletown NSW 2000');
  });

  it('puts the unit before the street, as Australians write it', () => {
    expect(formatAddress(address({ addressLine2: 'Unit 3' }))).toBe('Unit 3, 1 Example Street, Sampletown NSW 2000');
  });

  it('omits Australia, and includes anywhere else', () => {
    expect(formatAddress(address())).not.toContain('Australia');
    expect(formatAddress(address({ country: 'New Zealand' }))).toContain('New Zealand');
  });

  it('uppercases the state', () => {
    expect(formatAddress(address({ state: 'nsw' }))).toContain('NSW');
  });
});

describe('parsing a single line, lossily and honestly', () => {
  it('splits a well-formed address', () => {
    const parsed = parseSingleLine('1 Example Street, Sampletown NSW 2000');
    expect(parsed.parsed).toBe(true);
    expect(parsed.addressLine1).toBe('1 Example Street');
    expect(parsed.suburb).toBe('Sampletown');
    expect(parsed.state).toBe('NSW');
    expect(parsed.postcode).toBe('2000');
  });

  it('treats the first of two street parts as the unit', () => {
    const parsed = parseSingleLine('Unit 3, 1 Example Street, Sampletown NSW 2000');
    expect(parsed.addressLine2).toBe('Unit 3');
    expect(parsed.addressLine1).toBe('1 Example Street');
  });

  it('handles a multi-word suburb', () => {
    expect(parseSingleLine('9 Long Road, North Sampletown VIC 3000').suburb).toBe('North Sampletown');
  });

  it('GIVES UP RATHER THAN GUESSING when it cannot place the parts', () => {
    // A confidently wrong suburb is worse than an empty one — matching is the
    // entire purpose of these fields.
    for (const unparseable of ['somewhere over there', '', '1 Example Street', 'Sampletown 2000']) {
      expect(parseSingleLine(unparseable).parsed).toBe(false);
    }
  });

  it('round-trips through format for an address it could parse', () => {
    const original = '1 Example Street, Sampletown NSW 2000';
    const parsed = parseSingleLine(original);
    expect(formatAddress(parsed as StructuredAddress)).toBe(original);
  });
});

describe('comparing a practice address with the AHPRA principal place', () => {
  const practice = { suburb: 'Yagoona', postcode: '2199' };

  it('MATCHES — an independent regulator placed this person in this locality', () => {
    const result = compareLocality(practice, { suburb: 'YAGOONA', postcode: '2199' });
    expect(result.result).toBe('match');
    expect(result.message).toMatch(/independent regulator/);
  });

  it('ignores case and punctuation differences', () => {
    expect(compareLocality(practice, { suburb: ' yagoona. ', postcode: '2199' }).result).toBe('match');
  });

  it('reports a postcode-only agreement separately', () => {
    expect(compareLocality(practice, { suburb: 'Bankstown', postcode: '2199' }).result).toBe('postcode_only');
  });

  it('reports a suburb-only agreement, and notes suburb names repeat across states', () => {
    const result = compareLocality(practice, { suburb: 'Yagoona', postcode: '3000' });
    expect(result.result).toBe('suburb_only');
    expect(result.message).toMatch(/repeat across states/);
  });

  it('MISMATCH IS NOT A BLOCK — the register names only the PRINCIPAL place', () => {
    const result = compareLocality(practice, { suburb: 'Perth', postcode: '6000' });
    expect(result.result).toBe('mismatch');
    expect(result.message).toMatch(/NOT A BLOCK/);
    expect(result.message).toMatch(/work at several locations/);
  });

  it('but says plainly what a mismatch means when the person is offered as proof', () => {
    const result = compareLocality(practice, { suburb: 'Perth', postcode: '6000' });
    expect(result.message).toMatch(/proof of somewhere else/);
  });

  it('says so when there is nothing to compare', () => {
    expect(compareLocality(practice, {}).result).toBe('insufficient_data');
    expect(compareLocality({ suburb: '', postcode: '' }, { suburb: 'Perth' }).result).toBe('insufficient_data');
  });
});
