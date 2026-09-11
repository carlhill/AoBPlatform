/**
 * Retention — two years, as a SOFT setting (CONSULTATION-CAPTURE-PLAN.md Part 5).
 *
 * The rule already existed in words: "retention runs 2 years from the related
 * claim (REQ-REG-09, REQ-INT-04) — parameterised, never hardcoded"
 * (agreement.ts). This is the parameter and the arithmetic, in one place, so
 * that no writer inlines "+ 2 years" and no two writers disagree.
 *
 * SOFT means three things this codebase already believes: configurable (the
 * years come from configuration, validated here); content is removed but the
 * row survives (a tombstone, not a delete — Part 5 item 6); and `legalHold`
 * wins, always. This file owns only the first.
 */

export const RETENTION_YEARS_DEFAULT = 2;
export const RETENTION_YEARS_MIN = 1;
export const RETENTION_YEARS_MAX = 10;

/**
 * Turn a configured value into a number of years, refusing nonsense.
 *
 * A retention period is a compliance commitment; "0", "abc" or "" must not
 * silently become "keep for ever" or "delete today". Out of range falls back
 * to the default AND is reported, so a typo in an environment file is visible
 * rather than quietly changing what the platform keeps.
 */
export function parseRetentionYears(raw: string | number | null | undefined): {
  years: number;
  usedDefault: boolean;
  reason?: string;
} {
  if (raw === null || raw === undefined || raw === '') return { years: RETENTION_YEARS_DEFAULT, usedDefault: true };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n)) {
    return { years: RETENTION_YEARS_DEFAULT, usedDefault: true, reason: `"${raw}" is not a whole number of years.` };
  }
  if (n < RETENTION_YEARS_MIN || n > RETENTION_YEARS_MAX) {
    return {
      years: RETENTION_YEARS_DEFAULT,
      usedDefault: true,
      reason: `${n} is outside ${RETENTION_YEARS_MIN}–${RETENTION_YEARS_MAX} years.`,
    };
  }
  return { years: n, usedDefault: false };
}

/**
 * The date on which something anchored at `anchor` may have its content
 * removed. A DATE, not a timestamp: retention is counted in days by the
 * people who audit it, and a sweep runs once an hour.
 */
export function retentionExpiryFor(anchor: Date, years: number = RETENTION_YEARS_DEFAULT): Date {
  const out = new Date(Date.UTC(anchor.getUTCFullYear() + years, anchor.getUTCMonth(), anchor.getUTCDate()));
  return out;
}

/** Past expiry, and not held. Both conditions, always — a hold is not a longer expiry. */
export function isDueForRemoval(input: { retentionExpiryDate: Date | null; legalHold: boolean }, now: Date): boolean {
  if (input.legalHold) return false;
  if (!input.retentionExpiryDate) return false;
  return input.retentionExpiryDate.getTime() <= now.getTime();
}
