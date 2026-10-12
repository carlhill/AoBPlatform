'use client';

import { PracticeGate } from '../PracticeGate';
import { DayView } from './DayView';

/**
 * `/practice/day` — THE PRACTICE'S DAY REGISTER (Carl, 12 September 2026, on
 * `/practice/frontdesk`: *"Add a button here with a link to show all Patients
 * seen at this practice today. You could put a filter on this to search for any
 * day. Default to today."*).
 *
 * WRAPPED IN `PracticeGate`, like every other page reached from the front desk.
 * A practice user IS a practice claim (ROLES.md §2), so "which practice" is
 * answered before the page renders. There is no practitioner audience here and
 * therefore no `?practice=` to resolve: this is the desk's own record.
 *
 * `practice` IN THE PAGE-ACCESS MAP, the same audience as `/practice/frontdesk`
 * and for the identical reason — it is reception's ordinary work, behind the
 * same RLS, and it shows strictly less about each person than the front desk
 * panel already does. An administrator-only page here would mean either that
 * reception cannot look up who came in yesterday, or that every receptionist is
 * an administrator.
 */
export default function DayRegisterPage() {
  return <PracticeGate>{(practiceId) => <DayView practiceId={practiceId} />}</PracticeGate>;
}
