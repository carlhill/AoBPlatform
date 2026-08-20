import { CanonicalJsonRenderer } from './renderer';
import { DeterministicPdfRenderer } from './pdf-renderer';
import { RendererRegistry } from './renderer-registry';

const PARTICULARS = {
  patientName: 'Alex Testpatient',
  agreementDate: '2026-09-01',
  agreementType: 'episodic_pre',
  serviceDate: '2026-09-01',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
};

describe('render_determinism (rule 13) — every registered renderer', () => {
  it.each([
    ['canonical-json', new CanonicalJsonRenderer()],
    ['pdf', new DeterministicPdfRenderer()],
  ])('%s renders the same content byte-identically, twice', async (_name, renderer) => {
    const first = await renderer.render(PARTICULARS, ['en']);
    const second = await renderer.render({ ...PARTICULARS }, ['en']);
    expect(second.sha256).toBe(first.sha256);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    const different = await renderer.render({ ...PARTICULARS, serviceDate: '2026-09-02' }, ['en']);
    expect(different.sha256).not.toBe(first.sha256);
  });

  it('the pdf renderer emits a real PDF, wall-clock-independent', async () => {
    const renderer = new DeterministicPdfRenderer();
    const first = await renderer.render(PARTICULARS, ['en']);
    expect(first.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(first.mediaType).toBe('application/pdf');
    // No wall-clock leakage: waiting across a second must not change the bytes.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const later = await renderer.render(PARTICULARS, ['en']);
    expect(later.sha256).toBe(first.sha256);
  });
});

describe('RendererRegistry (rule 13/14 — renderers are versioned content)', () => {
  it('current is the pdf renderer; every historical version stays resolvable', () => {
    const registry = new RendererRegistry();
    expect(registry.currentVersion).toBe(DeterministicPdfRenderer.VERSION);
    expect(registry.get(CanonicalJsonRenderer.VERSION)).toBeDefined();
    expect(registry.get(DeterministicPdfRenderer.VERSION)).toBeDefined();
    expect(registry.get('no-such-version')).toBeUndefined();
  });
});
