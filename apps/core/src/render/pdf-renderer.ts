import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import type { AgreementRenderer, RenderedArtefact } from './renderer';

/**
 * Deterministic server-side PDF renderer (rule 13). Determinism levers:
 *  - CreationDate/ModDate derived from the CONTENT (first 8 bytes of its
 *    sha256 as an epoch offset into a fixed year) — never the wall clock;
 *  - standard base-14 font only (Helvetica) — no environment-dependent
 *    font discovery or subsetting;
 *  - fields rendered in sorted key order;
 *  - no compression randomness (zlib level fixed by pdfkit; verified by the
 *    render-twice test).
 *
 * PDF/A conformance (embedded pinned fonts, XMP metadata, OutputIntent ICC
 * profile) is the remaining production step — tracked, not faked: the
 * version string says 'pdf' not 'pdfa' until it genuinely is.
 */
export class DeterministicPdfRenderer implements AgreementRenderer {
  static readonly VERSION = 'pdf-1';

  async render(particulars: Record<string, unknown>, languages: readonly string[]): Promise<RenderedArtefact> {
    const canonical = canonicalJson({ particulars, languages });
    const contentHash = createHash('sha256').update(canonical, 'utf8').digest();
    // Content-derived timestamp inside a fixed day — stable per content,
    // different content → different (irrelevant) timestamp.
    const contentDate = new Date(Date.UTC(2026, 6, 1, 0, 0, contentHash.readUInt16BE(0) % 60));

    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: {
        Title: 'Assignment of Medicare Benefit Agreement',
        Author: 'AoBPlatform',
        Creator: 'AoBPlatform',
        Producer: 'AoBPlatform',
        CreationDate: contentDate,
        ModDate: contentDate,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.font('Helvetica-Bold').fontSize(14).text('Assignment of Medicare Benefit Agreement');
    doc.moveDown(0.5);
    doc
      .font('Helvetica')
      .fontSize(9)
      .text('s 65C, Health Insurance Regulations 2018. Checked against the s 65C data set (self-assessment).');
    doc.moveDown();

    // The s 65C particulars, sorted for determinism. Labels stay data-driven —
    // the bilingual layout (REQ-LANG-02) replaces this table in the M14 pass.
    doc.fontSize(11);
    for (const key of Object.keys(particulars).sort()) {
      const value = particulars[key];
      if (value === undefined || value === null) continue;
      doc.font('Helvetica-Bold').text(`${key}: `, { continued: true });
      doc.font('Helvetica').text(Array.isArray(value) ? value.join(', ') : String(value));
    }
    doc.moveDown();
    doc
      .fontSize(8)
      .font('Helvetica')
      .text(`Languages rendered: ${languages.join(', ')} · Renderer ${DeterministicPdfRenderer.VERSION}`);
    doc.end();

    const bytes = await finished;
    return {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rendererVersion: DeterministicPdfRenderer.VERSION,
      mediaType: 'application/pdf',
    };
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
