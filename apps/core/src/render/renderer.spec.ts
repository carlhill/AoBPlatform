import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { genericAgreementTemplate, renderAgreementTemplate } from '@aobplatform/domain';
import { CanonicalJsonRenderer } from './renderer';
import { DeterministicPdfRenderer } from './pdf-renderer';
import { AgreementPdfRenderer } from './agreement-pdf-renderer';
import { RendererRegistry, renderInputOf } from './renderer-registry';
import { RenderRefusal, letterheadHashOf, type AgreementDocument } from './agreement-document';
import type { LogoLoader } from './logo-loader';
import { extractText } from '../artefacts/extract-text';

const PARTICULARS = {
  patientName: 'Alex Testpatient',
  agreementDate: '2026-09-01',
  agreementType: 'episodic_pre',
  serviceDate: '2026-09-01',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
};

const PRACTICE_ID = '00000000-0000-4000-8000-00000000ffff';

const LETTERHEAD = {
  legalName: 'Testville Family Medical Pty Ltd',
  tradingName: 'Testville Family Medical',
  address: '1 Test Street, Testville NSW 2000',
  phone: '(02) 5550 0000',
  email: 'reception@testville.example',
  abn: '12 345 678 901',
};

/**
 * A REAL PNG, built here rather than checked in as a fixture. pdfkit decodes
 * the image properly, so a plausible-looking byte string is not enough — and a
 * generated one keeps the test honest about what "embedded verbatim" means.
 */
