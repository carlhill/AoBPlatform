import { RETENTION_YEARS_DEFAULT, isDueForRemoval, parseRetentionYears, retentionExpiryFor } from './retention';

describe('retention — two years, as a soft setting', () => {
  it('defaults to two years', () => {
    expect(RETENTION_YEARS_DEFAULT).toBe(2);
    expect(parseRetentionYears(undefined)).toEqual({ years: 2, usedDefault: true });
    expect(parseRetentionYears('')).toEqual({ years: 2, usedDefault: true });
  });

  it('accepts a configured whole number of years', () => {
    expect(parseRetentionYears('3')).toEqual({ years: 3, usedDefault: false });
    expect(parseRetentionYears(7)).toEqual({ years: 7, usedDefault: false });
  });

  it('refuses nonsense and says why, rather than keeping for ever or deleting today', () => {
    expect(parseRetentionYears('0').usedDefault).toBe(true);
    expect(parseRetentionYears('abc').reason).toMatch(/whole number/);
    expect(parseRetentionYears('2.5').reason).toMatch(/whole number/);
    expect(parseRetentionYears('11').reason).toMatch(/outside/);
  });

  it('computes the expiry as a date, years after the anchor', () => {
    const expiry = retentionExpiryFor(new Date('2026-08-25T14:33:00Z'));
    expect(expiry.toISOString()).toBe('2028-08-25T00:00:00.000Z');
    expect(retentionExpiryFor(new Date('2026-02-28T00:00:00Z'), 3).toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });

  it('is due only when past expiry AND not held — a hold is not a longer expiry', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const past = new Date('2028-08-25T00:00:00Z');
    expect(isDueForRemoval({ retentionExpiryDate: past, legalHold: false }, now)).toBe(true);
    expect(isDueForRemoval({ retentionExpiryDate: past, legalHold: true }, now)).toBe(false);
    expect(isDueForRemoval({ retentionExpiryDate: null, legalHold: false }, now)).toBe(false);
    expect(isDueForRemoval({ retentionExpiryDate: new Date('2031-01-01T00:00:00Z'), legalHold: false }, now)).toBe(false);
  });
});
