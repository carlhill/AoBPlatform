/**
 * Does the evidence actually evidence anything?
 *
 * Two failures this catches, both raised from real use:
 *
 *   1. THE SAME FILE ATTACHED TO SEVERAL CHECKS. A reviewer with one PDF open
 *      attaches it to whatever check is asking, and the checklist fills up with
 *      a document that supports one of the things it is cited for. This is the
 *      purest form of evidence theatre: every box has a paperclip and the file
 *      behind them is the same.
 *
 *   2. A FILE THAT DOES NOT CONTAIN WHAT IT IS SUPPOSED TO PROVE. An "ABN is
 *      ACTIVE" check evidenced by a document that never mentions the ABN.
 *
 * BOTH WARN. NEITHER BLOCKS. That is a deliberate position, not timidity:
 *
 *   - A hash block is defeated by re-exporting the file, which changes the
 *     bytes and nothing else. It would stop the honest mistake and wave through
 *     anyone actually trying, which is the worst combination — false assurance.
 *   - Content matching cannot prove authenticity. A screenshot showing the
 *     right ABN can be fabricated in a minute. Treating a match as proof would
 *     make the platform easier to fool, not harder.
 *
 * What a warning does that a block cannot: it puts a specific, checkable
 * statement in front of the person deciding — "this is the same file you
 * attached to the phone-call check" — at the moment they can still act on it,
 * and leaves it visible to whoever reads the record later.
 */

export interface AttachedElsewhere {
  readonly sha256: string;
  readonly filename: string | null;
  /** Human labels of the checks this identical file is already cited for. */
  readonly alreadyCitedFor: readonly string[];
}

export type EvidenceWarningKind = 'duplicate' | 'identifier_absent' | 'unreadable';

export interface EvidenceWarning {
  readonly kind: EvidenceWarningKind;
  readonly message: string;
}

/**
 * The same bytes, cited for something else.
 *
 * Compared on SHA-256, which is already computed for every artefact — the hash
 * exists so a file read in a dispute can be shown to be the file uploaded now,
 * and duplicate detection is a free second use of it.
 */
export function duplicateWarning(found: AttachedElsewhere | null): EvidenceWarning | null {
  if (!found || found.alreadyCitedFor.length === 0) return null;

  const cited = found.alreadyCitedFor;
  const list =
    cited.length === 1
      ? `“${cited[0]}”`
      : `${cited.slice(0, -1).map((c) => `“${c}”`).join(', ')} and “${cited[cited.length - 1]}”`;

  return {
    kind: 'duplicate',
    message:
      `This is byte-for-byte the same file already attached to ${list}. That is sometimes legitimate — one ` +
      'certificate can evidence two things — and it is also what it looks like when a document is attached ' +
      'because it was to hand. Worth a moment before saving.',
  };
}

/** Digits only, so "27 734 610 304" and "27734610304" compare equal. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Whether an identifier appears anywhere in the extracted text.
 *
 * Matches on DIGITS ONLY after stripping everything else, because an ABN is
 * printed with spaces on the register, without them in most systems, and
 * sometimes with non-breaking spaces in a PDF. Comparing the raw strings finds
 * nothing and would report a false absence, which is worse than no check —
 * a reviewer who learns the warning cries wolf stops reading it.
 */
export function containsIdentifier(text: string, identifier: string): boolean {
  const needle = digitsOnly(identifier);
  if (needle.length < 6) return false;
  return digitsOnly(text).includes(needle);
}

export function identifierWarning(input: {
  readonly extracted: string | null;
  readonly identifier: string;
  readonly identifierLabel: string;
  readonly filename: string | null;
}): EvidenceWarning | null {
  const what = input.filename ? `“${input.filename}”` : 'that file';

  if (input.extracted === null) {
    // An image, or a PDF whose text could not be recovered. Say so plainly
    // rather than silently passing — "we could not check" and "we checked and
    // it was fine" are different facts and must not look the same.
    return {
      kind: 'unreadable',
      message:
        `We could not read any text out of ${what}, so we cannot tell whether it shows the ${input.identifierLabel}. ` +
        'Scans and screenshots are images to us. Check it yourself before recording this as passed.',
    };
  }

  if (containsIdentifier(input.extracted, input.identifier)) return null;

  return {
    kind: 'identifier_absent',
    message:
      `The ${input.identifierLabel} ${input.identifier} does not appear anywhere in ${what}. Either this is ` +
      'the wrong file, or it shows the entity without the number. Attaching it as proof of the ' +
      `${input.identifierLabel} would put something in the record that does not support the claim.`,
  };
}

/**
 * Whether a match should be read as reassurance. It should not, much.
 *
 * Deliberately exported so callers cannot quietly convert "the number is in the
 * file" into "the check is verified". Finding the ABN proves the document
 * mentions it — a fabricated screenshot mentions it just as reliably.
 */
export const IDENTIFIER_MATCH_MEANS =
  'The file mentions this identifier. That is not proof the document is genuine — a fabricated screenshot ' +
  'would contain it too — so it rules out the wrong file and nothing more.';
