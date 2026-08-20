import { randomUUID } from 'node:crypto';
import type { VaultEventInput, VaultEventRecord } from '@aobplatform/contracts';
import type { IsoTimestamp, VaultEventId } from '@aobplatform/domain';
import type { ChainStore } from './chain-store';
import { computeEntryHash, GENESIS_HASH } from './hash';

/**
 * ⚠ DEV/TEST ONLY reference implementation. It exists so apps/core can be
 * developed and the chain semantics property-tested before the production
 * store lands. It is NOT tamper-evident at rest (it is process memory) and is
 * never selected outside CHAIN_STORE=memory.
 *
 * The production ImmudbChainStore (immudb + WORM artefact buckets + RFC 3161
 * anchoring + HSM-held signing keys) is a HUMAN-AUTHORED ZONE — see
 * ./immudb-chain-store.ts.
 */
export class InMemoryChainStore implements ChainStore {
  private readonly entries: VaultEventRecord[] = [];
  private appending: Promise<unknown> = Promise.resolve();

  append(event: VaultEventInput): Promise<VaultEventRecord> {
    // Serialise appends — a hash chain has exactly one head at a time.
    const result = this.appending.then(() => {
      const previous = this.entries[this.entries.length - 1];
      const base = {
        id: randomUUID() as string as VaultEventId,
        type: event.type,
        actor: event.actor,
        subject: event.subject,
        payload: event.payload ?? {},
        recordedAt: new Date().toISOString() as IsoTimestamp,
        previousHash: previous ? previous.hash : GENESIS_HASH,
      };
      const record: VaultEventRecord = { ...base, hash: computeEntryHash(base) };
      this.entries.push(record);
      return record;
    });
    this.appending = result.catch(() => undefined);
    return result;
  }

  async list(query: {
    subjectId?: string;
    from?: IsoTimestamp;
    to?: IsoTimestamp;
  }): Promise<readonly VaultEventRecord[]> {
    return this.entries.filter(
      (e) =>
        (query.subjectId === undefined || e.subject.id === query.subjectId) &&
        (query.from === undefined || e.recordedAt >= query.from) &&
        (query.to === undefined || e.recordedAt <= query.to),
    );
  }

  async all(): Promise<readonly VaultEventRecord[]> {
    return [...this.entries];
  }

  async head(): Promise<VaultEventRecord | undefined> {
    return this.entries[this.entries.length - 1];
  }

  async findByArtefactHash(sha256: string): Promise<VaultEventRecord | undefined> {
    // Artefact-bearing events carry the artefact's hash in payload.artefactSha256
    // (content-free — a hash discloses nothing; REQ-VAULT-09).
    return this.entries.find((e) => (e.payload as Record<string, unknown>)?.artefactSha256 === sha256);
  }
}
