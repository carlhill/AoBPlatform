import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import type { Db4Statement } from '@aobplatform/contracts';
import { canonicalJson } from './canonical-json';
import type { AgreementRenderer, RenderedArtefact } from './renderer';
import type { LogoLoader } from './logo-loader';
import {
  assertSignedDb4Renderable,
  isSignedDb4Document,
  SignedDb4RenderRefusal,
  type SignedDb4Document,
} from './signed-db4-document';

/**
 * `signed-db4-1` — THE PRACTICE'S OWN FORM, BACK IN THE CHART FOLDER, WITH THE
 * COST ON IT AND THE PATIENT'S SIGNATURE AT THE BOTTOM (D-2026-09-14-02/-03).
 *
 * A SEPARATE RENDERER, NOT A TEMPLATE. The agreement template system draws a
 * FIXED shape — letterhead, title, sections, tick boxes, footer — from JSON
 * word lists with two types, `episodic` and `enduring`. The DB4's layout is
 * not that shape and cannot be expressed as one of those templates: it has
 * four centred heading lines, a servicing-location block, a patient block
 * carrying the Medicare card number and IRN, a five-column service table with
 * an amount in it, a privacy notice, two statements joined by "or", a referral
 * block and a signature. Bending the template renderer to draw it would have
 * meant a second shape behind a flag inside the one path that renders every
 * ordinary agreement — which is the coupling `signed-db4-document.ts` explains
 * at length that this build exists to avoid.
 *
 * IT IS REGISTERED IN `RendererRegistry` LIKE EVERY OTHER VERSION, and for the
 * same reason: a Signed-DB4 records the renderer version that produced it and
 * is re-rendered under THAT version forever. `signed-db4-2` will be a new
 * entry, never an edit to this class, or every hash recorded under this one
 * stops verifying (rules 13 and 14 together).
 *
 * DETERMINISM, WHICH IS WHAT MAKES THIS EVIDENCE RATHER THAN A PHOTOCOPY
 * (hard rule 13). The same four levers as the agreement renderer:
 *  - CreationDate/ModDate derived from the CONTENT, never the wall clock;
 *  - base-14 fonts only (Helvetica), so no font discovery and no subsetting;
 *  - the signature PNG embedded verbatim, addressed by sha256, drawn into a
 *    FIXED box, so a pad of a different size changes the bytes only because
 *    it is a different mark;
 *  - every word and every measurement from the stored content object, never
 *    from the environment and never from the current content file.
 *
 * PDF/A conformance (embedded pinned fonts, XMP metadata, an OutputIntent ICC
 * profile) is the same outstanding production step as on the agreement path,
 * and the version string says `signed-db4` rather than `signed-db4a` until it
 * genuinely is. Claiming otherwise in a version string would be the same kind
 * of lie hard rule 12 forbids in prose.
 *
 * WHAT IT REFUSES, and what it deliberately does not: see
 * `assertSignedDb4Renderable`. In one line — a practitioner signature field
 * anywhere (rule 3), any claim in OUR words that this page is approved
 * (rule 12), and no amount check at all, because the amounts are the
 * practice's own and reproducing them is the point.
 */
export class SignedDb4Renderer implements AgreementRenderer {
  static readonly VERSION = 'signed-db4-1';

  /**
   * THE SIGNATURE MARK ARRIVES THROUGH THE LOGO LOADER, and the name is the
   * only thing wrong with that. `LogoLoader` is the render path's one port for
   * "give me the artefact bytes with this content hash, scoped to this
   * practice" — content-addressed, re-hashed on the way out, no vault read
   * event, exactly the contract this needs for the signature PNG. A second
   * interface of the same shape would be a second thing to wire and a second
   * thing to fake in tests, for a rename; the alternative, renaming the port,
   * would touch three files and the inventory for no behaviour. Reused on
   * purpose, said out loud here so nobody reads it as a mistake.
   */
  constructor(private readonly artefacts: LogoLoader) {}

