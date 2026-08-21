/**
 * Finding a practice in a list.
 *
 * WHAT PEOPLE ACTUALLY TYPE, which is the only thing that matters here. Not
 * "select a field, then enter a value" — a practice manager looking for a
 * clinic types whichever fragment they happen to have to hand: half a name, an
 * ABN off an invoice, the mobile number of the person who rang them, an email
 * from a thread. One box, matched against everything.
 *
 * THE NORMALISATION IS THE FEATURE. A search that fails on the way somebody
 * wrote a number is worse than no search, because it answers "nothing found"
 * to a question whose answer was on the screen:
 *
 *     ABN 27 734 610 304   typed as   27734610304
 *     phone 0408 169 971   typed as   +61408169971
 *     Carl@Hillsempire.com typed as   carl@hillsempire
 *
 * All three are the same query and all three must match. ABNs are compared on
 * digits alone; phones go through the SAME normaliser the contact-independence
 * rule uses, so "these are the same phone" means the same thing in both places;
 * and text is a case-insensitive substring.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: rank, score or fuzzy-match. A list of four
 * practices does not need relevance ordering, and a fuzzy match on an ABN is an
 * invitation to open the wrong practice — the ordering these lists already have
 * (worst first) is more useful than similarity to a search term.
 */

import { normalisePhone } from './contacts';

export interface SearchablePractice {
  readonly name?: string | null;
  readonly legalName?: string | null;
  readonly tradingNames?: readonly string[] | null;
  readonly abn?: string | null;
  readonly acn?: string | null;
  readonly adminName?: string | null;
  readonly adminEmail?: string | null;
  readonly adminPhone?: string | null;
  readonly managerName?: string | null;
  readonly managerEmail?: string | null;
  readonly managerPhone?: string | null;
  readonly validationState?: string | null;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Whether a practice matches what somebody typed.
 *
 * A query of two or more DIGITS is treated as an identifier and compared
 * against the ABN, ACN and both phone numbers with all punctuation removed.
 * Anything else is a case-insensitive substring across the names and emails.
 *
 * A query containing both — "Riverbank 0408" — is matched as text AND as
 * digits, and either hitting is a match. Requiring both would refuse the
 * perfectly reasonable case of a half-remembered name beside a partial number.
 */
export function matchesPractice(query: string, practice: SearchablePractice): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  const text = [
    practice.name,
    practice.legalName,
    ...(practice.tradingNames ?? []),
    practice.adminName,
    practice.adminEmail,
    practice.managerName,
    practice.managerEmail,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (text.includes(needle)) return true;

  const needleDigits = digits(needle);
  // One digit matches almost everything, which is not a search result — it is
  // the whole list with extra steps.
  if (needleDigits.length < 2) return false;

  // ABN and ACN: digits alone, so "27 734 610 304" and "27734610304" are one
  // query.
  const identifiers = [practice.abn, practice.acn].filter(Boolean).map((v) => digits(String(v)));
  if (identifiers.some((id) => id.includes(needleDigits))) return true;

  /*
   * Phones go through normalisePhone rather than a bare digit strip, because
   * +61 408 169 971 and 0408 169 971 are ONE number and their digits differ.
   * The same function the contact-independence rule uses, so "these are the
   * same phone" means the same thing in both places.
   */
  const asPhone = normalisePhone(needle);
  if (asPhone.length >= 2) {
    const phones = [practice.adminPhone, practice.managerPhone]
      .filter(Boolean)
      .map((v) => normalisePhone(String(v)));
    if (phones.some((phone) => phone.includes(asPhone))) return true;
  }

  return false;
}

/**
 * The status a row is filtered by.
 *
 * These are the words on the CHIPS, not the database's states, and the mapping
 * is not one-to-one on purpose. "Needs work" spans every approved practice that
 * cannot yet capture consent, which the database records as `validated` plus a
 * readiness calculation — a filter offering `validated` would be filtering by
 * an implementation detail nobody on the screen can see.
 */
export type PracticeFilter = 'all' | 'needs_work' | 'capturing' | 'being_reviewed' | 'not_approved';

export interface FilterableRow {
  readonly validationState?: string | null;
  /** Whether consent capture is possible. Null when it could not be determined. */
  readonly ready?: boolean | null;
}

export function matchesFilter(filter: PracticeFilter, row: FilterableRow): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'being_reviewed':
      return row.validationState === 'pending';
    case 'not_approved':
      return row.validationState === 'rejected';
    case 'capturing':
      return row.validationState === 'validated' && row.ready === true;
    case 'needs_work':
      // Includes readiness we could NOT determine. A row whose state is unknown
      // belongs with the ones needing attention, not with the ones confirmed
      // working — the cost of looking at a healthy practice is a moment, and
      // the cost of overlooking a stalled one is a fortnight.
      return row.validationState === 'validated' && row.ready !== true;
    default:
      return true;
  }
}
