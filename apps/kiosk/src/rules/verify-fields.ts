/**
 * The structured sub-fields of the three composite identifiers, and the pure
 * functions that turn them back into the one string per identifier type that
 * `POST /verification/challenges/:id/attempt` takes.
 *
 * THE WIRE CONTRACT DID NOT CHANGE. The server still receives
 * `stated: Record<identifierType, string>` — one value per type, exactly as
 * before. What changed is who does the formatting: the patient used to be
 * asked to produce "1962-08-04" and a one-line address in whatever shape the
 * practice happened to have typed it, and now the screen collects the parts
 * and composes the string itself.
 *
 * COMPOSITION IS HERE, NOT IN THE SCREEN, because it is the half of the
 * verification behaviour that can be tested without rendering anything —
 * including the country rule below, which is easy to break by being helpful.
 *
 * NOTHING IS STORED. These are pure functions over component state that the
 * ceremony drops after the attempt (REQ-VER-04); no value reaches a log, a
 * cache or this device's disk.
 */
import { strings } from '../strings';

export interface NameParts {
  readonly family: string;
  readonly given: string;
}

export interface DateOfBirthParts {
  /** Empty, or 1–31 as typed by the picker. */
  readonly day: string;
  /** Empty, or '01'–'12'. The picker shows the month NAME; the value is the number. */
  readonly month: string;
  readonly year: string;
}

export interface AddressParts {
  readonly line1: string;
  readonly line2: string;
  readonly suburb: string;
  readonly state: string;
  readonly postcode: string;
  readonly country: string;
}

export interface IdentifierParts {
  readonly name: NameParts;
  readonly dateOfBirth: DateOfBirthParts;
  readonly address: AddressParts;
}

export const EMPTY_PARTS: IdentifierParts = {
  name: { family: '', given: '' },
  dateOfBirth: { day: '', month: '', year: '' },
  address: { line1: '', line2: '', suburb: '', state: '', postcode: '', country: strings.verify.defaultCountry },
};

/** The identifier types this module composes. Everything else is a plain text field. */
export const STRUCTURED_IDENTIFIER_TYPES = ['name', 'date_of_birth', 'address'] as const;

export function isStructured(type: string): boolean {
  return (STRUCTURED_IDENTIFIER_TYPES as readonly string[]).includes(type);
}

/**
 * GIVEN NAME FIRST, then family name — which is the order a person says it and
 * the order the server's `nameMatches` is indifferent to. It compares the held
 * family name and first given name as tokens in any order, so this composition
 * only has to be complete, not ordered.
 */
export function composeName(parts: NameParts): string {
  return [parts.given, parts.family].map((part) => part.trim()).filter(Boolean).join(' ');
}

/**
 * ISO `YYYY-MM-DD`, because that is what the server compares against: it takes
 * the first ten characters of the stated value and matches them against the
 * date it holds. The patient never sees this format and is never asked to type
 * it — three pickers produce it.
 *
 * Returns '' until all three parts are chosen, so a half-filled date can never
 * be sent as a whole one.
 */
export function composeDateOfBirth(parts: DateOfBirthParts): string {
  if (!parts.day || !parts.month || !parts.year) return '';
  return `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`;
}

/**
 * COUNTRY IS COLLECTED AND DELIBERATELY NOT SENT.
 *
 * The practice's record carries a street address, a suburb, a state and a
 * postcode; it does not carry a country, and the server does not compare one.
 * The server's address rule is token containment — every token the patient
 * states must appear in the value the practice holds — so appending
 * "Australia" would add a token that can never be matched and would fail every
 * single attempt. The field exists because an address form without a country
 * looks broken and because the day this product sees an overseas address the
 * value is already being collected.
 *
 * The parts are joined with single spaces. Punctuation is not added: the
 * server strips it on both sides anyway, and adding a comma here would only
 * invent a format nobody agreed to.
 */
export function composeAddress(parts: AddressParts): string {
  return [parts.line1, parts.line2, parts.suburb, parts.state, parts.postcode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

/** The composed value for one identifier type, or null when this type is not a composite. */
export function composeIdentifier(type: string, parts: IdentifierParts): string | null {
  switch (type) {
    case 'name':
      return composeName(parts.name);
    case 'date_of_birth':
      return composeDateOfBirth(parts.dateOfBirth);
    case 'address':
      return composeAddress(parts.address);
    default:
      return null;
  }
}

/**
 * WHICH PARTS ARE MANDATORY, and no more than that.
 *
 * Address line 2 is optional because most people do not have one, and the
 * state is optional because the server's containment rule treats a component
 * the patient omitted as a component that simply was not stated. Requiring
 * either would block somebody whose address genuinely lacks it — which on this
 * screen means routing a patient to the desk for no reason (REQ-REC-04).
 */
export function partsComplete(type: string, parts: IdentifierParts): boolean {
  switch (type) {
    case 'name':
      return parts.name.family.trim() !== '' && parts.name.given.trim() !== '';
    case 'date_of_birth':
      return composeDateOfBirth(parts.dateOfBirth) !== '';
    case 'address':
      return (
        parts.address.line1.trim() !== ''
        && parts.address.suburb.trim() !== ''
        && parts.address.postcode.trim() !== ''
      );
    default:
      return false;
  }
}

/** True when every challenged identifier has everything it needs to be sent. */
export function readyToSubmit(
  types: readonly string[],
  parts: IdentifierParts,
  stated: Readonly<Record<string, string>>,
): boolean {
  return types.every((type) =>
    isStructured(type) ? partsComplete(type, parts) : (stated[type] ?? '').trim() !== '',
  );
}

export interface Option {
  readonly value: string;
  readonly label: string;
}

/** 1–31. The pickers do not validate the calendar — a wrong date is a mismatch, not an error screen. */
export function dayOptions(): readonly Option[] {
  return Array.from({ length: 31 }, (_, index) => {
    const value = String(index + 1).padStart(2, '0');
    return { value, label: String(index + 1) };
  });
}

/** Month NAMES, valued as '01'–'12'. */
export function monthOptions(): readonly Option[] {
  return strings.verify.monthNames.map((label, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label,
  }));
}

/**
 * The current year back 120. Newest first, because the youngest patient scrolls
 * least — and a 120-year window covers every living person without offering a
 * year that cannot be a date of birth.
 */
export const YEAR_SPAN = 120;

export function yearOptions(now: Date = new Date()): readonly Option[] {
  const thisYear = now.getFullYear();
  return Array.from({ length: YEAR_SPAN + 1 }, (_, index) => {
    const value = String(thisYear - index);
    return { value, label: value };
  });
}

export function stateOptions(): readonly Option[] {
  return strings.verify.stateOptions.map((entry) => ({ value: entry.value, label: entry.label }));
}
