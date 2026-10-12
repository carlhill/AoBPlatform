/* ---------------------------------------------------------------------------
 * DOES THE NAME PRINTED ON THE DB4 MATCH THE PATIENT RECORD IT WAS MATCHED TO?
 * (D-2026-10-10-11; Carl, 10 October 2026: *"B and tell the user to resend to
 * AOBPrinter from PMS"*.)
 *
 * A DB4 Print Record is matched to a patient by PMS PATIENT ID ONLY
 * (`patientRecordNumber`, `db4-assignment.handler.ts`), and that stays. But the tablet's picture of
 * the DB4 and the Signed-DB4 show the name PRINTED on the form, while
 * who-is-signing, the details check, the step headings and the Assignment
 * Agreement show the patient RECORD's name. When the two differ, one signing
 * carries two names. Option B: make it visible to staff.
 *
 * ── A WARNING AND, SINCE 11 OCTOBER 2026, A REFUSAL ──
 *
 * D-2026-10-10-11 made this a warning only. D-2026-10-11-06 (Carl, 11 October
 * 2026) keeps the warning band AND refuses Send to tablet with
 * `print_record_patient_name_differs`, one of `DB4_PRINT_RECORD_CHECKS`. Both
 * are decided by THIS function, so the band and the refusal can never
 * disagree. The refusal stops the tablet, never the visit: the patient is seen
 * and billed either way (hard rule 8, REQ-REC-04).
 *
 * ── THE COMPARISON — what counts as the same name ──
 *
 * Given names and family name are compared SEPARATELY, printed part against
 * recorded part — so a swap of the two flags both, and "Mae Testa" is not
 * quietly "Testa Mae".
 *
 * EXCEPT WHERE THE TWO SPLIT THE SAME NAME DIFFERENTLY (Carl, 11 October 2026).
 * The DB4 template splits a printed name at its LAST space, so "Anna Van Der
 * Berg" comes off the page as given "Anna Van Der", family "Berg", against a
 * record of "Anna" / "Van Der Berg". Part by part those differ, and neither
 * remedy fixes it: a reprint prints the same split, and correcting the record
 * would damage a name that is right. So when BOTH parts were printed and the
 * whole name — given then family, reduced as below — is the same, it is the
 * same name. A swap still differs as a whole ("Mae Testa" is not "Testa Mae"),
 * and so does anything else this file treats as different.
 *
 * Each part is reduced by `comparableNamePart`, and two parts are the same
 * name only when the reductions are EQUAL. The reduction removes rendering
 * differences and nothing else:
 *  - Unicode NFC, so a composed and a decomposed accent are one letter;
 *  - case;
 *  - surrounding whitespace, and runs of internal whitespace (any Unicode
 *    space, including a non-breaking one) collapse to one space;
 *  - typographic apostrophes (’ ‘ ʼ ` ´ ′) read as ', typographic dashes
 *    (‐ ‑ ‒ – — ― − and full-width) read as -, and spacing AROUND an
 *    apostrophe or hyphen is ignored ("O’ Brien" = "O'Brien").
 *
 * WHAT IT DOES NOT DO, ON PURPOSE. It never drops punctuation ("OBrien" is not
 * "O'Brien", "Smith Jones" is not "Smith-Jones"), never strips accents ("Zoe"
 * is not "Zoé"), never ignores a missing middle name, and does no fuzzy,
 * phonetic or edit-distance matching. Every one of those could hide a
 * genuinely different name, and a warning that stays quiet about a real
 * difference is worse than one that occasionally asks staff to look at a
 * spelling: the cost of a false warning is a glance, never a blocked patient.
 *
 * A PART THE FORM DID NOT PRINT IS NOT COMPARED. If the template read no given
 * names (or no family name), that part shows nothing on the tablet's picture,
 * so there is no second name in front of the patient — and with no printed
 * name at all `buildDb4FormView` draws no picture and the tablet uses the
 * record's name throughout. Missing is a reading problem, not a different
 * person, and it is not this warning's business.
 *
 * ── TYPES OUTSIDE A STAFF SCREEN, NEVER VALUES (hard rule 9) ──
 *
 * `parts` names WHICH part differs and can carry no name; it is the only field
 * that may appear in a log line, a metric, an outcome or a vault event. The
 * `printed` and `recorded` names ride ONLY on the practice-scoped staff desk
 * row (behind RLS, where the patient's name already appears) so reception can
 * see both. They never reach a tablet, a log or an event.
 * ------------------------------------------------------------------------- */

