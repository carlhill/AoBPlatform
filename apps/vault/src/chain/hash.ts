import { createHash } from 'node:crypto';

/**
 * Canonical JSON serialisation: object keys sorted recursively, no whitespace.
 * The chain dies if two serialisations of the same event differ, so every
 * hash in the vault goes through this one function — never JSON.stringify
 * directly (property-order-dependent) and never a second implementation.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** The genesis predecessor hash for the first entry in a chain. */
export const GENESIS_HASH = '0'.repeat(64);

export interface HashableEntry {
  readonly id: string;
  readonly type: string;
  readonly actor: unknown;
  readonly subject: { readonly type: string; readonly id: string };
  readonly payload?: unknown;
  readonly recordedAt: string;
  readonly previousHash: string;
}

/** Computes an entry's hash over every field that must be tamper-evident, including its predecessor's hash (REQ-VAULT-01). */
export function computeEntryHash(entry: HashableEntry): string {
  return sha256Hex(
    canonicalJson({
      id: entry.id,
      type: entry.type,
      actor: entry.actor,
      subject: entry.subject,
      payload: entry.payload ?? {},
      recordedAt: entry.recordedAt,
      previousHash: entry.previousHash,
    }),
  );
}
