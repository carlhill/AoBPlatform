import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { LOGO_BOX_POINTS } from '@aobplatform/domain';
import type { AgreementRenderer, RenderedArtefact } from './renderer';
import type { LogoLoader } from './logo-loader';
import {
  assertRenderable,
  canonicalJson,
  isAgreementDocument,
  RenderRefusal,
  type AgreementDocument,
} from './agreement-document';

/**
 * `pdf-2` — THE AGREEMENT AS A PERSON WOULD RECOGNISE IT: the practice's
 * letterhead, the words of the instrument, the whole s 65C data set, and the
 * statements the assignor ticked (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1).
 *
 * WHAT `pdf-1` DID AND WHY IT IS STILL REGISTERED. It printed the particulars
 * as a sorted list of keys and values with a one-line preamble. Agreements
 * locked under it must keep re-verifying against it forever (rules 13 and 14
 * together), so it is not edited and not removed — it is simply no longer
 * `current`.
 *
 * DETERMINISM, WHICH IS THE WHOLE POINT (rule 13). Two renders of one document
 * are byte-identical, and the levers are the same as `pdf-1`'s plus two the
 * letterhead introduces:
 *  - CreationDate/ModDate derived from the CONTENT, never the wall clock;
 *  - base-14 fonts only (Helvetica), so no font discovery and no subsetting;
 *  - the LOGO is embedded verbatim, addressed by sha256, and drawn into a
 *    FIXED box (`LOGO_BOX_POINTS`) — the file's own dimensions decide nothing,
 *    so a practice re-exporting at a different resolution changes the bytes
 *    only because it is a different file, not because the layout moved;
 *  - the "DRAFT" marker is a stored boolean on the document, decided at lock,
 *    never read from the environment at render time — an environment-dependent
 *    render is an agreement that stops verifying when it moves.
 *
 * PDF/A conformance (embedded pinned fonts, XMP metadata, an OutputIntent ICC
 * profile) is still the remaining production step, and the version string
 * still says `pdf` rather than `pdfa` until it genuinely is. Claiming
 * otherwise in a version string would be the same kind of lie hard rule 12
 * forbids in prose.
 *
 * THREE THINGS THIS RENDERER REFUSES TO DRAW, checked against the exact
 * strings about to become bytes: a dollar amount (rule 4), a practitioner
 * signature field (rule 3), and any claim that the form is certified,
 * approved or accredited (rule 12). It refuses rather than redacting — see
 * `assertRenderable`.
 */
export class AgreementPdfRenderer implements AgreementRenderer {
  static readonly VERSION = 'pdf-2';

  constructor(private readonly logos: LogoLoader) {}

