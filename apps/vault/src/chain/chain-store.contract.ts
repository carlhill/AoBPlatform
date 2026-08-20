import type { VaultEventInput } from '@aobplatform/contracts';
import type { ChainStore } from './chain-store';
import { verifyChainSegment } from './verify';

/**
 * Contract test suite every ChainStore implementation must pass — written
 * against the interface so the human-authored ImmudbChainStore drops in with
 * zero new test code (see the TODO(HUMAN) note there). Call from a describe
 * block with a factory for a FRESH store per test.
 */
export function chainStoreContractTests(makeStore: () => ChainStore | Promise<ChainStore>): void {
  const event = (i: number, extra?: Record<string, string | number | boolean>): VaultEventInput => ({
    type: 'agreement.created',
    actor: { principalType: 'system', id: 'core' },
    subject: { type: 'Agreement', id: `agr-${i}` },
    payload: { seq: i, ...extra },
  });

  it('chains every entry to its predecessor and the whole chain verifies', async () => {
    const store = await makeStore();
    for (let i = 0; i < 25; i++) await store.append(event(i));
    const all = await store.all();
    expect(all).toHaveLength(25);
    expect(verifyChainSegment(all).valid).toBe(true);
  });

  it('serialises concurrent appends into one unbroken chain', async () => {
    const store = await makeStore();
    await Promise.all(Array.from({ length: 40 }, (_, i) => store.append(event(i))));
    const all = await store.all();
    expect(all).toHaveLength(40);
    expect(verifyChainSegment(all).valid).toBe(true);
    // exactly one head: previousHash values are unique (no forked tips)
    const previousHashes = all.map((e) => e.previousHash);
    expect(new Set(previousHashes).size).toBe(previousHashes.length);
  });

  it('filters by subject without breaking record integrity', async () => {
    const store = await makeStore();
    for (let i = 0; i < 6; i++) await store.append(event(i % 2));
    const forSubject = await store.list({ subjectId: 'agr-1' });
    expect(forSubject).toHaveLength(3);
    expect(forSubject.every((e) => e.subject.id === 'agr-1')).toBe(true);
  });

  it('finds an artefact-bearing event by hash and returns metadata only', async () => {
    const store = await makeStore();
    const artefactSha256 = 'b'.repeat(64);
    await store.append(event(0));
    await store.append(event(1, { artefactSha256 }));
    const found = await store.findByArtefactHash(artefactSha256);
    expect(found?.subject.id).toBe('agr-1');
    expect(await store.findByArtefactHash('c'.repeat(64))).toBeUndefined();
  });

  it('reports the latest entry as head', async () => {
    const store = await makeStore();
    expect(await store.head()).toBeUndefined();
    await store.append(event(0));
    const last = await store.append(event(1));
    expect((await store.head())?.id).toBe(last.id);
  });
}