/** The reason code. The console maps it to words; an unmapped code shows itself. */
export const DB4_PRINTED_NAME_DIFFERS_CODE = 'print_record_name_differs' as const;

/** WHICH part of a name differs — a type, never a value. In report order. */
export const DB4_NAME_PARTS = ['given_names', 'family_name'] as const;
export type Db4NamePart = (typeof DB4_NAME_PARTS)[number];

/** A name as two parts. Absent/blank on the printed side means "not printed". */
export interface Db4PersonName {
  readonly givenNames?: string | null;
  readonly familyName?: string | null;
}

/**
 * THE WARNING ON A STAFF DESK ROW. `parts` is type-only and safe anywhere;
 * `printed` and `recorded` are names and belong on the staff desk row only.
 */
export interface Db4PrintedNameDifference {
  readonly code: typeof DB4_PRINTED_NAME_DIFFERS_CODE;
  readonly parts: readonly Db4NamePart[];
  /** As printed on the DB4, trimmed. `null` for a part the form did not print. */
  readonly printed: { readonly givenNames: string | null; readonly familyName: string | null };
  /** As held in the practice's patient record on this platform. */
  readonly recorded: { readonly givenNames: string; readonly familyName: string };
}

const APOSTROPHES = /[‘’‛ʼ`´′]/g;
const DASHES = /[‐‑‒–—―−﹣－]/g;

/** One name part reduced for comparison. See the header for exactly what it removes. */
export function comparableNamePart(value: string): string {
  return value
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(DASHES, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/ ?([-']) ?/g, '$1')
    .toLowerCase()
    .normalize('NFC');
}

function printedPart(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Which parts differ, in `DB4_NAME_PARTS` order. Empty when the name matches. */
export function db4PrintedNamePartsDiffering(
  printed: Db4PersonName,
  recorded: { readonly givenNames: string; readonly familyName: string },
): Db4NamePart[] {
  const parts: Db4NamePart[] = [];
  const given = printedPart(printed.givenNames);
  const family = printedPart(printed.familyName);
  if (given !== null && comparableNamePart(given) !== comparableNamePart(recorded.givenNames)) {
    parts.push('given_names');
  }
  if (family !== null && comparableNamePart(family) !== comparableNamePart(recorded.familyName)) {
    parts.push('family_name');
  }
  /*
   * THE SAME NAME, SPLIT IN A DIFFERENT PLACE (see the header). Only when both
   * parts were printed: with one part missing there is no split to disagree
   * about, and the part that was printed stands on its own.
   */
  if (
    parts.length > 0 &&
    given !== null &&
    family !== null &&
    comparableNamePart(`${given} ${family}`) ===
      comparableNamePart(`${recorded.givenNames} ${recorded.familyName}`)
  ) {
    return [];
  }
  return parts;
}

/** The staff-desk warning, or `null` when the printed name matches the record. */
export function db4PrintedNameDifference(
  printed: Db4PersonName,
  recorded: { readonly givenNames: string; readonly familyName: string },
): Db4PrintedNameDifference | null {
  const parts = db4PrintedNamePartsDiffering(printed, recorded);
  if (parts.length === 0) return null;
  return {
    code: DB4_PRINTED_NAME_DIFFERS_CODE,
    parts,
    printed: { givenNames: printedPart(printed.givenNames), familyName: printedPart(printed.familyName) },
    recorded: { givenNames: recorded.givenNames, familyName: recorded.familyName },
  };
}
