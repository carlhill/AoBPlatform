import { createHash } from 'node:crypto';
import type { RenderedAgreementTemplate } from '@aobplatform/domain';

/**
 * WHAT IS ACTUALLY RENDERED — the whole document, assembled once at lock time
 * and stored, so that "re-render it and compare the hash" has something
 * complete to re-render (hard rule 13; Carl, 5 Sep 2026, W1).
 *
 * WHY THIS TYPE EXISTS AT ALL. Until now the render input was the s 65C
 * particulars and nothing else, and the PDF said so: a patient's name, a date,
 * and a list of keys. Everything a person would recognise as an agreement —
 * whose practice it is, what the words mean, what they are agreeing to — was
 * either missing or written inline in a React component. Worse for rule 13:
 * the 4 September note that "correcting a DOB or an address changed no byte"
 * was true precisely because the bytes were derived from a payload that did
 * not contain those things. A render that omits a field cannot detect a change
 * to it.
 *
 * SO THE DOCUMENT IS THE HASHED UNIT. Letterhead, resolved template words and
 * particulars together. Change any of them after the lock and the bytes move,
 * which is what HARD-02 (corrections supersede, they do not edit) needs to be
 * true rather than merely stated.
 *
 * IT IS STORED, NOT RECOMPUTED. `Agreement.renderPayload` holds this object
 * verbatim. Recomputing it at verification time from the practice's CURRENT
 * letterhead and the CURRENT template would make every stored hash stop
 * verifying the day a practice changed its phone number — the same reason
 * renderers are versioned rather than edited.
 *
 * THE LOGO IS A REFERENCE, NOT BYTES. A 512 KB base64 blob on every agreement
 * row would be the same file stored ten thousand times. The artefact store is
 * content-addressed and verifies the hash on the way out, so `logoSha256` is
 * enough — and it is the reason the console's "remove logo" clears the
 * practice's POINTER and never deletes the artefact: agreements signed under
 * that letterhead have to keep re-verifying (rule 11 — the vault is
 * append-only, and evidence outlives its subject).
 */
export interface AgreementLetterhead {
  /** The ABR legal entity name, or the practice's own name where there is none. */
  readonly legalName: string;
  /** What they trade as, when it differs from the legal name. */
  readonly tradingName?: string;
  readonly address?: string;
  readonly phone?: string;
  readonly email?: string;
  /** Already grouped — "12 345 678 901". Never a bare digit run. */
  readonly abn?: string;
  readonly logoSha256?: string;
  readonly logoContentType?: string;
}

export interface AgreementDocument {
  /**
   * WHOSE LETTERHEAD, AND WHOSE LOGO TO RESOLVE. Not in `particulars`, because
   * that object is the rules engine's payload and a scoping id is not a
   * particular of the agreement — but in the document, because the renderer
   * needs it to fetch the logo bytes and because a stored payload that cannot
   * say which practice it belongs to cannot be re-rendered at all.
   */
  readonly practiceId: string;
  /** The s 65C snapshot, exactly as the rules engine validated it. Never edited here. */
  readonly particulars: Record<string, unknown>;
  readonly letterhead: AgreementLetterhead;
  /** Recorded on the agreement too, so "which letterhead was on it" is a query. */
  readonly letterheadHash: string;
  /** The words, with every placeholder already substituted. */
  readonly template: RenderedAgreementTemplate;
  /**
   * THE "DRAFT — PENDING REVIEW" LINE, DECIDED AT LOCK AND STORED (not decided
   * at render).
   *
   * A marker that read the environment at render time would put a line on a
   * development render and not on a production one, so an agreement locked in
   * one and re-verified in the other would fail its own hash check. Rule 13
   * does not bend for a debugging aid. So the lock decides it once, from the
   * template's status and the environment it locked in, and stores the answer.
   */
  readonly draftMarker: boolean;
}

/**
 * A stable identity for the letterhead, so an agreement can say which one it
 * was made under without storing a second copy of it.
 *
 * The logo participates through its own sha256, which is what makes "the
 * practice re-exported its logo at twice the resolution" a different
 * letterhead — correctly, because it is a different file and a different page.
 */
export function letterheadHashOf(letterhead: AgreementLetterhead): string {
  return createHash('sha256').update(canonicalJson(letterhead), 'utf8').digest('hex');
}

