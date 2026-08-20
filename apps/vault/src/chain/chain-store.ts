import type { VaultEventInput, VaultEventRecord } from '@aobplatform/contracts';
import type { IsoTimestamp } from '@aobplatform/domain';

/**
 * Storage abstraction for the append-only chain. Note the shape: append and
 * read only. No store implementation may expose update or delete — the
 * interface is the contract (rule 11, ADR A-02).
 */
export interface ChainStore {
  append(event: VaultEventInput): Promise<VaultEventRecord>;
  list(query: { subjectId?: string; from?: IsoTimestamp; to?: IsoTimestamp }): Promise<readonly VaultEventRecord[]>;
  /** Full-chain read for the continuous verifier and auditor export. */
  all(): Promise<readonly VaultEventRecord[]>;
  head(): Promise<VaultEventRecord | undefined>;
  findByArtefactHash(sha256: string): Promise<VaultEventRecord | undefined>;
}

export const CHAIN_STORE = Symbol('CHAIN_STORE');
