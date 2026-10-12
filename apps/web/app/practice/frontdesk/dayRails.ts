/**
 * THE DAY, SPLIT INTO RAILS THAT ADD UP — the reconciliation between
 * `/practice/frontdesk` and `/practice/day` (Carl, 12 September 2026, looking
 * at the two side by side: *"Both pages have to reconcile. Have another list
 * if you have to on frontdesk as every patient has to be seen."*).
 *
 * THE PROBLEM THIS FIXES. The waiting page said fifteen and the desk said
 * three. Both were right and neither said so, which makes the desk look
 * broken. Twelve of the fifteen were invisible: eight had signed and finished,
 * four had been replaced by a corrected agreement and were represented only by
 * their successors, and TWO had arrived, had not signed, had nothing open for
 * them and appeared on no list at all. That last pair is the state this file
 * exists for. A patient who owes a signature and is on no screen is the worst
 * thing this desk can hold.
 *
 * THE RULE, AND IT IS STRUCTURAL RATHER THAN A HABIT. **Every row of the day
 * register lands in exactly one rail.** The four arrived rails are built by
 * walking the register once and putting each row somewhere; there is no branch
 * that drops one and no branch that emits two. `arrivedToday` is therefore the
 * register's own row count by construction, and
 * `front_desk_rails_add_up_to_the_day_register` asserts it rather than
 * trusting it.
 *
 * WHY THE REGISTER IS THE DENOMINATOR AND NOT THE QUEUE. The queue
 * (`GET /tablet-sessions/pushable`) is a list of WORK, so it drops a person
 * the moment their paperwork is done, is replaced or runs out of road — which
 * is exactly how twelve people went missing. The register
 * (`GET /arrivals/day`) is a list of PEOPLE WHO CAME IN, and it is the only
 * read at this practice that keeps everybody. Reconciling against anything
 * else would reconcile two lists that were already agreeing.
 *
 * THE MATCH IS ON THE AGREEMENT, AND THAT IS WHY SUPERSESSION DISAPPEARS. A
 * register row carries the NEWEST agreement in its chain — the server already
 * walked it forward (`newestAgreementInChain`) — and the queue carries the
 * newest too, because `readPushableRows` excludes anything that has been
 * replaced. So a corrected patient's arrival and their successor agreement
 * meet on one id, and the four "superseded" rows that used to be represented
 * only by somebody else's queue entry now sit under their own name.
 *
 * AND THEN ONE FALLBACK, ON THE PERSON. `offerEpisodicInstead` creates a NEW
 * agreement that does not supersede the enduring draft it replaces — it could
 * not, they are different instruments with different evidence — so that
 * patient's register row and their queue row share no agreement id. Matching
 * what is left over by patient, in arrival order, one queue row to one
 * arrival, puts them back together. Without it the same visit would be counted
 * twice: once as an anomaly and once as work.
 *
 * NOTHING HERE IS A SECOND OPINION (FRONT-DESK-PAGE.md §7). Whether a patient
 * has signed is the register's `agreementSigned`, which is the presence of a
 * signature EVENT; whether there is work is the presence of a queue row, which
 * is the server's own definition of pushable. This file decides neither. It
 * only decides which of five headings a row is printed under.
 *
 * NO WORDS IN HERE. Every rail is a key; the headings live in
 * `strings.frontdesk.rail`, where the front desk's vocabulary lint can see
 * them (FRONT-DESK-PAGE.md §5).
 *
 * IT NEVER GATES ANYTHING (hard rule 8, REQ-REC-04). This is an arrangement of
 * two reads. No rail it can produce stops anybody being seen or billed, and a
 * register that fails to load degrades to the queue-only rails the page had
 * before rather than emptying the desk.
 */

import type { DayRegisterRow } from '@aobplatform/contracts';
import { isTheServiceRenderedSignal } from '@aobplatform/domain';
import type { PushableRow } from '../tablet/pushDesk';
import { everyServiceResolved, type ChecklistState } from './visitChecklist';

