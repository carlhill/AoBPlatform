/**
 * WHY A PLATFORM OPERATOR RE-BASELINED A PRACTICE'S AOBPRINTER CHAIN
 * (D-2026-10-10-02 decision 7; PRINTER-HEARTBEAT.md §3–§4).
 *
 * A regression (`aobPrinterChainVerdict`) stays flagged until somebody accepts
 * the host's chain afresh. That is the platform's act, never the practice's,
 * and it carries a reason from a fixed list. The list is VERSIONED CONTENT
 * (`content/aobprinter-rebaseline-reasons.json`, CLAUDE.md §7c): the console
 * renders it in file order with labels from the string table, and core refuses
 * a code that is not in it. Both read this loader, so they cannot drift.
 *
 * HAND-WRITTEN VALIDATION, NOT ZOD, for the reason `assignor-relationships.ts`
 * gives: this package has zero runtime dependencies. It runs at module load,
 * so a malformed edit fails the build and the test run, not the console.
 */
import content from '../content/aobprinter-rebaseline-reasons.json';

/** One reason. The string table is keyed by `key`; the key itself is what core stores and the vault event carries. */
export interface AobPrinterRebaselineReason {
  readonly key: string;
}

export interface AobPrinterRebaselineReasonContent {
  /** Bump on every edit. */
  readonly version: string;
  /** ORDER IS THE ORDER ON SCREEN. */
  readonly reasons: readonly AobPrinterRebaselineReason[];
}

/** Exhaustive, and it throws rather than repairing: a bad edit is a mistake to surface. */
export function parseAobPrinterRebaselineReasonContent(raw: unknown): AobPrinterRebaselineReasonContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/aobprinter-rebaseline-reasons.json is not usable: ${why}. This file is versioned content ` +
        '(CLAUDE.md §7c) and is validated at load so a bad edit fails the build rather than the console.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.reasons) || doc.reasons.length === 0) {
    return fail('`reasons` must be a non-empty array');
  }

  const seen = new Set<string>();
  const reasons = doc.reasons.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`reasons[${index}] is not an object`);
    const key = (entry as Record<string, unknown>).key;
    if (typeof key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(key)) {
      return fail(`reasons[${index}].key must be a lower_snake_case identifier`);
    }
    // The core DTO accepts reason codes matching ^[a-z0-9_]{1,40}$.
    if (key.length > 40) return fail(`reasons[${index}].key must be at most 40 characters`);
    if (seen.has(key)) return fail(`reasons[${index}].key "${key}" appears twice`);
    seen.add(key);
    return { key };
  });

  return { version: doc.version, reasons };
}

const parsed = parseAobPrinterRebaselineReasonContent(content);

/** The reasons, in file order, which is screen order. */
export const AOBPRINTER_REBASELINE_REASONS: readonly AobPrinterRebaselineReason[] = parsed.reasons;

/** The version of the list a re-baseline was made from. */
export const AOBPRINTER_REBASELINE_REASONS_VERSION: string = parsed.version;

/** Just the keys, in order — what a `<select>` and a DTO's `@IsIn` want. */
export const AOBPRINTER_REBASELINE_REASON_KEYS: readonly string[] = parsed.reasons.map((r) => r.key);

/** True only for a code the content file lists. */
export function isAobPrinterRebaselineReason(code: unknown): code is string {
  return typeof code === 'string' && AOBPRINTER_REBASELINE_REASON_KEYS.includes(code);
}
