import type { PmsAdapter } from '@aobplatform/contracts';
import { MockPmsAdapter } from './mock-adapter';

describe('MockPmsAdapter (FR-9.1 contract)', () => {
  it('declares capabilities, with claimEvents conservatively absent (REQ-INT-04)', () => {
    const adapter: PmsAdapter = new MockPmsAdapter();
    expect(adapter.capabilities.writeArtefact).toBe(true);
    expect(adapter.capabilities.claimEvents).toBe(false);
    expect(adapter.claimEvents).toBeUndefined();
  });

  it('write-back is idempotent by artefact hash (FR-9.3)', async () => {
    const adapter = new MockPmsAdapter();
    const request = {
      patientLinkageKey: 'mock-pat-001',
      artefact: new Uint8Array([1, 2, 3]),
      artefactSha256: 'a'.repeat(64),
      filename: 'agreement.pdf',
      description: 'Signed AoB agreement',
    };
    const first = await adapter.writeArtefact(request);
    const second = await adapter.writeArtefact(request);
    expect(first.written).toBe(true);
    expect(second.written).toBe(false);
    expect(second.pmsDocumentKey).toBe(first.pmsDocumentKey);
  });

  it('fixture patients carry no Medicare-format numbers (fixture rule, HARD-03)', async () => {
    const adapter = new MockPmsAdapter();
    const patient = await adapter.readPatient('mock-pat-001');
    expect(JSON.stringify(patient)).not.toMatch(/\b[2-6]\d{9}\b/);
  });
});
