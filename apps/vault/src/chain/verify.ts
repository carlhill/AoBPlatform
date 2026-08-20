import type { VaultEventRecord } from '@aobplatform/contracts';
import { computeEntryHash, GENESIS_HASH } from './hash';

export interface ChainVerificationResult {
  readonly valid: boolean;
  /** Index of the first broken entry, when invalid. */
  readonly brokenAtIndex?: number;
  readonly reason?: string;
}

/**
 * Recomputes and verifies a chain segment: every entry's hash must match its
 * recomputed value, and every entry's previousHash must equal its
 * predecessor's hash (the first entry links to the supplied anchor, or
 * genesis). This is the same routine the continuous chain-verifier job, the
 * auditor bundle's offline verifier, and the property tests all use — one
 * implementation, three callers (REQ-VAULT-01, REQ-LOG-06).
 */
export function verifyChainSegment(
  records: readonly VaultEventRecord[],
  precedingHash: string = GENESIS_HASH,
): ChainVerificationResult {
  let expectedPrevious = precedingHash;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.previousHash !== expectedPrevious) {
      return {
        valid: false,
        brokenAtIndex: i,
        reason: `entry ${record.id} links to ${record.previousHash.slice(0, 12)}… but predecessor hash is ${expectedPrevious.slice(0, 12)}…`,
      };
    }
    const recomputed = computeEntryHash(record);
    if (recomputed !== record.hash) {
      return {
        valid: false,
        brokenAtIndex: i,
        reason: `entry ${record.id} hash mismatch — content altered after write`,
      };
    }
    expectedPrevious = record.hash;
  }
  return { valid: true };
}
