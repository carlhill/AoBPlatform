import type { VaultEventInput, VaultEventRecord } from '@aobplatform/contracts';
import type { IsoTimestamp } from '@aobplatform/domain';
import type { ChainStore } from './chain-store';

/**
 * ⚠ TODO(HUMAN) — HUMAN-AUTHORED ZONE (CLAUDE.md §7, build-plan policy).
 *
 * The production chain store: immudb-backed entries, per-entry signing with a
 * segregated HSM key (REQ-LOG-02), hourly Merkle root + RFC 3161 external
 * anchoring (REQ-LOG-03, REQ-VAULT-03), and S3 Object Lock artefact buckets.
 * Key ceremony and key management per REQ-VAULT-06.
 *
 * Must pass the SAME property tests as the reference store —
 * `chainStoreContractTests()` in ../../test/chain-store.contract.ts is written
 * against the ChainStore interface precisely so this implementation can be
 * dropped in and verified without new test code.
 *
 * Wiring notes for the implementer: immudb-node is already a dependency;
 * connection settings come from IMMUDB_* in .env.example; docker-compose runs
 * immudb 1.9.5 on host port 21022.
 */
export class ImmudbChainStore implements ChainStore {
  constructor() {
    throw new Error(
      'ImmudbChainStore is not implemented. It is a human-authored zone — see the TODO(HUMAN) note in this file. ' +
        'Use CHAIN_STORE=memory for development.',
    );
  }
  append(_event: VaultEventInput): Promise<VaultEventRecord> {
    return Promise.reject(new Error('not implemented'));
  }
  list(_query: { subjectId?: string; from?: IsoTimestamp; to?: IsoTimestamp }): Promise<readonly VaultEventRecord[]> {
    return Promise.reject(new Error('not implemented'));
  }
  all(): Promise<readonly VaultEventRecord[]> {
    return Promise.reject(new Error('not implemented'));
  }
  head(): Promise<VaultEventRecord | undefined> {
    return Promise.reject(new Error('not implemented'));
  }
  findByArtefactHash(_sha256: string): Promise<VaultEventRecord | undefined> {
    return Promise.reject(new Error('not implemented'));
  }
}
