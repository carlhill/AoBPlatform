/**
 * THE DAY AS ONE LIST, IN ARRIVAL ORDER, EACH LINE CARRYING ITS OWN STATE —
 * the small-screen desk's only structural difference from `/practice/frontdesk`
 * (Carl, 12 September 2026: *"If the Practice has small screens, we will need
 * to go to a different design."* SESSION-HANDOVER.md, "A proposal for the
 * small-screen version").
 *
 * WHY THIS IS AN ARRANGEMENT AND NOT A SECOND OPINION. The five rails are five
 * STATES, and they exist because the day has to partition so the desk and the
 * day register reconcile. That is a requirement on the DATA, and `dayRails`
 * already satisfies it. This file does not re-derive a single one of those
 * states: it calls `dayRails`, tags each row it hands back with the group it
 * came out of, and puts the lot back into one order. Any drift between the two
 * screens would therefore have to be a drift inside `dayRails`, where one test
 * already guards it — rather than two screens quietly disagreeing about the
 * same morning, which is the failure this whole reconciliation exists to make
 * impossible.
 *
 * SO THE CHIPS ADD UP BY CONSTRUCTION. `here + onTablet + needsALook +
 * finished` is `rails.arrivedToday`, which IS the register's row count, and
 * `frontdesk_small_chips_add_up_to_the_day_register` asserts it on the
 * rendered page rather than trusting it.
 *
 * ARRIVAL ORDER IS THE ONE ORDERING RULE ON THIS PAGE and nothing here may
 * re-sort past it. See `positions` for how a rail row is put back beside the
 * register row it came from, and what happens to the two kinds of row the
 * register never named.
 *
 * NO WORDS IN HERE. Every line carries a state KEY; the words live in
 * `strings.frontdeskSmall` and `strings.frontdesk.rail`, where the front
 * desk's vocabulary lint can see them.
 *
 * IT NEVER GATES ANYTHING (hard rule 8, REQ-REC-04). This is an arrangement of
 * two reads that `dayRails` has already made. No state it can produce stops
 * anybody being seen or billed.
 */

import type { DayRegisterRow, ExpectedAppointment } from '@aobplatform/contracts';
import type { PushableRow } from '../tablet/pushDesk';
import { dayRails, type DayRailRow } from '../frontdesk/dayRails';

/**
 * THE SIX MARKERS A LINE CAN CARRY, and the first five are the chips.
 *
 * `notArrived` IS NOT A CHIP AND IS STILL A LINE. It is paperwork open with
 * nobody recorded as walking in for it today, it sits outside the register's
 * total on purpose (see `DayRails.notArrived`), and it is empty on a day that
 * is behaving. Dropping the rows would hide people, which is the one thing
 * this desk must never do; giving them a permanent chip would put a count on
 * screen that is not part of the sum the chips are there to prove.
 */
export type DeskState = 'here' | 'onTablet' | 'needsALook' | 'finished' | 'expected' | 'notArrived';

/** The four states that partition the register — the sum the chips must make. */
export const ARRIVED_STATES = ['here', 'onTablet', 'needsALook', 'finished'] as const;

/**
 * ONE LINE OF THE LIST. A name, the practice's own number, a time, a state and
 * — where there is something to act on — the person to open.
 *
 * THE PRACTICE'S PATIENT NUMBER IS ON THE ROW AND THE MEDICARE CARD NUMBER IS
 * NOT ANYWHERE (hard rule 1, REQ-VER-02). The practice's own record number is
 * an approved identifier and is the handle reception reads out; there is no
 * field on this type for the other one and there never will be. No date of
 * birth, no reason code, no amount (hard rule 4) and no identifier VALUE in
 * anything this line is logged into (hard rule 9).
 */
export interface DeskLine {
  readonly key: string;
  /** Who to open, or null where there is nothing behind the row to open. */
  readonly patientId: string | null;
  readonly name: string;
  /** The practice's own number, where the reads carried one. */
  readonly recordNumber: string | null;
  readonly time: string | null;
  readonly state: DeskState;
  /** True where `time` is an arrival timestamp rather than a booking time. */
  readonly timeIsArrival: boolean;
}

/**
 * WHERE EACH ROW SITS IN THE MORNING — the register's own order, which is
 * arrival order, keyed by every id a rail row could be carrying.
 *
 * THREE KEYS PER REGISTER ROW, IN FALLING ORDER OF EXACTNESS. The arrival id,
 * because a finished visit and an unaccounted-for one are keyed on it; the
 * agreement id, because a row the queue matched is keyed on that and it is the
 * exact match `dayRails` made; and finally the patient, because
 * `offerEpisodicInstead` creates an agreement that does not supersede the one
 * it replaces, so that person's arrival and their queue row share no agreement
 * id at all.
 *
 * FIRST WRITER WINS ON THE LATER TWO. Somebody who came in twice this morning
 * has two register rows, and their earliest one is the one their open work was
 * attached to (`dayRails` pass two), so it is the one their line should sit
 * beside.
 */
function positions(day: readonly DayRegisterRow[]): Map<string, number> {
  const at = new Map<string, number>();
  day.forEach((row, index) => at.set(row.arrivalId, index));
  day.forEach((row, index) => {
    if (row.agreementId && !at.has(row.agreementId)) at.set(row.agreementId, index);
  });
  day.forEach((row, index) => {
    if (row.patientId && !at.has(row.patientId)) at.set(row.patientId, index);
  });
  return at;
}