  async render(payload: Record<string, unknown>, languages: readonly string[]): Promise<RenderedArtefact> {
    if (!isAgreementDocument(payload)) {
      throw new RenderRefusal(
        'HARD-13',
        `Renderer ${AgreementPdfRenderer.VERSION} renders a whole agreement document — letterhead, words ` +
          'and particulars. It was handed bare particulars, which would produce a page missing most of ' +
          'the agreement.',
      );
    }
    const document = payload as unknown as AgreementDocument;
    assertRenderable(document);

    const logo = await this.resolveLogo(document);

    const contentHash = createHash('sha256')
      .update(canonicalJson({ document: payload, languages }), 'utf8')
      .digest();
    // Content-derived timestamp inside a fixed day — stable per content, and
    // never the wall clock.
    const stamp = new Date(Date.UTC(2026, 6, 1, 0, 0, contentHash.readUInt16BE(0) % 60));

    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: {
        Title: document.template.title,
        Author: document.letterhead.legalName,
        Creator: 'AoBPlatform',
        Producer: 'AoBPlatform',
        CreationDate: stamp,
        ModDate: stamp,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawLetterhead(doc, document, logo);
    this.drawTitle(doc, document);
    this.drawSections(doc, document);
    this.drawStatements(doc, document);
    this.drawFooter(doc, document, languages);

    doc.end();
    const bytes = await finished;
    return {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rendererVersion: AgreementPdfRenderer.VERSION,
      mediaType: 'application/pdf',
    };
  }

  /**
   * A DECLARED LOGO THAT CANNOT BE PRODUCED FAILS THE RENDER.
   *
   * The alternative — quietly drawing the page without it — would produce
   * different bytes from the ones hashed at lock, and the hash comparison
   * downstream would report a determinism violation with no explanation. This
   * says what actually happened, at the place that knows.
   */
  private async resolveLogo(document: AgreementDocument): Promise<Buffer | null> {
    const sha = document.letterhead.logoSha256;
    if (!sha) return null;
    const bytes = await this.logos.load(document.practiceId, sha);
    if (!bytes) {
      throw new RenderRefusal(
        'HARD-13',
        `The letterhead declares logo ${sha.slice(0, 12)}… and it could not be produced. Rendering without ` +
          'it would silently change the bytes this agreement was hashed against.',
      );
    }
    return bytes;
  }

  private drawLetterhead(doc: PDFKit.PDFDocument, document: AgreementDocument, logo: Buffer | null): void {
    const { letterhead } = document;
    const top = doc.y;
    if (logo) {
      // Left is the default; pdfkit's types only offer center/right, and an
      // explicit alignment here would be the layout depending on a value the
      // library does not name.
      doc.image(logo, doc.page.margins.left, top, {
        fit: [LOGO_BOX_POINTS.width, LOGO_BOX_POINTS.height],
      });
      doc.y = top + LOGO_BOX_POINTS.height + 8;
    }

    doc.font('Helvetica-Bold').fontSize(12).text(letterhead.legalName);
    doc.font('Helvetica').fontSize(9);
    // TRADING NAME ONLY WHEN IT DIFFERS. A letterhead that prints one name
    // twice reads as a fault in the software rather than as a fact about the
    // business — and for a sole trader the two are usually the same string.
    if (letterhead.tradingName && letterhead.tradingName !== letterhead.legalName) {
      doc.text(`Trading as ${letterhead.tradingName}`);
    }
    for (const line of [letterhead.address, contactLine(letterhead.phone, letterhead.email)]) {
      if (line) doc.text(line);
    }
    if (letterhead.abn) doc.text(`ABN ${letterhead.abn}`);
    doc.moveDown(0.75);
    rule(doc);
  }

  private drawTitle(doc: PDFKit.PDFDocument, document: AgreementDocument): void {
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(15).text(document.template.title);
    doc.moveDown(0.25);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .text('s 65C, Health Insurance Regulations 2018. Checked against the s 65C data set (self-assessment).');
    if (document.draftMarker) {
      /*
       * THE DRAFT LINE IS PART OF THE DOCUMENT, NOT PART OF THE ENVIRONMENT.
       * `draftMarker` is a stored boolean the LOCK decided, so this render is
       * reproducible anywhere; see `AgreementDocument`. It is on because the
       * template's words have not been reviewed by counsel, and a page that
       * did not say so would be the platform passing unreviewed legal copy off
       * as settled.
       */
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(8.5).text('DRAFT — wording pending review');
    }
    doc.moveDown(0.6);
  }

  private drawSections(doc: PDFKit.PDFDocument, document: AgreementDocument): void {
    for (const section of document.template.sections) {
      if (section.heading) {
        doc.font('Helvetica-Bold').fontSize(10.5).text(section.heading);
        doc.moveDown(0.15);
      }
      doc.font('Helvetica').fontSize(10);
      for (const paragraph of section.paragraphs) {
        doc.text(paragraph);
      }
      doc.moveDown(0.5);
    }
  }

  /**
   * THE TICK BOXES. Each statement is drawn with a filled box, because these
   * are the affirmations the assignor actually made on the tablet — the
   * signature event records their KEYS, and this is the same list rendered.
   *
   * A CROSS IS NEVER DRAWN, because an unticked statement cannot reach a
   * signed agreement: the signature control does not enable until every one is
   * affirmed, and the server refuses a signature that does not carry them all
   * (`signature_requires_every_statement_affirmed`). A box for something the
   * person did not agree to has no place on a contract they signed.
   */
  private drawStatements(doc: PDFKit.PDFDocument, document: AgreementDocument): void {
    doc.font('Helvetica-Bold').fontSize(10.5).text('What the person signing has agreed');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10);
    for (const statement of document.template.statements) {
      const y = doc.y;
      const left = doc.page.margins.left;
      // A drawn box rather than a glyph: the base-14 fonts have no ballot
      // character, and a font substituted to find one is a font we did not
      // pin (determinism).
      doc.lineWidth(0.8).rect(left, y + 1.5, 8, 8).stroke();
      doc.moveTo(left + 1.6, y + 5.6).lineTo(left + 3.4, y + 7.6).lineTo(left + 6.6, y + 3).stroke();
      doc.text(statement.text, left + 14, y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14 });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.4);
  }

  private drawFooter(
    doc: PDFKit.PDFDocument,
    document: AgreementDocument,
    languages: readonly string[],
  ): void {
    rule(doc);
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(8);
    for (const line of document.template.footer) {
      doc.text(line);
    }
    /*
     * THE PROVENANCE LINE. Which words, which rule set, which mapping and
     * which renderer produced this page — the four versions hard rule 14 makes
     * evidence. No hash here: the artefact's own hash is recorded on the
     * agreement and in the vault, and printing a document's hash inside the
     * document is a hash of something else.
     */
    doc.moveDown(0.3);
    doc.text(
      `Template ${document.template.templateVersion} · letterhead ${document.letterheadHash.slice(0, 12)} · ` +
        `renderer ${AgreementPdfRenderer.VERSION} · languages ${languages.join(', ')}`,
    );
  }
}

function contactLine(phone?: string, email?: string): string | undefined {
  const parts = [phone, email].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function rule(doc: PDFKit.PDFDocument): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  doc.lineWidth(0.5).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
}
