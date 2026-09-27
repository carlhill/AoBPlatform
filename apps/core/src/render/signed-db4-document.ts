import type {
  Db4Assignment,
  Db4Form,
  Db4Heading,
  Db4Patient,
  Db4Referral,
  Db4Service,
  Db4ServicingLocation,
  PrintJobProvider,
} from '@aobplatform/contracts';
import type { SignedDb4Content } from '@aobplatform/domain';

/**
 * THE SIGNED-DB4 — ITS OWN ARTEFACT KIND, WITH ITS OWN DOCUMENT TYPE AND ITS
 * OWN GUARDS (Carl, 27 September 2026; D-2026-09-14-02/-03).
 *
 * WHAT IT IS. AoB's deterministic reproduction of the DB4 the practice's
 * billing software printed — the same headings, the same boxes, the same
 * rows, the same amounts — with the patient's signature at the bottom. The
 * practice asked for the exact same form back in the chart folder with the
 * cost printed and the signature on it, one document and not two, and this is
 * that document. It is OURS: we render it, we hash it, and we can re-render it
 * byte-identically, which is the only reason we can stand behind it (hard rule
 * 13). We do not sign PracSoft's bytes.
 *
 * ── WHY IT IS NOT AN AGREEMENT ARTEFACT, AND WHY THAT MATTERS MORE THAN IT
 * LOOKS ──
 *
 * Hard rule 4 says no benefit or dollar amount on any AGREEMENT artefact, and
 * REQ-REG-04 names the risk as OURS ADDING A FIGURE. A faithful reproduction
 * of the government's own approved form, which prints the amount itself, adds
 * nothing: every figure on this page is the practice's billing software's, is
 * carried verbatim in the DB4 Print Record, and is never computed here. That
 * is what D-2026-09-14-02 settled.
 *
 * The obvious implementation was an exemption inside the existing template
 * system. Carl chose this instead for one reason, and it is the reason this
 * file exists at all: **the guards protecting every ordinary agreement must
 * not weaken by one character.** A hole in a shared control is only ever as
 * good as the condition guarding it, and a future bug in that condition drops
 * a dollar amount onto an ordinary agreement — silently, on an instrument with
 * criminal exposure. So `agreement-document.ts`'s `assertRenderable`, and the
 * template loader's own word lists, are untouched and have no exemption
 * branch. They still bite, and
 * `an_ordinary_agreement_artefact_still_refuses_a_dollar_amount` is the test
 * that says so.
 *
 * ── THE GUARD SET, NARROW AND JUSTIFIED ──
 *
 * This page still refuses two things, and the split between them is the whole
 * design:
 *
 *   • **Hard rule 3 — a practitioner signature field, anywhere.** Abolished
 *     1 July 2026. Checked over EVERY string, ours and the reproduced ones
 *     alike, because a practice whose software still prints the pre-July form
 *     would otherwise have us reproduce an abolished field onto stored
 *     evidence. Refusing is right: the form is wrong, and a reproduction of a
 *     wrong form is a wrong form (DB4-AND-AOBL.md section 1d).
 *
 *   • **Hard rule 12 — never OUR claim of approval.** Checked over OUR strings
 *     only: the labels, the footer, anything this codebase authored. The DB4's
 *     third heading line ("the approved form as prescribed under section 20A")
 *     is the government's statement about the government's form. It is
 *     reproduced verbatim as DATA read from the print record, never written by
 *     us, and altering somebody else's form's own words would be the stranger
 *     act. The footer carries the provenance line that stops a reader taking
 *     the heading as a claim about this page, and
 *     `the_signed_db4_never_claims_our_reproduction_is_approved` pins both
 *     halves.
 *
 * **There is deliberately NO amount check**, and that is the one difference
 * from the agreement path. It is not an oversight and it is not a weakening of
 * anything: the rule it would enforce is a rule about the instrument AoB
 * originates, and this page originates nothing.
 *
 * ── AND THE PATHOLOGY BOX — AN OPEN CONFLICT, NOT A SETTLED ONE ──
 *
 * The DB4 prints two assignment statements joined by "or", and the second is
 * an offer to assign to an Approved Pathology Practitioner — s 65C(4) items
 * 1–4, out of this product's scope (CLAUDE.md section 8). It is ON the form we
 * reproduce, so it is DRAWN, with the tick state the driver read, as data. It
 * is never acted on: nothing branches on it, no agreement is created from it,
 * nothing is validated or written back because of it, and `inScope: false` on
 * the print record is carried through untouched.
 *
 * **THIS CONTRADICTS THE WORDS OF A RECORDED DECISION AND CARL HAS TO RULE.**
 * D-2026-09-14-02, under "What does not change", says *"The pathology tick box
 * stays on the practice's paper (out of scope)"*; DB4-AND-AOBL.md section 2a
 * recommends *"Render it on our page for the patient to tick: no, because we
 * would be capturing a pathology assignment we do not validate, store
 * correctly, or write back as one"*; and section 13a piece 2 names *"the first
 * statement"*, singular. Section 10 item 0 still lists it as recommended and
 * UNRULED.
 *
 * It is built this way because the 27 September build brief directs it
 * explicitly — *"it is ON the form we reproduce, so render it with its printed
 * tick state as data"* — and because reproducing a page and acting on a
 * statement are different things. But the counter-argument is real and is not
 * disposed of by that distinction: the patient signs OUR page, and a ticked
 * s 65C(4) assignment sits above their mark on it.
 *
 * Filtering to `statement.inScope !== false` in `SignedDb4Renderer.
 * drawAssignment` is the whole change if Carl rules the other way. Until he
 * does, this comment is the record that the conflict was seen rather than
 * missed. (DECISIONS.md is outside this build's scope, so the ruling is not
 * written there yet.)
 */

