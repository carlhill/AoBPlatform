/**
 * Chain-verifier property tests (tech stack §"chain-verifier property tests").
 * Any mutation of any field of any entry, any reordering, and any deletion
 * must break verification from that point forward, permanently and visibly
 * (REQ-VAULT-01, REQ-LOG-01).
 */
import type { VaultEventRecord } from '@aobplatform/contracts';
import { InMemoryChainStore } from './in-memory-chain-store';
import { chainStoreContractTests } from './chain-store.contract';
import { verifyChainSegment } from './verify';
import { canonicalJson, computeEntryHash, sha256Hex } from './hash';

describe('InMemoryChainStore (reference) — ChainStore contract', () => {
  chainStoreContractTests(() => new InMemoryChainStore());
});

describe('canonical hashing', () => {
  it('is key-order independent and whitespace-free', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 4] } })).toBe('{"a":{"c":[3,4],"d":2},"b":1}');
    expect(sha256Hex(canonicalJson({ x: 1, y: 2 }))).toBe(sha256Hex(canonicalJson({ y: 2, x: 1 })));
  });

  it('produces different hashes for different content', () => {
    expect(sha256Hex(canonicalJson({ x: 1 }))).not.toBe(sha256Hex(canonicalJson({ x: 2 })));
  });
});

describe('tamper evidence properties', () => {
  async function buildChain(length: number): Promise<VaultEventRecord[]> {
    const store = new InMemoryChainStore();
    for (let i = 0; i < length; i++) {
      await store.append({
        type: i % 2 === 0 ? 'agreement.created' : 'agreement.signed',
        actor: { principalType: 'staff', id: `staff-${i % 3}` },
        subject: { type: 'Agreement', id: `agr-${i}` },
        payload: { seq: i, artefactSha256: sha256Hex(`artefact-${i}`) },
      });
    }
    return [...(await store.all())];
  }

  const TAMPERABLE_FIELDS: Array<[string, (e: VaultEventRecord) => VaultEventRecord]> = [
    ['type', (e) => ({ ...e, type: 'agreement.ceased' })],
    ['actor', (e) => ({ ...e, actor: { principalType: 'staff', id: 'attacker' } })],
    ['subject', (e) => ({ ...e, subject: { ...e.subject, id: 'agr-other' } })],
    ['payload', (e) => ({ ...e, payload: { ...(e.payload as object), seq: 999 } })],
    ['recordedAt', (e) => ({ ...e, recordedAt: '2020-01-01T00:00:00.000Z' as never })],
    ['previousHash', (e) => ({ ...e, previousHash: sha256Hex('forged') })],
  ];

  it.each(TAMPERABLE_FIELDS)('altering %s of any entry breaks verification at that entry', async (_field, tamper) => {
    const chain = await buildChain(10);
    for (const index of [0, 4, 9]) {
      const tampered = chain.map((e, i) => (i === index ? tamper(e) : e));
      const result = verifyChainSegment(tampered);
      expect(result.valid).toBe(false);
      expect(result.brokenAtIndex).toBeLessThanOrEqual(index);
    }
  });

  it('re-hashing a tampered entry still breaks the chain at the NEXT link', async () => {
    // A smarter attacker recomputes the tampered entry's own hash. The
    // successor's previousHash no longer matches, so the break just moves one
    // link forward — rewriting history requires rewriting every subsequent
    // entry, which external anchoring then defeats (REQ-LOG-03).
    const chain = await buildChain(10);
    const index = 4;
    const altered = { ...chain[index], payload: { seq: 999 } };
    const rehashed = { ...altered, hash: computeEntryHash(altered) };
    const tampered = chain.map((e, i) => (i === index ? rehashed : e));
    const result = verifyChainSegment(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(index + 1);
  });

  it('deleting any interior entry breaks verification', async () => {
    const chain = await buildChain(10);
    for (const index of [0, 5, 8]) {
      const withDeletion = chain.filter((_, i) => i !== index);
      expect(verifyChainSegment(withDeletion).valid).toBe(false);
    }
  });

  it('truncating the tail passes segment verification — detection REQUIRES the anchored head (REQ-LOG-03)', async () => {
    // This is the honest limit of a bare hash chain, stated as a test so
    // nobody "optimises away" external anchoring: chop the newest entries off
    // and the remaining chain still verifies. What catches truncation is
    // comparing the surviving head against the externally anchored head hash
    // held by a third party — which is why anchoring is what converts
    // tamper-evident into non-repudiable.
    const chain = await buildChain(10);
    const anchoredHeadHash = chain[chain.length - 1].hash;
    const truncated = chain.slice(0, 7);
    expect(verifyChainSegment(truncated).valid).toBe(true);
    expect(truncated[truncated.length - 1].hash).not.toBe(anchoredHeadHash);
  });

  it('reordering entries breaks verification', async () => {
    const chain = await buildChain(10);
    const swapped = [...chain];
    [swapped[3], swapped[6]] = [swapped[6], swapped[3]];
    expect(verifyChainSegment(swapped).valid).toBe(false);
  });

  it('inserting a forged entry breaks verification', async () => {
    const chain = await buildChain(6);
    const forgedBase = {
      id: 'forged-id',
      type: 'agreement.signed',
      actor: { principalType: 'staff', id: 'attacker' },
      subject: { type: 'Agreement', id: 'agr-forged' },
      payload: {},
      recordedAt: chain[3].recordedAt,
      previousHash: chain[2].hash,
    };
    const forged = { ...forgedBase, hash: computeEntryHash(forgedBase) } as unknown as VaultEventRecord;
    const withInsertion = [...chain.slice(0, 3), forged, ...chain.slice(3)];
    expect(verifyChainSegment(withInsertion).valid).toBe(false);
  });

  it('a segment verifies against its preceding anchor hash', async () => {
    const chain = await buildChain(10);
    const segment = chain.slice(4);
    expect(verifyChainSegment(segment, chain[3].hash).valid).toBe(true);
    expect(verifyChainSegment(segment, sha256Hex('wrong-anchor')).valid).toBe(false);
  });
});