/**
 * ONE LINE ON THE RAIL. A name, a time and which group — and nothing else
 * (FRONT-DESK-PAGE.md §12.3). No reason, no condition, no provider's opinion,
 * no identifier of any kind (hard rules 1 and 9) and no amount (hard rule 4).
 */
export interface DayRailRow {
  /**
   * THE ROW'S OWN ID, and it is the AGREEMENT wherever there is work, so a row
   * keeps one id whether it is reached through the register or, when the
   * register cannot be read, through the queue alone. An arrival with no work
   * left is identified by the arrival, which is the only id it has.
   */
  readonly key: string;
  /**
   * THE PERSON, WHERE CHOOSING THEM WOULD MEAN SOMETHING. Null on a row with
   * nothing to act on — a finished visit, or an arrival with no work open —
   * and the rail renders those as text rather than as a control, because a
   * button that fills the panel with nothing is a dead end a first-day starter
   * cannot get out of.
   */
  readonly patientId: string | null;
  readonly name: string;
  /** Arrival time or booking time as the server gave it; formatted by the rail. */
  readonly time: string | null;
  /**
   * THE NUMBER ON THE CARD IN THEIR HAND (`QUEUE-TICKETS.md`; Carl, 12
   * September 2026: *"Show the practice-queueid - the card with the number or
   * from the PMS or the Q-id AoB allocated."*).
   *
   * NULL AT EVERY PRACTICE THAT DOES NOT HAND OUT CARDS, and null on a row the
   * register alone knows about — the ticket lives on the arrival and reaches
   * this page through the queue row, which a finished visit no longer has.
   *
   * IT IS THE PATIENT'S HANDLE AND NOT THE RUNNING ORDER (§5a). Number 14
   * called before number 9 is an ordinary morning; nothing here sorts on it.
   */
  readonly queueTicket: string | null;
  /**
   * WHICH TABLET THEY HAVE, where they have one. An id, resolved to the name
   * the practice gave the device by whoever draws the row — a page that
   * carried the label instead would have to be handed the device list to build
   * a rail.
   */
  readonly deviceId: string | null;
}

/** The groups a day's rows can be printed under. The first five are the day. */
export interface DayRails {
  /** Arrived, something to do, no tablet out. */
  readonly here: readonly DayRailRow[];
  /** Arrived, reading or signing on a tablet right now. */
  readonly onTablet: readonly DayRailRow[];
  /**
   * ARRIVED, PAPERWORK DONE, AND THE PRACTITIONER HAS NOT SEEN THEM YET
   * (D-2026-09-12-20; Carl, 12 September 2026: *"on /frontdesk the patient
   * goes to 'Finished list' yet on /waiting the dr has not seen the patient as
   * yet."*).
   *
   * THIS RAIL EXISTS BECAUSE "FINISHED" WAS LYING. Signing happens in the
   * waiting room, BEFORE the service, so everybody here used to be reported as
   * finished. They are not an anomaly — nothing is wrong and nobody at the
   * desk has anything to do — so "Needs a look" would be a false alarm; and
   * they are not the desk's work either, so "Here now" would be wrong too.
   * They are waiting for the practitioner, which is a fact with its own name.
   */
  readonly waitingToBeSeen: readonly DayRailRow[];
  /**
   * ARRIVED, AND THERE IS GENUINELY NOTHING LEFT: the paperwork is done —
   * signed, or nothing to sign — AND the visit is complete. Either one alone
   * leaves the patient on the desk (D-2026-09-12-20).
   */
  readonly finished: readonly DayRailRow[];
  /**
   * THE ANOMALY RAIL. Arrived, has not signed, and nothing is open for them.
   * It exists because this is the state that was invisible, and an invisible
   * one is the only kind nobody fixes.
   */
  readonly needsALook: readonly DayRailRow[];
  /**
   * WORK AT THE DESK WITH NO ARRIVAL RECORDED FOR THIS DAY — a correction made
   * after midnight on yesterday's visit, or a draft sitting on a booking whose
   * patient has not walked in. Outside the arrived total on purpose: they are
   * not part of the day the register is counting, and folding them in would
   * make the sum a coincidence instead of a proof.
   */
  readonly notArrived: readonly DayRailRow[];
  /**
   * `here + onTablet + needsALook + waitingToBeSeen + finished`, which IS the
   * register's row count. Null when the register could not be read, because a
   * total nobody can stand behind is worse than no total.
   */
  readonly arrivedToday: number | null;
}