/**
 * The DB4 Print Record as it is reproduced — the driver's capture, narrowed to
 * what is drawn. Every field is optional because the parser's contract is that
 * a field it could not read is ABSENT, never defaulted and never inferred; the
 * renderer draws `labels.notProvided` in its place rather than a guess.
 */
export interface SignedDb4PrintRecord {
  readonly heading?: Db4Heading;
  readonly form?: Db4Form;
  readonly servicingLocation?: Db4ServicingLocation;
  readonly patient?: Db4Patient;
  readonly providers?: readonly PrintJobProvider[];
  readonly services?: readonly Db4Service[];
  readonly assignment?: Db4Assignment;
  readonly referral?: Db4Referral;
  /** Which parser template read the page. Provenance, printed in the footer. */
  readonly parserTemplateVersion?: string;
  /** When the desktop captured the form, by its clock. Printed, never `now`. */
  readonly capturedAt?: string;
  /** SHA-256 of the source print job — provenance without possession. */
  readonly sourceSha256?: string;
}

/**
 * THE MARK, AS A REFERENCE. The PNG itself is not in the payload for the same
 * reason the practice's logo is not: the payload is stored on the agreement
 * row, and a signature image written into every row is the same bytes stored
 * twice. The artefact store is content-addressed and re-hashes on the way out,
 * so a sha256 is a guarantee about the bytes rather than a hope — which is
 * what hard rule 13 needs from it.
 */
export interface SignedDb4Signature {
  /** The drawn mark's artefact hash, bound on the `SignatureEvent` at signing. */
  readonly rasterSha256: string;
  /** From the signature event, so the page says when it was signed and the bytes never move. */
  readonly signedAt: string;
  /** `drawn`. Recorded so a later method reads as a different page, not the same one. */
  readonly method: string;
  /** `in_practice`, `sms_link`, … — where the signature was taken. */
  readonly channel: string;
}

export interface SignedDb4Document {
  /** The discriminator. A renderer handed the wrong document kind refuses rather than guessing. */
  readonly kind: 'signed_db4';
  readonly practiceId: string;
  readonly agreementId: string;
  /** The print job this form came from. The real link, not a JSON scan. */
  readonly sourcePrintJobId: string;
  /**
   * THE RESOLVED CONTENT, STORED RATHER THAN LOOKED UP. Editing
   * `content/signed-db4.json` must never move the bytes of a Signed-DB4 that
   * already exists, so the wording and geometry that produced this page travel
   * inside it — exactly as an agreement stores its resolved template words
   * instead of a pointer to a template that can change.
   */
  readonly content: SignedDb4Content;
  readonly printRecord: SignedDb4PrintRecord;
  readonly signature: SignedDb4Signature;
}

/** True for a stored payload that is a Signed-DB4 rather than an agreement document. */
export function isSignedDb4Document(payload: unknown): payload is SignedDb4Document {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    p.kind === 'signed_db4' &&
    typeof p.practiceId === 'string' &&
    typeof p.agreementId === 'string' &&
    typeof p.sourcePrintJobId === 'string' &&
    typeof p.content === 'object' &&
    p.content !== null &&
    typeof p.printRecord === 'object' &&
    p.printRecord !== null &&
    typeof p.signature === 'object' &&
    p.signature !== null
  );
}

