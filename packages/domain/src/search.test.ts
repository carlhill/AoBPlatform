import { matchesFilter, matchesPractice } from './search';

const riverbank = {
  name: 'Riverbank Family Practice',
  legalName: 'Sample Medical Holdings Pty Ltd',
  tradingNames: ['Riverbank Medical'],
  abn: '27734610304',
  acn: '004085616',
  adminName: 'Carl HILL',
  adminEmail: 'carl@hillsempire.com',
  adminPhone: '0408169971',
  managerName: 'Audrey Hill',
  managerEmail: 'audrey@hillsempire.com',
  managerPhone: '0298884321',
  validationState: 'validated',
};

describe('matchesPractice', () => {
  it('matches an empty query, so an empty box is not a filter', () => {
    expect(matchesPractice('', riverbank)).toBe(true);
    expect(matchesPractice('   ', riverbank)).toBe(true);
  });

  it('matches part of the trading name', () => {
    expect(matchesPractice('riverbank', riverbank)).toBe(true);
    expect(matchesPractice('RIVERBANK', riverbank)).toBe(true);
  });

  it('matches the legal name, which is often what an invoice shows', () => {
    expect(matchesPractice('sample medical', riverbank)).toBe(true);
  });

  // The normalisation is the feature: an ABN is printed spaced and typed
  // unspaced, and a search that fails on that answers "nothing found" to a
  // question whose answer is on the screen.
  it('matches an ABN however it is spaced', () => {
    expect(matchesPractice('27734610304', riverbank)).toBe(true);
    expect(matchesPractice('27 734 610 304', riverbank)).toBe(true);
    expect(matchesPractice('734 610', riverbank)).toBe(true);
  });

  it('matches a phone in any format', () => {
    expect(matchesPractice('0408169971', riverbank)).toBe(true);
    expect(matchesPractice('0408 169 971', riverbank)).toBe(true);
    expect(matchesPractice('+61 408 169 971', riverbank)).toBe(true);
  });

  it('matches the MANAGER as well as the applicant', () => {
    expect(matchesPractice('audrey', riverbank)).toBe(true);
    expect(matchesPractice('audrey@hillsempire', riverbank)).toBe(true);
    expect(matchesPractice('0298884321', riverbank)).toBe(true);
  });

  it('matches a partial email, which is how people search a thread', () => {
    expect(matchesPractice('hillsempire.com', riverbank)).toBe(true);
    expect(matchesPractice('CARL@', riverbank)).toBe(true);
  });

  it('does not match something absent', () => {
    expect(matchesPractice('sampletown', riverbank)).toBe(false);
    expect(matchesPractice('99999999999', riverbank)).toBe(false);
  });

  it('refuses to treat one digit as a search — that is the list with extra steps', () => {
    expect(matchesPractice('7', riverbank)).toBe(false);
  });

  it('matches text OR digits when a query has both', () => {
    // Requiring both would refuse a half-remembered name beside a part number.
    expect(matchesPractice('riverbank 0408', riverbank)).toBe(true);
  });

  it('copes with a practice missing most of its fields', () => {
    expect(matchesPractice('anything', { name: null, abn: null })).toBe(false);
    expect(matchesPractice('', { name: null })).toBe(true);
  });
});

describe('matchesFilter', () => {
  it('lets everything through on all', () => {
    expect(matchesFilter('all', { validationState: 'rejected', ready: null })).toBe(true);
  });

  it('separates being reviewed from decided', () => {
    expect(matchesFilter('being_reviewed', { validationState: 'pending' })).toBe(true);
    expect(matchesFilter('being_reviewed', { validationState: 'validated', ready: true })).toBe(false);
  });

  it('counts an approved practice that cannot capture as needing work', () => {
    expect(matchesFilter('needs_work', { validationState: 'validated', ready: false })).toBe(true);
    expect(matchesFilter('capturing', { validationState: 'validated', ready: false })).toBe(false);
  });

  /*
   * Unknown readiness belongs with what needs attention, not with what is
   * confirmed working. Looking at a healthy practice costs a moment; overlooking
   * a stalled one costs a fortnight.
   */
  it('puts UNKNOWN readiness with what needs work', () => {
    expect(matchesFilter('needs_work', { validationState: 'validated', ready: null })).toBe(true);
    expect(matchesFilter('capturing', { validationState: 'validated', ready: null })).toBe(false);
  });

  it('never counts an unapproved practice as capturing', () => {
    expect(matchesFilter('capturing', { validationState: 'pending', ready: true })).toBe(false);
  });

  it('finds a refused application', () => {
    expect(matchesFilter('not_approved', { validationState: 'rejected' })).toBe(true);
  });
});
