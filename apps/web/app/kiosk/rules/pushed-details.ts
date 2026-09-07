/**
 * WHAT K-P1 SHOWS, AND IN WHAT ORDER — derived from the domain's own list.
 *
 * THE ORDER AND THE MEMBERSHIP ARE `CONFIRMABLE_DETAIL_TYPES`, imported rather
 * than retyped. The server's DTO validates against the same constant and the
 * database CHECK constraint refuses anything outside it, so a screen that
 * carried its own list could drift into asking for a tick the server would
 * reject — or, far worse, into asking for one more thing than the five.
 *
 * A ROW WITH NO VALUE IS NOT DRAWN, and it is not drawn as an empty row
 * either: a practice that holds no email address for somebody must not show
 * them a blank line and ask whether it is correct. `requiredTypes` is
 * therefore exactly the rows on screen, which is what "all required ticks (the
 * ones present)" means in practice.
 *
 * TWO OF THE FIVE ARE CONTACT DETAILS. `mobile` and `email` are shown, ticked
 * and recorded as CONFIRMED — and are never identity identifiers, never
 * counted toward the statutory three, and never logged as an identifier type
 * (REQ-VER-02, hard rule 1; the domain's own comment on the constant says the
 * same thing).
 *
 * NO MEDICARE NUMBER, BECAUSE THERE IS NO FIELD FOR ONE. Not in the payload,
 * not in the list, not in the string table. Nothing here could render one even
 * if a server sent it.
 */

import {
  CONFIRMABLE_DETAIL_TYPES,
  type ConfirmableDetailType,
  type TabletSessionPatient,
} from '@aobplatform/domain';
import { strings } from '../strings';

export interface DetailRow {
  readonly type: ConfirmableDetailType;
  readonly label: string;
  readonly value: string;
}

/**
 * d MMMM yyyy — "4 September 1962".
 *
 * MONTHS BY NAME, for the reason K-2's pickers already give: a patient reading
 * "09" has to translate it, and nobody should have to. The month names come
 * from the string table so a translation moves them, and the leading zero is
 * stripped because "04 September" is a form field, not a sentence.
 *
 * AN UNPARSEABLE VALUE IS SHOWN AS IT CAME. The server sends ISO `yyyy-mm-dd`;
 * if it ever sends something else, printing it beats hiding a row the patient
 * is being asked to confirm.
 */
export function formatDateOfBirth(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  const [, year, month, day] = match;
  const monthName = strings.verify.monthNames[Number(month) - 1];
  if (!monthName) return iso;
  return strings.checkDetails.dateFormat(String(Number(day)), monthName, year);
}

/** The one composed value on this screen. Given names first, as the patient says it. */
function fullName(patient: TabletSessionPatient): string {
  return [patient.givenNames, patient.familyName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

function rawValueFor(type: ConfirmableDetailType, patient: TabletSessionPatient): string {
  switch (type) {
    case 'name':
      return fullName(patient);
    case 'date_of_birth':
      return patient.dateOfBirth ? formatDateOfBirth(patient.dateOfBirth) : '';
    case 'address':
      return patient.address ?? '';
    case 'mobile':
      return patient.mobile ?? '';
    case 'email':
      return patient.email ?? '';
    default:
      return '';
  }
}

/** The rows to draw, in the domain's order, with the empty ones dropped. */
export function detailRowsFor(patient: TabletSessionPatient): readonly DetailRow[] {
  const rows: DetailRow[] = [];
  for (const type of CONFIRMABLE_DETAIL_TYPES) {
    const value = rawValueFor(type, patient).trim();
    if (value.length === 0) continue;
    rows.push({ type, label: strings.checkDetails.detailNames[type] ?? type, value });
  }
  return rows;
}

/**
 * A TICK OR A CROSS, AND THERE IS NO THIRD ANSWER (Carl, 4 Sep 2026).
 *
 * WHY A PAIR OF BUTTONS AND NOT A TOGGLE. The screen this replaces had one
 * control per row that a patient tapped if the detail was right. An untouched
 * row therefore meant two different things — "wrong" and "not looked at yet" —
 * and only the patient could tell them apart. Reception, watching from the
 * desk, could not. Making the answer explicit is what lets a cross be sent
 * anywhere at all.
 *
 * `undefined` STILL EXISTS AND IS STILL MEANINGFUL: it is "not answered yet",
 * and it is what keeps Continue dead until every row has been read. It is now
 * distinguishable from "wrong", which is the whole point.
 */
export type DetailAnswer = 'right' | 'wrong';

export type DetailAnswers = Readonly<Record<string, DetailAnswer>>;

/** Every row on screen has an answer. Rows that are not shown are not asked about. */
export function allAnswered(rows: readonly DetailRow[], answers: DetailAnswers): boolean {
  return rows.length > 0 && rows.every((row) => answers[row.type] !== undefined);
}

/** At least one cross — which disables Continue and summons reception. */
export function anyDisputed(rows: readonly DetailRow[], answers: DetailAnswers): boolean {
  return rows.some((row) => answers[row.type] === 'wrong');
}

/**
 * WHAT GOES ON THE WIRE — the ANSWERED TYPES, in the domain's order, split
 * into the ticked and the crossed, and nothing else (REQ-VER-04, hard rule 9).
 *
 * The return types are `ConfirmableDetailType[]`, so a value cannot be
 * smuggled into the request body by a later edit: `'address'` type-checks and
 * "2 Example Street" does not. A CROSS carries no correction either — the
 * patient was never asked what the right value is, the screen has no field to
 * take one, and the person who answers that question is a staff member at the
 * desk whose identity is recorded when they do. The named test
 * `details_confirmation_sends_types_not_values` asserts the same thing about
 * the request that actually leaves the device.
 */
export function answeredTypes(
  rows: readonly DetailRow[],
  answers: DetailAnswers,
): { confirmed: ConfirmableDetailType[]; disputed: ConfirmableDetailType[] } {
  const confirmed: ConfirmableDetailType[] = [];
  const disputed: ConfirmableDetailType[] = [];
  for (const row of rows) {
    if (answers[row.type] === 'right') confirmed.push(row.type);
    else if (answers[row.type] === 'wrong') disputed.push(row.type);
  }
  return { confirmed, disputed };
}

/**
 * ONE STRING FOR ONE SET OF ANSWERS, so the screen can tell whether what it is
 * about to send is what it already sent.
 *
 * A CROSS IS POSTED THE MOMENT EVERY ROW HAS AN ANSWER, without the patient
 * pressing anything, so that reception learns about it without the patient
 * having to explain it across a waiting room. That means the same answers can
 * be reached twice — flip a cross to a tick and back, or come back from K-3
 * with Back — and re-sending them would write a second identical event into
 * the vault for nothing. Comparing this is cheaper and more honest than
 * remembering how many times a button was pressed.
 */
export function answerSignature(rows: readonly DetailRow[], answers: DetailAnswers): string {
  const { confirmed, disputed } = answeredTypes(rows, answers);
  return `${confirmed.join(',')}|${disputed.join(',')}`;
}