/**
 * THE PRACTICE'S OWN NUMBER FOR A PERSON, from whichever read carried it.
 * The queue row has it and so does the register row; a line built from one
 * read should not lose it because the other read is the one that was matched.
 */
function recordNumbers(
  queue: readonly PushableRow[],
  day: readonly DayRegisterRow[] | null,
): Map<string, string> {
  const byPatient = new Map<string, string>();
  for (const row of day ?? []) {
    if (row.patientId && row.patientRecordNumber) byPatient.set(row.patientId, row.patientRecordNumber);
  }
  for (const row of queue) {
    if (row.patientId && row.patientRecordNumber) byPatient.set(row.patientId, row.patientRecordNumber);
  }
  return byPatient;
}

/**
 * EVERYBODY HERE TODAY, IN ONE LIST.
 *
 * ORDER, AND IT IS THE WHOLE OF THE PAGE'S ORDERING POLICY:
 *
 *  1. Everybody the register named, in the order they walked in — whatever
 *     state they are in. A receptionist thinks about who is next, not about
 *     which of five boxes somebody is in, so the states interleave.
 *  2. Then the rows the register never named: paperwork open with no arrival
 *     recorded today (`notArrived`), each keeping the order the queue gave it.
 *  3. Then the people booked in who have not walked in (`expected`), in the
 *     order the booking read gave them.
 *
 * NOTHING RE-SORTS INSIDE A TIE. Two rows that resolve to the same register
 * position keep the order `dayRails` produced them in, which is the order the
 * server gave — this page does not second-guess it.
 *
 * `day` IS NULL WHEN THE REGISTER HAS NEVER BEEN READ, and the answer is then
 * exactly what `dayRails` degrades to: the queue split into here and on a
 * tablet, no total, no finished and no anomalies. Hard rule 8 — a read that
 * failed slows the evidence, never the service.
 */
export function deskLines({
  queue,
  day,
  expected,
}: {
  readonly queue: readonly PushableRow[];
  readonly day: readonly DayRegisterRow[] | null;
  readonly expected: readonly ExpectedAppointment[];
}): { readonly lines: readonly DeskLine[]; readonly arrivedToday: number | null } {
  const rails = dayRails({ queue, day });
  const at = positions(day ?? []);
  const numbers = recordNumbers(queue, day);

  /**
   * A RAIL ROW AS A LINE. `timeIsArrival` travels with it because the two
   * groups `dayRails` builds from the register carry the moment somebody
   * walked in, while the two it builds from the queue carry a booking time —
   * and a screen that formatted both the same way would print an ISO
   * timestamp beside a clock face.
   */
  const asLine = (row: DayRailRow, state: DeskState, timeIsArrival: boolean): DeskLine => ({
    key: row.key,
    patientId: row.patientId,
    name: row.name,
    recordNumber: row.patientId ? (numbers.get(row.patientId) ?? null) : null,
    time: row.time,
    state,
    timeIsArrival,
  });

  const arrived: DeskLine[] = [
    ...rails.here.map((row) => asLine(row, 'here', false)),
    ...rails.onTablet.map((row) => asLine(row, 'onTablet', false)),
    ...rails.needsALook.map((row) => asLine(row, 'needsALook', true)),
    ...rails.finished.map((row) => asLine(row, 'finished', true)),
  ];

  /*
   * ARRIVAL ORDER, WITH A STABLE TIE-BREAK. `sort` is stable in every engine
   * this ships to, but the index is carried explicitly rather than relied on:
   * a row the register never named resolves to the same sentinel as every
   * other one, and their relative order is the only thing keeping them from
   * shuffling between polls.
   */
  const ordered = arrived
    .map((line, index) => ({
      line,
      index,
      at: at.get(line.key) ?? (line.patientId ? at.get(line.patientId) : undefined) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.line);

  return {
    lines: [
      ...ordered,
      ...rails.notArrived.map((row) => asLine(row, 'notArrived', false)),
      ...expected.map((appointment) => ({
        key: appointment.appointmentId,
        patientId: appointment.patientId,
        name: appointment.patientName,
        recordNumber: numbers.get(appointment.patientId) ?? null,
        time: appointment.time,
        state: 'expected' as const,
        timeIsArrival: false,
      })),
    ],
    arrivedToday: rails.arrivedToday,
  };
}

/**
 * HOW MANY LINES ARE IN EACH STATE — the chips, and the whole reconciliation
 * on one line.
 *
 * COUNTED OFF THE LINES THEMSELVES rather than off the rails they came from,
 * so a chip cannot say five while the list under it shows four. That is the
 * drift the rendered test is actually guarding against: a screen filtering
 * people out of a list is something a component can do all by itself, with a
 * filter no helper ever sees.
 */
export function deskCounts(lines: readonly DeskLine[]): Record<DeskState, number> {
  const counts: Record<DeskState, number> = {
    here: 0,
    onTablet: 0,
    needsALook: 0,
    finished: 0,
    expected: 0,
    notArrived: 0,
  };
  for (const line of lines) counts[line.state] += 1;
  return counts;
}