/** A queue row as a rail line. The agreement is the id; the patient is the choice. */
function fromQueue(row: PushableRow): DayRailRow {
  return {
    key: row.agreementId,
    patientId: row.patientId,
    name: row.patientName,
    time: row.appointmentTime,
    queueTicket: row.queueTicket ?? null,
    deviceId: row.activeSession?.deviceId ?? null,
  };
}

/**
 * THE DAY'S ROWS, IN GROUPS THAT ACCOUNT FOR ALL OF THEM.
 *
 * `day` IS NULL WHEN THE REGISTER COULD NOT BE READ, and the answer then is
 * exactly the page's older behaviour — the queue split into here and on a
 * tablet, no arrived rails and no total. Hard rule 8: a read that failed slows
 * the evidence and never the service, so the desk keeps working on what it
 * does have rather than showing an empty morning.
 *
 * ORDER IS THE CALLER'S, TWICE OVER. The register arrives in arrival order and
 * the queue in arrival order through the supersession chain; both are held
 * steady between polls by `stableByFirstSeen` before they get here. Nothing in
 * this function sorts, so the person who has waited longest is still at the
 * top of "here now" and the page is not second-guessing the server (§4).
 */
export function dayRails({
  queue,
  day,
}: {
  readonly queue: readonly PushableRow[];
  readonly day: readonly DayRegisterRow[] | null;
}): DayRails {
  if (day === null) {
    return {
      here: queue.filter((row) => row.activeSession === null).map(fromQueue),
      onTablet: queue.filter((row) => row.activeSession !== null).map(fromQueue),
      needsALook: [],
      waitingToBeSeen: [],
      finished: [],
      notArrived: [],
      arrivedToday: null,
    };
  }

  const byAgreement = new Map(queue.map((row) => [row.agreementId, row]));
  /** Which queue rows have been spoken for, so none is printed twice. */
  const claimed = new Set<string>();

  /*
   * PASS ONE: THE AGREEMENT. Exact, and it is the match that makes a corrected
   * patient appear under their own arrival rather than only as their
   * successor.
   */
  const matched = new Map<string, PushableRow>();
  for (const row of day) {
    if (!row.agreementId) continue;
    const found = byAgreement.get(row.agreementId);
    if (!found || claimed.has(found.agreementId)) continue;
    matched.set(row.arrivalId, found);
    claimed.add(found.agreementId);
  }

  /*
   * PASS TWO: THE PERSON, FOR WHAT IS LEFT. One queue row to one arrival, in
   * arrival order, so a patient who came in twice today has their open work
   * attached to their earliest unfinished visit rather than to both. See the
   * file docstring for why this pass has to exist at all.
   */
  const spare = queue.filter((row) => !claimed.has(row.agreementId));
  for (const row of day) {
    if (matched.has(row.arrivalId)) continue;
    /*
     * ONLY AN ARRIVAL THAT IS ACTUALLY WAITING ON A SIGNATURE MAY CLAIM ONE.
     * A visit that needed no agreement at all (`agreementId === null` — a
     * blood test) and one that is already signed are both FINISHED, and
     * letting either take a spare row would hand somebody else's paperwork to
     * the wrong visit: the same patient's second visit, the one that really is
     * open, would then be reported as an anomaly. Caught in review, 12 Sep
     * 2026, before it could happen to anybody.
     */
    if (!row.patientId || !row.agreementId || row.agreementSigned) continue;
    const found = spare.find((candidate) => candidate.patientId === row.patientId
      && !claimed.has(candidate.agreementId));
    if (!found) continue;
    matched.set(row.arrivalId, found);
    claimed.add(found.agreementId);
  }

  const here: DayRailRow[] = [];
  const onTablet: DayRailRow[] = [];
  const needsALook: DayRailRow[] = [];
  const waitingToBeSeen: DayRailRow[] = [];
  const finished: DayRailRow[] = [];

  /*
   * ONE WALK, ONE PLACE EACH. Every branch of this loop pushes exactly once,
   * and there is no `continue` that would let a row fall out — which is what
   * makes `arrivedToday` the register's count rather than a number that
   * happens to agree with it today.
   */
  for (const row of day) {
    const work = matched.get(row.arrivalId);
    if (work) {
      (work.activeSession === null ? here : onTablet).push(fromQueue(work));
      continue;
    }
    const line: DayRailRow = {
      key: row.arrivalId,
      // Nothing to act on, so nothing to choose. See `DayRailRow.patientId`.
      patientId: null,
      name: row.patientName ?? '',
      /*
       * NO CARD NUMBER AND NO TABLET ON A ROW THE QUEUE HAS FINISHED WITH.
       * Both facts arrive with the queue row, and the honest answer for a
       * visit that no longer has one is nothing rather than a stale number.
       */
      queueTicket: null,
      deviceId: null,
      /*
       * WHEN THEY WALKED IN, which is the honest time for somebody the queue
       * has finished with — a booking time would say when they were due, and
       * this rail is a record of what happened.
       */
      time: row.arrivedAt,
    };
    /*
     * THIS PATIENT'S SERVICE LIST, AS THE REGISTER CAN SEE IT
     * (`VISIT-CHECKLIST.md` §3a; Carl, 12 September 2026: *"Only when all
     * services are completed or some are cancelled does the client go to
     * Finished."*).
     *
     * WRITTEN AS A LIST AND NOT AS A BOOLEAN, deliberately. Today it holds two
     * items — the signature and the visit — so `everyServiceResolved` reduces
     * to the narrower rule D-2026-09-12-20 first recorded. When a practice's
     * own items arrive (a nurse, bloods; versioned content, not built),
     * Finished must change meaning without this condition being edited, and a
     * two-clause boolean is exactly the shape somebody would have to edit.
     *
     * THE SIGNATURE. Done when it is signed, and NOT NEEDED when there was
     * never anything to sign — a patient who came in for a blood test signs
     * nothing and never will, and reporting them as outstanding would be a
     * permanent false alarm. A rail people learn to ignore is the same as no
     * rail. (The same reasoning `signedLabel` applies on `/practice/day`; if a
     * third place has to ask this, extract it.)
     *
     * THE VISIT. `isTheServiceRenderedSignal` is the domain's own predicate for
     * "the service happened", read rather than compared against the literal
     * `completed`, so a change to the versioned list moves both screens at once
     * (hard rule 14). NOT NEEDED where no visit state exists at all.
     *
     * AND WHERE AN UNRESOLVED PATIENT GOES IS A SEPARATE QUESTION from whether
     * they are finished. An outstanding SIGNATURE with nothing open for it is
     * the anomaly this desk exists to surface; anything else outstanding is an
     * ordinary morning in progress, and the patient is waiting for somebody who
     * is not reception.
     */
    const signature: ChecklistState = !row.agreementId
      ? 'not_needed'
      : row.agreementSigned
        ? 'done'
        : 'outstanding';
    const visit: ChecklistState = row.visitState === null
      ? 'not_needed'
      : isTheServiceRenderedSignal(row.visitState)
        ? 'done'
        : 'outstanding';
    const services = [{ state: signature }, { state: visit }];

    if (everyServiceResolved(services)) finished.push(line);
    else if (signature === 'outstanding') needsALook.push(line);
    else waitingToBeSeen.push(line);
  }

  return {
    here,
    onTablet,
    needsALook,
    waitingToBeSeen,
    finished,
    notArrived: queue.filter((row) => !claimed.has(row.agreementId)).map(fromQueue),
    arrivedToday:
      here.length + onTablet.length + needsALook.length + waitingToBeSeen.length + finished.length,
  };
}
