import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApprovedIdentifierType } from '@aobplatform/domain';

/**
 * Normalisation + constant-time comparison for stated identifiers (FR-3.1).
 * Values exist only inside this comparison — they are never stored, never
 * logged, never returned (REQ-VER-04, HARD-04).
 */

export interface PatientIdentityRecord {
  familyName: string;
  givenNames: string;
  dateOfBirth: Date;
  genderAsIdentified?: string | null;
  address?: string | null;
  patientRecordNumber?: string | null;
  ihi?: string | null;
}

function collapse(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A name is one identifier whichever way round it is said. The PMS holds
 * family name first; a patient types given name first. Sorting the tokens
 * makes the two orderings compare equal without weakening the match — the
 * same tokens still have to be present.
 */
function collapseName(value: string): string {
  return collapse(value).split(' ').sort().join(' ');
}

/** Normalises a held or stated value for one identifier type. Returns null when the record has no value to match. */
export function normalisedHeldValue(type: ApprovedIdentifierType, record: PatientIdentityRecord): string | null {
  switch (type) {
    case 'name':
      // Family + given names together count as ONE identifier (REQ-VER-02).
      return collapseName(`${record.familyName} ${record.givenNames}`);
    case 'date_of_birth':
      return record.dateOfBirth.toISOString().slice(0, 10);
    case 'gender':
      return record.genderAsIdentified ? collapse(record.genderAsIdentified) : null;
    case 'address':
      // Kept for callers and tests that want a normalised form. The actual
      // address COMPARISON is `addressMatches` (token containment), not this.
      return record.address ? collapse(record.address).replace(/[.,]/g, '') : null;
    case 'patient_record_number':
      return record.patientRecordNumber ? record.patientRecordNumber.trim().toUpperCase() : null;
    case 'ihi':
      return record.ihi ? record.ihi.replace(/\D/g, '') : null;
  }
}

export function normaliseStatedValue(type: ApprovedIdentifierType, stated: string): string {
  switch (type) {
    case 'name':
      return collapseName(stated);
    case 'date_of_birth':
      return stated.trim().slice(0, 10);
    case 'gender':
      return collapse(stated);
    case 'address':
      return collapse(stated).replace(/[.,]/g, '');
    case 'patient_record_number':
      return stated.trim().toUpperCase();
    case 'ihi':
      return stated.replace(/\D/g, '');
  }
}

/** Name tokens: case-folded, hyphens and apostrophes treated as spaces ("Smith-Jones" is "smith jones"). */
function nameTokens(value: string): string[] {
  return collapse(value.replace(/[-'’]/g, ' ')).split(' ').filter(Boolean);
}

/**
 * The name rule (Carl, 3 Sep 2026): the stated name must contain the held
 * FAMILY name and the FIRST given name. Order and any further given names are
 * ignored — "Jamie Sampleton", "Sampleton Jamie" and "Jamie Lee Sampleton" all
 * match a record of Sampleton / Jamie Lee. Extra tokens never help an attacker;
 * a missing required token always fails. Every required token is checked, so
 * a miss on the first costs the same as a miss on the last.
 */
export function nameMatches(stated: string, record: PatientIdentityRecord): boolean {
  const required = [...nameTokens(record.familyName), ...nameTokens(record.givenNames).slice(0, 1)];
  if (required.length === 0) return false;
  const statedTokens = nameTokens(stated);
  let all = true;
  for (const token of required) {
    let present = false;
    for (const s of statedTokens) if (constantTimeMatch(s, token)) present = true;
    if (!present) all = false;
  }
  return all;
}

/**
 * Street-type abbreviations, expanded on BOTH sides so the two spellings of
 * the same address collapse to the same tokens. The PMS writes what the
 * receptionist typed ("2 Example Street"); the kiosk gets what the patient
 * typed ("2 Example St"). Neither is wrong and the old whole-string equality
 * failed the pair.
 *
 * State and territory abbreviations are deliberately ABSENT from this map —
 * "nsw" stays "nsw" on both sides, which is all the comparison needs. Expanding
 * them would only add a second spelling to get wrong.
 *
 * "st" is also how "Saint" is abbreviated in suburb names. Expanding it on both
 * sides makes "St Marys" and "Saint Marys" compare as "street marys" either
 * way — ugly, symmetrical, and harmless.
 */
const ADDRESS_ABBREVIATIONS: Readonly<Record<string, string>> = {
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  cres: 'crescent',
  pl: 'place',
  dr: 'drive',
  ct: 'court',
  hwy: 'highway',
  tce: 'terrace',
  pde: 'parade',
  bvd: 'boulevard',
  blvd: 'boulevard',
  ln: 'lane',
  cl: 'close',
  unit: 'unit',
  u: 'unit',
};

/** Address tokens: case-folded, punctuation to spaces, abbreviations expanded. */
function addressTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((token) => ADDRESS_ABBREVIATIONS[token] ?? token);
}

/**
 * The address rule (Carl, 3 Sep 2026), and it mirrors `nameMatches` on purpose.
 *
 * WHOLE-STRING EQUALITY WAS THE WRONG SHAPE. It compared the patient's typing
 * to the PMS's formatting, so "2 Example St" failed "2 Example Street", a
 * missing comma failed, and a structured form that omits a component the PMS
 * happens to carry failed every time. That is a mismatch screen for somebody
 * who knows their own address — and the screen, correctly, will never tell
 * them which detail it was (REQ-SEC-07).
 *
 * TOKEN CONTAINMENT INSTEAD: every token the patient stated must appear among
 * the tokens the practice holds. Extra held tokens (a unit number, a state the
 * patient left out) never hurt; a token the practice does NOT hold always
 * fails, so the check cannot be walked through with noise.
 *
 * TWO FLOORS KEEP IT MEANINGFUL, because containment alone would pass on
 * "NSW". The stated tokens must carry a four-digit postcode AND a separate
 * digit-bearing token — the street or unit number. That is enough to be an
 * address without this function having to parse the PMS's address format,
 * which it must not try to do: there is no agreed format to parse.
 *
 * Every token is evaluated — no early exit — and each comparison goes through
 * `constantTimeMatch`, so a miss on the first token costs what a miss on the
 * last one costs.
 */
export function addressMatches(stated: string, record: PatientIdentityRecord): boolean {
  if (!record.address) return false;
  const held = addressTokens(record.address);
  const statedTokens = addressTokens(stated);
  if (held.length === 0 || statedTokens.length === 0) return false;

  // Shape checks, on the STATED value only — nothing here reads the held one.
  const postcodeIndex = statedTokens.findIndex((token) => /^\d{4}$/.test(token));
  const hasPostcode = postcodeIndex >= 0;
  const hasStreetNumber = statedTokens.some((token, index) => index !== postcodeIndex && /\d/.test(token));

  let all = true;
  for (const token of statedTokens) {
    let present = false;
    for (const heldToken of held) if (constantTimeMatch(heldToken, token)) present = true;
    if (!present) all = false;
  }
  return all && hasPostcode && hasStreetNumber;
}

/** Constant-time equality over the normalised values — no early exit an attacker can time. */
export function constantTimeMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Evaluates ALL challenged identifiers (never short-circuits on first
 * mismatch — uniform timing) and reports only the aggregate. Which identifier
 * failed is never disclosed (REQ-SEC-07, FR-3.1).
 */
export function evaluateChallenge(
  types: readonly ApprovedIdentifierType[],
  stated: Readonly<Record<string, string>>,
  record: PatientIdentityRecord,
): boolean {
  let allMatch = true;
  for (const type of types) {
    const held = normalisedHeldValue(type, record);
    const statedRaw = stated[type];
    if (held === null || statedRaw === undefined || statedRaw.trim() === '') {
      allMatch = false;
      continue;
    }
    // `name` and `address` are the two identifiers a person writes differently
    // from the way a practice records them, so both go through a token rule
    // rather than string equality. The other four are exact by nature.
    const matched = type === 'name'
      ? nameMatches(statedRaw, record)
      : type === 'address'
        ? addressMatches(statedRaw, record)
        : constantTimeMatch(held, normaliseStatedValue(type, statedRaw));
    if (!matched) allMatch = false;
  }
  return allMatch;
}