/**
 * Group an ABN the way the register prints it. Returns undefined rather than a
 * malformed group for anything that is not eleven digits: a letterhead saying
 * "ABN 1234" is worse than a letterhead saying nothing.
 */
export function formatAbn(abn: string | null | undefined): string | undefined {
  const digits = (abn ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return undefined;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

/**
 * THE RENDER-TIME GUARD. Hard rules 3, 4 and 12, checked against the exact
 * strings that are about to become bytes.
 *
 * WHY HERE AS WELL AS IN THE TEMPLATE LOADER. The loader checks the TEMPLATE;
 * this checks the DOCUMENT, which is the template with real values
 * substituted into it. The two are not the same check: a template whose every
 * line is clean can still render "…to Dr Approved Medical Centre" or a service
 * description that somebody typed a dollar figure into. The values come from
 * the practice's records and from the PMS, and neither is ours.
 *
 * IT FAILS THE RENDER rather than redacting. A redacted contract is a contract
 * nobody can explain; a refused render stops at the lock, where a person can
 * see the reason and fix the record it came from — and nobody is blocked from
 * being seen or billed (hard rule 8).
 */
export class RenderRefusal extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'RenderRefusal';
  }
}

/** Hard rule 4. "Medicare benefit" is the thing assigned; a figure is not. */
const AMOUNT =
  /(\$|¢|€|£|\bAUD\b|\bdollars?\b|\bcents?\b|\bbenefit amount\b|\brebate\b|\bgap payment\b|\b\d+\.\d{2}\b)/i;
/** Hard rule 3 — abolished 1 July 2026; blocked defensively wherever text is drawn. */
const PRACTITIONER_SIGNATURE =
  /((practitioner|provider|doctor|physician|clinician)(['’]s)?\s+(signature|sign here|to sign)|signature of (the )?(practitioner|provider|doctor|physician|clinician)|signed by (the )?(practitioner|provider|doctor|physician|clinician))/i;
/** Hard rule 12 — never about our forms. */
const APPROVAL = /\b(certified|accredited|government-approved|approved)\b/i;

/**
 * Every string that will be drawn on the page, in one list — including the
 * particulars' own values, because a service description or a provider name is
 * as much a line on the contract as a template paragraph is.
 */
export function renderedStringsOf(document: AgreementDocument): readonly string[] {
  const { template, letterhead, particulars } = document;
  return [
    template.title,
    ...template.sections.flatMap((s) => [s.heading, ...s.paragraphs]),
    ...template.statements.map((s) => s.text),
    ...template.footer,
    letterhead.legalName,
    letterhead.tradingName ?? '',
    letterhead.address ?? '',
    letterhead.phone ?? '',
    letterhead.email ?? '',
    ...Object.values(particulars).map((v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))),
  ].filter((line) => line.length > 0);
}

export function assertRenderable(document: AgreementDocument): void {
  for (const line of renderedStringsOf(document)) {
    if (AMOUNT.test(line)) {
      throw new RenderRefusal(
        'HARD-04',
        `The agreement would render a benefit or dollar amount ("${clip(line)}"). No agreement artefact ` +
          'may carry one (REQ-REG-04); a reg 89AA notice is a different document.',
      );
    }
    if (PRACTITIONER_SIGNATURE.test(line)) {
      throw new RenderRefusal(
        'HARD-03',
        `The agreement would render a practitioner signature field ("${clip(line)}"). That was abolished ` +
          'on 1 July 2026 and no artefact may offer one.',
      );
    }
    if (APPROVAL.test(line)) {
      throw new RenderRefusal(
        'HARD-12',
        `The agreement would claim it is certified, approved or accredited ("${clip(line)}"). The ` +
          'permitted phrase is "checked against the s 65C data set" (REQ-65C-05).',
      );
    }
  }
}

function clip(line: string): string {
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/**
 * Sorted-key JSON. The one definition, shared by the document hash and by both
 * renderers, because two implementations of "canonical" is one too many.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/** True for a stored payload that is a whole document rather than bare particulars. */
export function isAgreementDocument(payload: unknown): payload is AgreementDocument {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.practiceId === 'string' &&
    typeof p.particulars === 'object' &&
    p.particulars !== null &&
    typeof p.letterhead === 'object' &&
    p.letterhead !== null &&
    typeof p.template === 'object' &&
    p.template !== null
  );
}