  async render(payload: Record<string, unknown>, languages: readonly string[]): Promise<RenderedArtefact> {
    if (!isSignedDb4Document(payload)) {
      throw new SignedDb4RenderRefusal(
        'HARD-13',
        `Renderer ${SignedDb4Renderer.VERSION} renders a Signed-DB4 — the reproduced print record, the ` +
          'resolved content and the signature together. It was handed something else, which would produce ' +
          'a page missing most of the form.',
      );
    }
    const document = payload as unknown as SignedDb4Document;
    assertSignedDb4Renderable(document);

    const mark = await this.resolveSignature(document);

    const contentHash = createHash('sha256')
      .update(canonicalJson({ document: payload, languages }), 'utf8')
      .digest();
    // Content-derived timestamp inside a fixed day — stable per content, and
    // never the wall clock. The same trick, and the same fixed day, as `pdf-2`.
    const stamp = new Date(Date.UTC(2026, 6, 1, 0, 0, contentHash.readUInt16BE(0) % 60));

    const { layout } = document.content;
    const doc = new PDFDocument({
      size: 'A4',
      margin: layout.marginPoints,
      info: {
        // The form's own words, so the file a practice opens is named the way
        // the practice names it. Falls back rather than inventing a title.
        Title: document.printRecord.heading?.lines?.[1] ?? 'Bulk Bill Assignment of Benefit Form',
        Author: document.printRecord.servicingLocation?.name ?? 'AoBPlatform',
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

    this.drawHeading(doc, document);
    this.drawForm(doc, document);
    this.drawServicingLocation(doc, document);
    this.drawPatient(doc, document);
    this.drawProviders(doc, document);
    this.drawServices(doc, document);
    this.drawPrivacyNotice(doc, document);
    this.drawAssignment(doc, document);
    this.drawReferral(doc, document);
    this.drawSignature(doc, document, mark);
    this.drawFooter(doc, document, languages);

    doc.end();
    const bytes = await finished;
    return {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rendererVersion: SignedDb4Renderer.VERSION,
      mediaType: 'application/pdf',
    };
  }

  /**
   * A SIGNATURE THAT CANNOT BE PRODUCED FAILS THE RENDER.
   *
   * The whole requirement is that the patient's signature is ON this form.
   * Drawing the page without it would produce a Signed-DB4 that is not signed,
   * and — once stored — a hash that no later re-render could reproduce if the
   * bytes turned up afterwards. Refusing says what actually happened, at the
   * place that knows, and leaves the agreement itself untouched and signed.
   */
  private async resolveSignature(document: SignedDb4Document): Promise<Buffer> {
    const sha = document.signature.rasterSha256;
    const bytes = await this.artefacts.load(document.practiceId, sha);
    if (!bytes) {
      throw new SignedDb4RenderRefusal(
        'HARD-13',
        `The Signed-DB4 declares the signature mark ${sha.slice(0, 12)}… and it could not be produced. A ` +
          'Signed-DB4 without the signature on it is not the document the practice asked for.',
      );
    }
    return bytes;
  }

  /**
   * THE FOUR HEADING LINES, AS PRINTED, IN ORDER — reproduced verbatim from
   * the print record and never authored here (D-2026-09-14-02). Line 3 is the
   * government's statement about the government's form; the footer is what
   * says whose page this one is.
   */
  private drawHeading(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { layout } = document.content;
    const lines = document.printRecord.heading?.lines ?? [];
    lines.forEach((line, index) => {
      doc
        .font(index <= 1 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(index === 1 ? layout.titleSize : layout.headingSize)
        .text(line, { align: 'center' });
    });
    doc.moveDown(0.5);
    rule(doc);
    doc.moveDown(0.4);
  }

  private drawForm(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { labels } = document.content;
    const form = document.printRecord.form;
    this.field(doc, document, labels.formReference, form?.formReference);
    this.field(doc, document, labels.locationId, form?.locationId);
    this.field(doc, document, labels.claimStatus, form?.claimStatus);
    this.field(doc, document, labels.serviceDate, form?.serviceDate);
    doc.moveDown(0.4);
  }

  private drawServicingLocation(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { labels } = document.content;
    const location = document.printRecord.servicingLocation;
    this.heading(doc, document, labels.servicingLocation);
    const suburbLine = [location?.suburb, location?.state, location?.postcode]
      .filter((part) => !!part)
      .join(' ');
    this.body(doc, document, location?.name);
    for (const line of location?.addressLines ?? []) this.body(doc, document, line);
    this.body(doc, document, suburbLine);
    doc.moveDown(0.4);
  }

  /**
   * THE PATIENT BLOCK, INCLUDING THE MEDICARE CARD NUMBER AND IRN IN FULL
   * (D-2026-09-14-03). No masking: the patient reads their own card number and
   * knows the form is theirs, and the auditor links the form to the claim by
   * it — the government's own approved form prints it for exactly that reason.
   *
   * HARD RULE 1 DOES NOT MOVE. It is, and always was, a rule about
   * VERIFICATION: the card number is never used to prove who somebody is,
   * never used to find or match a patient, never in a log line, an error
   * message or a vault event, and never sent to the zero-PII rules service.
   * Printing it as content on a reproduction of the form it is printed on is
   * none of those things.
   */
  private drawPatient(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { labels } = document.content;
    const patient = document.printRecord.patient;
    this.heading(doc, document, labels.patient);
    const name = [patient?.givenNames, patient?.familyName].filter((part) => !!part).join(' ');
    this.body(doc, document, name);
    this.field(doc, document, labels.patientRecordNumber, patient?.patientRecordNumber);
    /*
     * THE ONE PLACE IN apps/core THAT READS THE NUMBER. The lint rule fires on
     * the identifier and it is right to: that name in code is the single most
     * likely design mistake in this product. It is disabled here, once, with
     * the decision that requires it named — and the value goes straight onto
     * the page and nowhere else. It is not returned, not logged, not stored in
     * a column, and not put in an event.
     */
    // eslint-disable-next-line no-restricted-syntax
    this.field(doc, document, labels.medicareCard, patient?.medicareCardNumber);
    this.field(doc, document, labels.irn, patient?.irn);
    this.field(doc, document, labels.dateOfBirth, patient?.dateOfBirth);
    this.field(doc, document, labels.address, patient?.address);
    doc.moveDown(0.4);
  }

  /**
   * BOTH PROVIDERS, BECAUSE BOTH ARE ON THE FORM. Only the servicing one
   * anchors the agreement — that is whose provider number the claim goes under
   * (s 65C(5)(a)) — but the payee is printed on the DB4 and a reproduction
   * that dropped it would not be the same form.
   */
  private drawProviders(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { labels } = document.content;
    const providers = document.printRecord.providers ?? [];
    if (providers.length === 0) return;
    this.heading(doc, document, labels.providers);
    for (const provider of providers) {
      const role = provider.role === 'payee' ? labels.payeeProvider : labels.servicingProvider;
      this.field(doc, document, role, provider.name);
      this.field(doc, document, labels.providerNumber, provider.providerNumber);
    }
    doc.moveDown(0.4);
  }

  /**
   * THE SERVICE ROWS, INCLUDING THE BENEFIT ASSIGNED (D-2026-09-14-02).
   *
   * The figure is PracSoft's, carried verbatim in the DB4 Print Record, and is
   * never computed, converted, totalled or formatted here — the string that
   * was printed is the string that is drawn. AoB never originates an amount;
   * that is what hard rule 4, as narrowed, actually says, and a total on this
   * page would be us originating one.
   */
  private drawServices(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { labels, layout } = document.content;
    const [wDate, wTime, wItem, wDescription, wBenefit] = layout.serviceColumnWidths;
    const left = doc.page.margins.left;
    this.heading(doc, document, labels.services);

    const row = (cells: readonly string[], bold: boolean): void => {
      const top = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(layout.bodySize);
      const widths = [wDate, wTime, wItem, wDescription, wBenefit];
      let x = left;
      let bottom = top;
      cells.forEach((cell, index) => {
        doc.text(cell, x, top, { width: widths[index] - 4 });
        bottom = Math.max(bottom, doc.y);
        x += widths[index];
      });
      doc.y = bottom;
      doc.x = left;
      doc.moveDown(0.2);
    };

    row([labels.columnDate, labels.columnTime, labels.columnItem, labels.columnDescription, labels.columnBenefit], true);
    for (const service of document.printRecord.services ?? []) {
      row(
        [
          service.serviceDate ?? labels.notProvided,
          service.time ?? labels.notProvided,
          service.mbsItemNumber ?? labels.notProvided,
          service.description ?? labels.notProvided,
          service.benefitAssigned ?? labels.notProvided,
        ],
        false,
      );
    }
    doc.moveDown(0.4);
  }

  private drawPrivacyNotice(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { labels, layout } = document.content;
    const paragraphs = document.printRecord.assignment?.privacyNotice ?? [];
    if (paragraphs.length === 0) return;
    this.heading(doc, document, labels.privacyNotice);
    doc.font('Helvetica').fontSize(layout.smallSize);
    for (const paragraph of paragraphs) doc.text(paragraph);
    doc.moveDown(0.4);
  }

  /**
   * BOTH STATEMENTS, WITH THE TICK STATE THE DRIVER READ, AND THE WORD THAT
   * JOINS THEM.
   *
   * THE SECOND ONE IS THE PATHOLOGY OFFER, and it is drawn as data and never
   * acted on. s 65C(4) items 1–4 are out of this product's scope (CLAUDE.md
   * section 8): nothing branches on it, no agreement is made from it, nothing
   * is validated or written back because of it. But it is ON the form the
   * practice printed, and a reproduction that silently dropped a ticked box
   * would be a different form from the one in the chart folder — which is the
   * one thing the practice asked us not to produce.
   *
   * A BOX IS DRAWN EITHER WAY HERE, ticked or not, which is the opposite of
   * the agreement renderer's rule and is right for the opposite reason. On an
   * agreement an unticked box cannot exist, because the signature is refused
   * until every statement is affirmed. On a reproduction, an unticked box on
   * the practice's paper is a fact about the page, and hiding it would be us
   * editing the form.
   */
  private drawAssignment(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { labels, layout } = document.content;
    const assignment = document.printRecord.assignment;
    const statements = assignment?.statements ?? [];
    if (statements.length === 0) return;
    this.heading(doc, document, labels.assignment);
    doc.font('Helvetica').fontSize(layout.bodySize);

    statements.forEach((statement: Db4Statement, index: number) => {
      if (index > 0 && assignment?.statementsJoinedBy) {
        doc.font('Helvetica-Bold').fontSize(layout.bodySize).text(assignment.statementsJoinedBy);
        doc.font('Helvetica');
        doc.moveDown(0.15);
      }
      const top = doc.y;
      const left = doc.page.margins.left;
      /*
       * A DRAWN BOX AND A DRAWN TICK, not a glyph. The base-14 fonts have no
       * ballot character and a font substituted to find one is a font we did
       * not pin — which is a determinism problem, not a typography one. Two
       * short vector paths rather than a shared helper: the agreement
       * renderer's version draws only ticked boxes and this one must draw
       * both, so sharing would mean a parameter on a control that fourteen
       * signed agreements' bytes depend on.
       */
      doc.lineWidth(0.8).rect(left, top + 1.5, 8, 8).stroke();
      if (statement.ticked) {
        doc.moveTo(left + 1.6, top + 5.6).lineTo(left + 3.4, top + 7.6).lineTo(left + 6.6, top + 3).stroke();
      }
      doc.font('Helvetica').fontSize(layout.bodySize);
      doc.text(statement.text ?? labels.notProvided, left + 14, top, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14,
      });
      doc.x = left;
      doc.moveDown(0.3);
    });
    doc.moveDown(0.3);
  }

  private drawReferral(doc: PDFKit.PDFDocument, document: SignedDb4Document): void {
    const { labels } = document.content;
    const referral = document.printRecord.referral;
    if (!referral) return;
    // Every field of a referral block may legitimately be empty on a DB4 for
    // an ordinary attendance. An empty block is not drawn at all rather than
    // drawn as six em dashes, which would read as data we failed to capture.
    const values = [
      referral.acrf,
      referral.lspn,
      referral.requestingProviderName,
      referral.requestingProviderNumber,
      referral.dateOfRequest,
      referral.periodOfReferral,
    ];
    if (values.every((value) => value === null || value === undefined || value === '')) return;
    this.heading(doc, document, labels.referral);
    this.field(doc, document, labels.acrf, referral.acrf ?? undefined);
    this.field(doc, document, labels.lspn, referral.lspn ?? undefined);
    this.field(doc, document, labels.requestingProvider, referral.requestingProviderName ?? undefined);
    this.field(doc, document, labels.requestingProviderNumber, referral.requestingProviderNumber ?? undefined);
    this.field(doc, document, labels.dateOfRequest, referral.dateOfRequest ?? undefined);
    this.field(doc, document, labels.periodOfReferral, referral.periodOfReferral ?? undefined);
    doc.moveDown(0.4);
  }

  /**
   * THE MARK THE PATIENT MADE, ON THE PAGE. This is the requirement — one form
   * in the folder with the signature at the bottom — and it is the one thing
   * the agreement path deliberately does NOT do: an agreement's signature is
   * stored as its own artefacts and bound on the signature event, never
   * composited into the PDF, because the agreement's bytes were hashed before
   * anyone signed. The Signed-DB4 is produced AFTER the signature for exactly
   * this reason.
   *
   * A FIXED BOX. The pad's own pixel dimensions decide nothing about the
   * layout, so a practice swapping tablets changes these bytes only because
   * the mark is a different mark.
   */
  private drawSignature(doc: PDFKit.PDFDocument, document: SignedDb4Document, mark: Buffer): void {
    const { labels, layout } = document.content;
    rule(doc);
    doc.moveDown(0.4);
    this.heading(doc, document, labels.signature);
    const top = doc.y;
    doc.image(mark, doc.page.margins.left, top, { fit: [SIGNATURE_BOX.width, SIGNATURE_BOX.height] });
    doc.y = top + SIGNATURE_BOX.height + 4;
    doc.x = doc.page.margins.left;
    doc.font('Helvetica').fontSize(layout.smallSize);
    doc.text(`${labels.signedAt}: ${document.signature.signedAt} (${document.signature.channel})`);
    doc.moveDown(0.4);
  }

  /**
   * THE PROVENANCE LINE AND THE VERSIONS — the two halves of "whose page is
   * this, and what made it".
   *
   * The first is content (hard rule 14) and is the answer to the reproduced
   * "approved form" heading above it. The second is the same four-versions
   * discipline the agreement footer follows: which content, which renderer,
   * which parser template read the form, and the form's own identity. No hash
   * here — the artefact's hash is recorded on the agreement and in the vault,
   * and printing a document's hash inside the document is a hash of something
   * else.
   */
  private drawFooter(
    doc: PDFKit.PDFDocument,
    document: SignedDb4Document,
    languages: readonly string[],
  ): void {
    const { content } = document;
    rule(doc);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(content.layout.smallSize);
    doc.text(content.footer.provenance);
    for (const line of content.footer.lines) doc.text(line);
    doc.moveDown(0.25);
    doc.text(
      `Content ${content.version} · renderer ${SignedDb4Renderer.VERSION} · parser ` +
        `${document.printRecord.parserTemplateVersion ?? content.labels.notProvided} · ` +
        `${content.labels.capturedAt} ${document.printRecord.capturedAt ?? content.labels.notProvided} · ` +
        `languages ${languages.join(', ')}`,
    );
  }

  private heading(doc: PDFKit.PDFDocument, document: SignedDb4Document, text: string): void {
    doc.font('Helvetica-Bold').fontSize(document.content.layout.headingSize).text(text);
    doc.moveDown(0.15);
  }

  private body(doc: PDFKit.PDFDocument, document: SignedDb4Document, text: string | undefined): void {
    if (!text) return;
    doc.font('Helvetica').fontSize(document.content.layout.bodySize).text(text);
  }

  /**
   * A LABEL AND ITS VALUE. An absent value prints the content file's
   * `notProvided` mark rather than being skipped: the practice comparing this
   * page with the one it printed must be able to see that a field was empty,
   * not wonder whether we dropped it.
   */
  private field(
    doc: PDFKit.PDFDocument,
    document: SignedDb4Document,
    label: string,
    value: string | undefined,
  ): void {
    const { labels, layout } = document.content;
    doc.font('Helvetica').fontSize(layout.bodySize).text(`${label}: ${value ?? labels.notProvided}`);
  }
}

/**
 * HOW BIG THE MARK IS DRAWN, in PDF points, and it is FIXED — the same reason
 * and the same shape as `LOGO_BOX_POINTS` for the letterhead. A signature pad
 * that reports a different resolution must not move the layout.
 */
const SIGNATURE_BOX = { width: 200, height: 70 } as const;

function rule(doc: PDFKit.PDFDocument): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  doc.lineWidth(0.5).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
}
