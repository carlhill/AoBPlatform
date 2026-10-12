/**
 * THE WORDS AND THE GEOMETRY OF THE SIGNED-DB4 — versioned content, loaded and
 * validated at module load (hard rule 14; D-2026-09-14-02).
 *
 * WHAT THE SIGNED-DB4 IS, so this file's narrow job is clear. It is AoB's
 * deterministic reproduction of the DB4 the practice's billing software
 * printed, with the cost on it, the Medicare card number on it, and the
 * patient's signature at the bottom — one form in the chart folder, which is
 * what the practice asked for. It is ITS OWN ARTEFACT KIND and not an
 * agreement artefact: hard rule 4's prohibition on a dollar amount is about the
 * instrument AoB originates, and this page originates nothing — every value on
 * it is reproduced from the practice's own record.
 *
 * SO WHAT IS IN HERE IS ONLY WHAT WE AUTHOR. The labels beside the reproduced
 * values, the page geometry, and the footer. Not one patient detail, not one
 * service row, not one heading line, not the privacy notice and not the
 * assignment statements: all of those are DATA, read from the DB4 Print Record
 * and drawn verbatim. The split is the whole safety argument for the footer
 * (below) and for the render-time guard in `apps/core/src/render/
 * signed-db4-document.ts`, which holds OUR strings to hard rule 12 and holds
 * the reproduced ones only to hard rule 3.
 *
 * WHY THE FOOTER IS CONTENT AND NOT A CONSTANT. The DB4's third heading line
 * is the government saying its form is the approved form. D-2026-09-14-02 keeps
 * that line verbatim — altering the words on a reproduction of somebody else's
 * form would be the stranger act — and answers it with a provenance line
 * saying whose page this actually is. The exact wording is still an OPEN RULING
 * (`DB4-AND-AOBL.md` section 10 item 0), so it lives in a content file with a
 * defensible default: settling it later is an edit and a version bump, not a
 * rebuild. Regulatory whipsaw is the top project risk and versioned content is
 * the defence.
 *
 * AND THE LOADER REFUSES A FOOTER THAT UNDOES IT. A content file whose footer
 * claims this page is certified, approved or accredited fails the build
 * (hard rule 12, REQ-65C-05). The footer exists to stop the heading being read
 * as our claim; an edit that put the claim in the footer itself would be the
 * one edit that turns the guard inside out, so it is the one edit this refuses.
 *
 * WHY THE VALIDATION IS HAND-WRITTEN AND NOT ZOD: `@aobplatform/domain` has
 * zero runtime dependencies by charter (CONVENTIONS.md section 1), and the same
 * reasoning as `assignor-relationships.ts`, which this follows deliberately.
 */
import content from '../content/signed-db4.json';

export interface SignedDb4Layout {
  /** Page margin, in PDF points. A4 is 595 x 842. */
  readonly marginPoints: number;
  readonly titleSize: number;
  readonly headingSize: number;
  readonly bodySize: number;
  readonly smallSize: number;
  /** Date, time, item, description, benefit — in that order, in points. */
  readonly serviceColumnWidths: readonly number[];
}

/**
 * THE FIXED LABELS, and the list is closed. An unknown key is a refused load
 * rather than a silently ignored one: a typo in a content file that renders a
 * blank label onto stored evidence is worse than a build that stops.
 */
export const SIGNED_DB4_LABEL_KEYS = [
  'formReference',
  'locationId',
  'claimStatus',
  'serviceDate',
  'servicingLocation',
  'patient',
  'patientRecordNumber',
  /**
   * THE LABEL, NOT THE NUMBER. Deliberately not named after the field it sits
   * beside: the repo's lint rule fires on an identifier spelled like the card
   * number, and it is right to, because that name in code is the single most
   * likely design mistake in this product (hard rule 1, REQ-VER-02). Printing
   * the number on a reproduction of the government's own form is not using it
   * to identify anybody (D-2026-09-14-03), and a label does not need to borrow
   * the name to prove it.
   */
  'medicareCard',
  'irn',
  'dateOfBirth',
  'address',
  'providers',
  'servicingProvider',
  'payeeProvider',
  'providerNumber',
  'services',
  'columnDate',
  'columnTime',
  'columnItem',
  'columnDescription',
  'columnBenefit',
  'privacyNotice',
  'assignment',
  'referral',
  'acrf',
  'lspn',
  'requestingProvider',
  'requestingProviderNumber',
  'dateOfRequest',
  'periodOfReferral',
  'signature',
  'signedAt',
  'capturedAt',
  /** What is drawn where the form left a field empty. Never a guess at the value. */
  'notProvided',
] as const;

export type SignedDb4LabelKey = (typeof SIGNED_DB4_LABEL_KEYS)[number];

export type SignedDb4Labels = { readonly [K in SignedDb4LabelKey]: string };

export interface SignedDb4Footer {
  /** The provenance line. Says whose page this is, so the heading cannot be read as our claim. */
  readonly provenance: string;
  /** Anything else printed under it, in order. May be empty. */
  readonly lines: readonly string[];
}

export interface SignedDb4Content {
  /** Recorded on every agreement whose Signed-DB4 came from it. Bump on every edit. */
  readonly version: string;
  readonly layout: SignedDb4Layout;
  readonly labels: SignedDb4Labels;
  readonly footer: SignedDb4Footer;
}

/** A4, and the renderer draws portrait. Used only to check the columns fit. */
const A4_WIDTH_POINTS = 595;