function greyPng(size: number, shade: number): Buffer {
  const raw = Buffer.alloc(size * (size + 1), shade);
  for (let row = 0; row < size; row += 1) raw[row * (size + 1)] = 0; // filter: none
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const LOGO_BYTES = greyPng(32, 0x40);
const LOGO_SHA = createHash('sha256').update(LOGO_BYTES).digest('hex');

const logos: LogoLoader = {
  load: async (_practiceId: string, sha256: string) => (sha256 === LOGO_SHA ? LOGO_BYTES : null),
};

function documentFor(overrides: Partial<AgreementDocument> = {}): AgreementDocument {
  const template = renderAgreementTemplate(genericAgreementTemplate('episodic'), {
    values: {
      patientName: 'Alex Testpatient',
      agreementDate: '1 September 2026',
      providerDetails: 'Dr Sam Example, 1 Test Street, Testville NSW 2000',
      providerName: 'Dr Sam Example',
      serviceDate: '1 September 2026',
      basicServiceDescription: 'General practitioner attendance',
      mbsItemNumbers: '—',
      mappingVersion: 'mapping-test-1',
      assignorName: 'Robin Testperson',
      assignorRelationship: 'mother',
      enduringPathway: '—',
      coveredServiceScope: '—',
      notificationMethod: '—',
      terminationMethod: '—',
      commencementDate: '1 September 2026',
    },
    conditions: { assignorIsPatient: true, isPreAgreement: true },
  });
  const letterhead = overrides.letterhead ?? LETTERHEAD;
  return {
    practiceId: PRACTICE_ID,
    particulars: PARTICULARS,
    letterhead,
    letterheadHash: letterheadHashOf(letterhead),
    template,
    draftMarker: false,
    ...overrides,
  };
}

/** Every renderer's payload, in the one shape each of them understands. */
const RENDERERS: ReadonlyArray<readonly [string, { render: (p: Record<string, unknown>, l: readonly string[]) => Promise<{ sha256: string; bytes: Buffer }> }, Record<string, unknown>, Record<string, unknown>]> = [
  ['canonical-json', new CanonicalJsonRenderer(), PARTICULARS, { ...PARTICULARS, serviceDate: '2026-09-02' }],
  ['pdf-1', new DeterministicPdfRenderer(), PARTICULARS, { ...PARTICULARS, serviceDate: '2026-09-02' }],
  [
    'pdf-2',
    new AgreementPdfRenderer(logos),
    documentFor() as unknown as Record<string, unknown>,
    documentFor({ particulars: { ...PARTICULARS, serviceDate: '2026-09-02' } }) as unknown as Record<string, unknown>,
  ],
];

describe('two_renders_of_one_agreement_are_byte_identical (rule 13) — every registered renderer', () => {
  it.each(RENDERERS)('%s renders the same content byte-identically, twice', async (_name, renderer, payload, changed) => {
    const first = await renderer.render(payload, ['en']);
    const second = await renderer.render(structuredClone(payload), ['en']);
    expect(second.sha256).toBe(first.sha256);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    const different = await renderer.render(changed, ['en']);
    expect(different.sha256).not.toBe(first.sha256);
  });

  it('the current renderer emits a real PDF, wall-clock-independent', async () => {
    const renderer = new AgreementPdfRenderer(logos);
    const first = await renderer.render(documentFor() as unknown as Record<string, unknown>, ['en']);
    expect(first.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(first.mediaType).toBe('application/pdf');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const later = await renderer.render(documentFor() as unknown as Record<string, unknown>, ['en']);
    expect(later.sha256).toBe(first.sha256);
  });

  /**
   * THE 4 SEPTEMBER FAULT, PINNED. Correcting a detail that the render did not
   * carry changed no byte, so the hash could not detect it. Every element of
   * the letterhead is part of the hashed document now, and this is the test
   * that says a phone number moving moves the bytes.
   */
  it('a change to any letterhead field changes the bytes', async () => {
    const renderer = new AgreementPdfRenderer(logos);
    const base = await renderer.render(documentFor() as unknown as Record<string, unknown>, ['en']);
    for (const field of ['legalName', 'tradingName', 'address', 'phone', 'email', 'abn'] as const) {
      const letterhead = { ...LETTERHEAD, [field]: `${LETTERHEAD[field]} (changed)` };
      const moved = await renderer.render(
        documentFor({ letterhead, letterheadHash: letterheadHashOf(letterhead) }) as unknown as Record<string, unknown>,
        ['en'],
      );
      expect(moved.sha256).not.toBe(base.sha256);
    }
  });

  it('the logo is embedded verbatim, and the same logo renders the same bytes', async () => {
    const renderer = new AgreementPdfRenderer(logos);
    const letterhead = { ...LETTERHEAD, logoSha256: LOGO_SHA, logoContentType: 'image/png' };
    const document = documentFor({ letterhead, letterheadHash: letterheadHashOf(letterhead) });
    const first = await renderer.render(document as unknown as Record<string, unknown>, ['en']);
    const second = await renderer.render(structuredClone(document) as unknown as Record<string, unknown>, ['en']);
    expect(second.sha256).toBe(first.sha256);
    // And with no logo the page is different — the mark is really on it.
    const without = await renderer.render(documentFor() as unknown as Record<string, unknown>, ['en']);
    expect(without.sha256).not.toBe(first.sha256);
  });

  it('refuses the render when a declared logo cannot be produced', async () => {
    const renderer = new AgreementPdfRenderer(logos);
    const letterhead = { ...LETTERHEAD, logoSha256: 'f'.repeat(64) };
    await expect(
      renderer.render(
        documentFor({ letterhead, letterheadHash: letterheadHashOf(letterhead) }) as unknown as Record<string, unknown>,
        ['en'],
      ),
    ).rejects.toThrow(/could not be produced/);
  });
});

describe('render_carries_the_full_data_set_and_letterhead', () => {
  it('draws the letterhead, the whole s 65C data set and the statements', async () => {
    const renderer = new AgreementPdfRenderer(logos);
    const { bytes } = await renderer.render(documentFor() as unknown as Record<string, unknown>, ['en']);
    const text = extractText(new Uint8Array(bytes), 'application/pdf');
    expect(text).not.toBeNull();
    const page = (text ?? '').replace(/\s+/g, ' ');

    // Letterhead
    expect(page).toContain('Testville Family Medical Pty Ltd');
    expect(page).toContain('1 Test Street, Testville NSW 2000');
    expect(page).toContain('(02) 5550 0000');
    expect(page).toContain('reception@testville.example');
    expect(page).toContain('ABN 12 345 678 901');

    // D1, D2, D3, D4, D5, D6a, D7
    expect(page).toContain('Alex Testpatient'); // D1
    expect(page).toContain('1 September 2026'); // D2 and D5
    expect(page).toContain('before the service is provided'); // D3
    expect(page).toContain('Dr Sam Example'); // D4
    expect(page).toContain('General practitioner attendance'); // D6a
    expect(page).toContain('The patient is signing this agreement'); // D7

    // The statements the assignor ticked, and the provenance line.
    expect(page).toContain('I assign my right to the Medicare benefit');
    expect(page).toContain('Template episodic-generic-1');
    expect(page).toContain('Checked against the s 65C data set (self-assessment)');
  });

  it('renders the enduring content set instead for an ongoing agreement', async () => {
    const template = renderAgreementTemplate(genericAgreementTemplate('enduring'), {
      values: {
        patientName: 'Alex Testpatient',
        agreementDate: '1 September 2026',
        providerDetails: 'Dr Sam Example, 1 Test Street, Testville NSW 2000',
        providerName: 'Dr Sam Example',
        serviceDate: '—',
        basicServiceDescription: '—',
        mbsItemNumbers: '—',
        mappingVersion: 'mapping-test-1',
        assignorName: 'Robin Testperson',
        assignorRelationship: 'mother',
        enduringPathway: 'MyMedicare',
        coveredServiceScope: 'MBS Group A1 — General practitioner attendances',
        notificationMethod: 'email',
        terminationMethod: 'in writing to the practice',
        commencementDate: '1 September 2026',
      },
      conditions: { assignorIsPatient: true, isPreAgreement: false },
    });
    const renderer = new AgreementPdfRenderer(logos);
    const { bytes } = await renderer.render(
      documentFor({ template, particulars: { ...PARTICULARS, agreementType: 'enduring' } }) as unknown as Record<
        string,
        unknown
      >,
      ['en'],
    );
    const page = (extractText(new Uint8Array(bytes), 'application/pdf') ?? '').replace(/\s+/g, ' ');
    expect(page).toContain('MyMedicare');
    expect(page).toContain('General practitioner attendances');
    expect(page).toContain('two business days');
    expect(page).toContain('in writing to the practice');
    // A standing agreement has no service date and no basic description.
    expect(page).not.toContain('Date the service will be provided');
  });
});

describe('the render-time guards (hard rules 3, 4 and 12)', () => {
  const renderer = new AgreementPdfRenderer(logos);

  it('render_refuses_a_dollar_amount', async () => {
    // The template is clean; the VALUE is not — a service description somebody
    // typed a figure into is exactly the case the loader cannot catch.
    const document = documentFor({
      particulars: { ...PARTICULARS, basicServiceDescription: 'Standard consultation $41.20' },
    });
    await expect(renderer.render(document as unknown as Record<string, unknown>, ['en'])).rejects.toThrow(
      RenderRefusal,
    );
    await expect(renderer.render(document as unknown as Record<string, unknown>, ['en'])).rejects.toThrow(
      /HARD-04/,
    );
  });

  it('render_has_no_practitioner_signature_field', async () => {
    const template = renderAgreementTemplate(genericAgreementTemplate('episodic'), {
      values: { ...templateValues(), providerName: 'Dr Sam Example' },
      conditions: { assignorIsPatient: true, isPreAgreement: true },
    });
    const document = documentFor({
      template: { ...template, footer: [...template.footer, 'Practitioner signature: ______'] },
    });
    await expect(renderer.render(document as unknown as Record<string, unknown>, ['en'])).rejects.toThrow(
      /HARD-03/,
    );
  });

  it('render_never_claims_approval', async () => {
    const document = documentFor({
      letterhead: { ...LETTERHEAD, tradingName: 'Testville Accredited Medical' },
    });
    await expect(renderer.render(document as unknown as Record<string, unknown>, ['en'])).rejects.toThrow(
      /HARD-12/,
    );
  });

  it('refuses bare particulars — pdf-2 renders a whole document or nothing', async () => {
    await expect(renderer.render(PARTICULARS as unknown as Record<string, unknown>, ['en'])).rejects.toThrow(
      /whole agreement document/,
    );
  });
});

describe('RendererRegistry (rule 13/14 — renderers are versioned content)', () => {
  it('current is the agreement renderer; every historical version stays resolvable', () => {
    const registry = new RendererRegistry(logos);
    expect(registry.currentVersion).toBe(AgreementPdfRenderer.VERSION);
    expect(registry.get(CanonicalJsonRenderer.VERSION)).toBeDefined();
    expect(registry.get(DeterministicPdfRenderer.VERSION)).toBeDefined();
    expect(registry.get(AgreementPdfRenderer.VERSION)).toBeDefined();
    expect(registry.get('no-such-version')).toBeUndefined();
  });

  it('renderInputOf prefers the stored document and falls back to bare particulars', () => {
    const document = documentFor();
    expect(renderInputOf({ renderPayload: document, particulars: PARTICULARS })).toBe(document);
    expect(renderInputOf({ renderPayload: null, particulars: PARTICULARS })).toBe(PARTICULARS);
    expect(renderInputOf({ particulars: PARTICULARS })).toBe(PARTICULARS);
  });
});

function templateValues() {
  return {
    patientName: 'Alex Testpatient',
    agreementDate: '1 September 2026',
    providerDetails: 'Dr Sam Example, 1 Test Street, Testville NSW 2000',
    providerName: 'Dr Sam Example',
    serviceDate: '1 September 2026',
    basicServiceDescription: 'General practitioner attendance',
    mbsItemNumbers: '—',
    mappingVersion: 'mapping-test-1',
    assignorName: 'Robin Testperson',
    assignorRelationship: 'mother',
    enduringPathway: '—',
    coveredServiceScope: '—',
    notificationMethod: '—',
    terminationMethod: '—',
    commencementDate: '1 September 2026',
  };
}