/**
 * HARD RULE 3, and it applies to every string on the page.
 *
 * A SECOND COPY OF THE PATTERN, ON PURPOSE, and this is the one place in the
 * build where duplication is the safer choice. `agreement-document.ts` holds
 * the agreement path's copy. Sharing one regex would give the ordinary
 * agreement's guard a second consumer with different requirements, and the
 * next person who needs this page to accept something would widen the shared
 * one — which is precisely the failure mode the separate-artefact-kind ruling
 * exists to prevent.
 */
const PRACTITIONER_SIGNATURE =
  /((practitioner|provider|doctor|physician|clinician)(['’]s)?\s+(signature|sign here|to sign)|signature of (the )?(practitioner|provider|doctor|physician|clinician)|signed by (the )?(practitioner|provider|doctor|physician|clinician))/i;

/** Hard rule 12 — never about OUR page. Same reasoning as above for the copy. */
const APPROVAL_CLAIM = /\b(certified|accredited|government-approved|approved)\b/i;

export class SignedDb4RenderRefusal extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'SignedDb4RenderRefusal';
  }
}

/**
 * THE STRINGS THIS CODEBASE AUTHORED — the ones hard rule 12 is about. Every
 * one comes out of the content file; nothing here is read from the form.
 */
export function ourStringsOf(document: SignedDb4Document): readonly string[] {
  const { content } = document;
  return [...Object.values(content.labels), content.footer.provenance, ...content.footer.lines].filter(
    (line) => line.length > 0,
  );
}

/**
 * THE STRINGS REPRODUCED FROM THE FORM. Hard rule 12 does not reach them — the
 * government may say its form is approved — but hard rule 3 does.
 */
export function reproducedStringsOf(document: SignedDb4Document): readonly string[] {
  const { printRecord } = document;
  const location = printRecord.servicingLocation;
  const patient = printRecord.patient;
  return [
    ...(printRecord.heading?.lines ?? []),
    printRecord.form?.formCode ?? '',
    printRecord.form?.claimStatus ?? '',
    location?.name ?? '',
    ...(location?.addressLines ?? []),
    patient?.givenNames ?? '',
    patient?.familyName ?? '',
    patient?.address ?? '',
    ...(printRecord.providers ?? []).flatMap((provider) => [provider.name ?? '', provider.role ?? '']),
    ...(printRecord.services ?? []).map((service) => service.description ?? ''),
    ...(printRecord.assignment?.privacyNotice ?? []),
    ...(printRecord.assignment?.statements ?? []).map((statement) => statement.text ?? ''),
    printRecord.referral?.requestingProviderName ?? '',
  ].filter((line) => line.length > 0);
}

/**
 * THE RENDER-TIME GUARD FOR THIS ARTEFACT KIND. Narrow, and every part of it
 * argued above: hard rule 3 over everything, hard rule 12 over our own words
 * only, and a mandatory provenance line.
 *
 * IT FAILS THE RENDER rather than redacting, for the same reason the agreement
 * path does — a redacted form is a form nobody can explain — and nobody is
 * blocked from being seen or billed by it (hard rule 8): the agreement is
 * already signed and stored before this page is drawn at all.
 */
export function assertSignedDb4Renderable(document: SignedDb4Document): void {
  if (document.content.footer.provenance.trim().length === 0) {
    throw new SignedDb4RenderRefusal(
      'HARD-12',
      'The Signed-DB4 would print without its provenance line. That line is what stops the reproduced ' +
        '"approved form" heading being read as a claim about our page (D-2026-09-14-02).',
    );
  }

  for (const line of ourStringsOf(document)) {
    if (APPROVAL_CLAIM.test(line)) {
      throw new SignedDb4RenderRefusal(
        'HARD-12',
        `The Signed-DB4 would claim in our own words that it is certified, approved or accredited ` +
          `("${clip(line)}"). The permitted phrase is "checked against the s 65C data set" (REQ-65C-05). ` +
          'The form\'s own heading is reproduced from the print record and is not this.',
      );
    }
  }

  for (const line of [...ourStringsOf(document), ...reproducedStringsOf(document)]) {
    if (PRACTITIONER_SIGNATURE.test(line)) {
      throw new SignedDb4RenderRefusal(
        'HARD-03',
        `The Signed-DB4 would render a practitioner signature field ("${clip(line)}"). That was abolished ` +
          'on 1 July 2026 and no artefact may offer one — including a reproduction of a form that still ' +
          'prints it (DB4-AND-AOBL.md section 1d).',
      );
    }
  }
}

function clip(line: string): string {
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