/**
 * HARD RULE 12, APPLIED TO WHAT WE AUTHOR.
 *
 * A SECOND COPY OF THE PATTERN, ON PURPOSE. `apps/core/src/render/
 * agreement-document.ts` has one for ordinary agreements and it must not gain
 * a consumer outside the agreement path: the whole reason the Signed-DB4 is
 * its own artefact kind is that the guards protecting every ordinary agreement
 * must not weaken by one character, and a shared regex is a shared pressure
 * point. This one is also narrower in scope — it runs over the content file
 * only, at load, so a bad edit fails the build rather than a patient.
 */
const APPROVAL_CLAIM = /\b(certified|accredited|government-approved|approved)\b/i;

/**
 * Exhaustive, and it throws rather than repairing — the same contract as
 * `parseAssignorRelationshipContent`, and for the same reason: the whole point
 * of an editable file is that somebody will edit it.
 */
export function parseSignedDb4Content(raw: unknown): SignedDb4Content {
  const fail = (why: string): never => {
    throw new Error(
      `content/signed-db4.json is not usable: ${why}. This file is versioned content (hard rule 14) ` +
        'and is validated at load so a bad edit fails the build rather than a patient.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }

  if (typeof doc.layout !== 'object' || doc.layout === null) return fail('`layout` must be an object');
  const rawLayout = doc.layout as Record<string, unknown>;
  const positive = (key: string): number => {
    const value = rawLayout[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fail(`\`layout.${key}\` must be a positive number`);
    }
    return value;
  };
  const marginPoints = positive('marginPoints');
  const layout: SignedDb4Layout = {
    marginPoints,
    titleSize: positive('titleSize'),
    headingSize: positive('headingSize'),
    bodySize: positive('bodySize'),
    smallSize: positive('smallSize'),
    serviceColumnWidths: ((): readonly number[] => {
      const widths = rawLayout.serviceColumnWidths;
      if (!Array.isArray(widths) || widths.length !== 5) {
        return fail('`layout.serviceColumnWidths` must be five numbers (date, time, item, description, benefit)');
      }
      widths.forEach((width, index) => {
        if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
          return fail(`\`layout.serviceColumnWidths[${index}]\` must be a positive number`);
        }
        return undefined;
      });
      const total = (widths as number[]).reduce((sum, width) => sum + width, 0);
      const available = A4_WIDTH_POINTS - 2 * marginPoints;
      if (total > available) {
        return fail(
          `\`layout.serviceColumnWidths\` sum to ${total} points and only ${available} are available inside ` +
            'the margins on A4',
        );
      }
      return widths as readonly number[];
    })(),
  };

  if (typeof doc.labels !== 'object' || doc.labels === null) return fail('`labels` must be an object');
  const rawLabels = doc.labels as Record<string, unknown>;
  const labels: Record<string, string> = {};
  for (const key of SIGNED_DB4_LABEL_KEYS) {
    const value = rawLabels[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return fail(`\`labels.${key}\` must be a non-empty string`);
    }
    labels[key] = value;
  }
  for (const key of Object.keys(rawLabels)) {
    // `$comment` is the one key every content file in this directory carries.
    if (key === '$comment') continue;
    if (!(SIGNED_DB4_LABEL_KEYS as readonly string[]).includes(key)) {
      return fail(`\`labels.${key}\` is not a label this renderer draws — remove it or add it to the renderer`);
    }
  }

  if (typeof doc.footer !== 'object' || doc.footer === null) return fail('`footer` must be an object');
  const rawFooter = doc.footer as Record<string, unknown>;
  if (typeof rawFooter.provenance !== 'string' || rawFooter.provenance.trim().length === 0) {
    return fail(
      '`footer.provenance` must be a non-empty string — it is the line that says whose page this is, and ' +
        'without it the reproduced heading reads as our own claim (hard rule 12, D-2026-09-14-02)',
    );
  }
  if (!Array.isArray(rawFooter.lines)) return fail('`footer.lines` must be an array');
  const footerLines = rawFooter.lines.map((line, index) => {
    if (typeof line !== 'string' || line.trim().length === 0) {
      return fail(`\`footer.lines[${index}]\` must be a non-empty string`);
    }
    return line;
  });

  for (const line of [rawFooter.provenance, ...footerLines]) {
    if (APPROVAL_CLAIM.test(line)) {
      return fail(
        `the footer would claim this page is certified, approved or accredited ("${line.slice(0, 60)}…"). ` +
          'The footer is the line that stops the reproduced heading being read as our claim; putting the ' +
          'claim in it is the one edit that turns the guard inside out (hard rule 12, REQ-65C-05)',
      );
    }
  }

  return {
    version: doc.version,
    layout,
    labels: labels as SignedDb4Labels,
    footer: { provenance: rawFooter.provenance, lines: footerLines },
  };
}

const parsed = parseSignedDb4Content(content);

/**
 * The words and geometry in force now. A produced Signed-DB4 stores a COPY of
 * this object inside its render payload, so editing the file never moves the
 * bytes of a Signed-DB4 that already exists (hard rule 13) — the same
 * discipline as an agreement storing its resolved template rather than a
 * pointer to one.
 */
export const SIGNED_DB4_CONTENT: SignedDb4Content = parsed;

/** Recorded on the agreement, so "which wording produced this page" is a query. */
export const SIGNED_DB4_CONTENT_VERSION: string = parsed.version;
