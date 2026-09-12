/**
 * WHAT THIS PATIENT IS HERE FOR TODAY, AND WHAT IS STILL OUTSTANDING —
 * `VISIT-CHECKLIST.md` §9 phase 1, computed and never marked by hand.
 *
 * THE FOUR PAPERWORK ROWS AND NOTHING ELSE (§1). The visit's other steps —
 * seeing the provider, a blood test, seeing the nurse, paying — are the
 * PRACTICE'S, not ours: clinical features and payment processing are out of
 * scope (CLAUDE.md §8) and marking them is `VISIT-CHECKLIST.md` §9 phase 3,
 * being built on the practitioner side. This file computes only the four the
 * platform already owns, from data the desk already reads.
 *
 * NOTHING HERE IS A SECOND OPINION. Every state is derived from the queue row
 * the server hands back (`GET /tablet-sessions/pushable`) and today's covered
 * lines (`GET /tablet-sessions/covered`) — the same two reads the tablet desk
 * makes. There is no new endpoint, no second definition of "pushable" and no
 * re-derivation of the versioned visit policy's answer: where the policy
 * decided, the row or the covered line carries the decision and this reads it
 * (FRONT-DESK-PAGE.md §7).
 *
 * IT NEVER GATES ANYTHING (hard rule 8, REQ-REC-04). This is a report. No
 * state it can produce stops a patient being seen or billed, and nothing on
 * the screen it feeds is phrased as a permission.
 *
 * NO WORDS IN HERE. Every row returns a KEY; the sentences live in
 * `strings.frontdesk.checklist` where the front desk's vocabulary lint can see
 * them (FRONT-DESK-PAGE.md §5).
 */

import type { CoveredServiceRow, PushableRow } from '../tablet/pushDesk';
import { isTheServiceRenderedSignal, type TabletSessionRow } from '@aobplatform/domain';

/**
 * WHERE ONE SERVICE ON THIS PATIENT'S LIST HAS GOT TO
 * (`VISIT-CHECKLIST.md` §3a; Carl, 12 September 2026: *"What you call
 * 'Paper work' per patient, I call the patient service list. We need a patient
 * service list, just like a car has service list when taken to the service
 * centre."*).
 *
 * `cancelled` IS NOT `not_needed`, AND THE DIFFERENCE IS THE POINT. *Not
 * needed* was never required — the versioned visit policy said no agreement was
 * owed. *Cancelled* was on the list and was dropped: the patient declined the
 * blood test, or ran out of time. A car service list tells them apart and so
 * does this, because "we never planned to" and "we planned to and did not" are
 * different answers to an auditor and to the patient.
 *
 * NOTHING PRODUCES `cancelled` YET. The four computed rows cannot be dropped —
 * they are derived, not chosen — so it arrives with the practice's own items
 * (a nurse, bloods), which are versioned content and not built. It is in the
 * type now so that `everyServiceResolved` is written against the whole set
 * from the start, rather than being widened later by somebody who has to work
 * out what "resolved" was supposed to mean.
 */
export type ChecklistState = 'done' | 'outstanding' | 'not_needed' | 'cancelled';

/**
 * WHICH STATES MEAN AN ITEM NEEDS NOTHING MORE. Done, never needed, or
 * deliberately dropped — three different facts and one consequence.
 */
export const RESOLVED_SERVICE_STATES: readonly ChecklistState[] = ['done', 'not_needed', 'cancelled'];

/**
 * IS EVERY SERVICE ON THIS PATIENT'S LIST RESOLVED?
 *
 * CARL'S RULE, AS THE GENERAL ONE (`VISIT-CHECKLIST.md` §3a): *"Only when all
 * services are completed or some are cancelled does the client go to
 * Finished."*
 *
 * WRITTEN OVER THE LIST RATHER THAN AS A BOOLEAN OF TWO CLAUSES, deliberately.
 * Today the list is the computed paperwork rows plus the visit itself, so this
 * reduces to "the paperwork is done and the patient has been seen" — the
 * narrower rule D-2026-09-12-20 first recorded. When a practice's own items
 * arrive, Finished has to change meaning WITHOUT anyone editing this function,
 * and a two-clause boolean is exactly the shape that would have to be edited.
 *
 * AN EMPTY LIST IS RESOLVED. There is nothing outstanding, which is the honest
 * answer and the one every caller wants.
 */
export function everyServiceResolved(items: readonly { readonly state: ChecklistState }[]): boolean {
  return items.every((item) => RESOLVED_SERVICE_STATES.includes(item.state));
}

/**
 * THE ROWS OF `VISIT-CHECKLIST.md` §2 THAT ARE OURS — four of paperwork, and
 * since D-2026-09-12-20 the visit itself between them.
 *
 * `consultation` SITS AFTER `signed` AND BEFORE `after`, which is where Carl
 * drew it (12 September 2026, with the two pages side by side: *"on /frontdesk
 * the patient goes to 'Finished list' yet on /waiting the dr has not seen the
 * patient as yet. Hence, we need a step 'Consultation completed'."*). The order
 * is the morning's: sign in the waiting room, then be seen, then anything the
 * visit turned out to need afterwards.
 */
export type ChecklistKey = 'needed' | 'made' | 'signed' | 'consultation' | 'after';

/**
 * WHICH SENTENCE THE ROW SAYS. A key, resolved against the string table by the
 * screen — so the reason travels with the state instead of being worked out a
 * second time next to the words.
 */
export type ChecklistDetail =
  | 'todaysVisit'
  | 'ongoing'
  | 'afterService'
  | 'nothingToSign'
  | 'ready'
  | 'beingPrepared'
  | 'nothingToMake'
  | 'notSignedYet'
  | 'withThemNow'
  | 'signedAndStored'
  | 'nothingBilledYet'
  | 'afterOutstanding'
  /*
   * THE VISIT'S OWN STATE, RENDERED FROM THE VERSIONED LIST rather than from a
   * sentence per state written here. The keys are content (`visit-states.json`)
   * and their words are in the string table keyed by the key, so a fifth state
   * reaches this row without a code change — and an unmapped one shows its own
   * key rather than a blank (CLAUDE.md §7).
   */
  | 'visitState';

export interface ChecklistRow {
  readonly key: ChecklistKey;
  readonly state: ChecklistState;
  readonly detail: ChecklistDetail;
  /** Named on the row that says which agreement this is — hard rule 6 made visible. */
  readonly provider?: string | null;
  /** "The blue one" is how the desk talks (FRONT-DESK-PAGE.md §12.2). */
  readonly device?: string | null;
  /**
   * THE VERSIONED POLICY'S OWN RULE KEY, where a policy decided this row
   * (hard rule 14). Shown as itself when this screen has no wording for it, so
   * a newer server's newer reason reaches reception as something they can
   * quote rather than as a sentence that hides it (CLAUDE.md §7).
   */
  readonly ruleKey?: string | null;
  /**
   * WHICH VISIT STATE THIS ROW IS REPORTING — a KEY from `visit-states.json`,
   * never a word (hard rule 14, REQ-LANG-01). Only on the `consultation` row.
   */
  readonly visitState?: string | null;
}

/**
 * WHICH REFUSALS THE NUMBERED SEND CARD CAN ITSELF CLEAR.
 *
 * Both mean the same thing in different words — nobody has said who is signing
 * — and step ① of the card is exactly the control that answers it. Every other
 * refusal needs something the card cannot do, so the card is not drawn for
 * them: a strip of three steps over a row that can never go teaches a beginner
 * that the page is broken (CLAUDE.md §6, "blocked states unreachable in the
 * UI"), and the reason and its own fix are shown instead.
 */
export const SEND_CARD_CLEARS: readonly string[] = ['assignor_not_confirmed', 'who_is_signing_unset'];

/** Everything the panel can be looking at, as one word. */
export type Situation =
  | 'who_is_signing'
  | 'ready_to_send'
  | 'waiting'
  | 'on_a_tablet'
  | 'detail_wrong';

/**
 * THE ONE SITUATION THIS PERSON IS IN, so the panel can show ONE next thing
 * (FRONT-DESK-PAGE.md §4). Exactly one is returned; there is no ordering to
 * argue about at the call site and no screen deciding for itself.
 */
export function situationFor(
  row: Pick<PushableRow, 'pushable' | 'blockedReason' | 'assignorConfirmedAt' | 'activeSession'>,
  live: Pick<TabletSessionRow, 'disputedDetails' | 'disputeResolution'> | null | undefined,
): Situation {
  /*
   * THE ROW DECIDES WHETHER IT IS ON A TABLET, NOT THE SESSION LIST. The
   * server builds `activeSession` from the sessions it has not ended, so the
   * row is the authoritative answer and it arrives in the same payload. The
   * session list is a SECOND read that can land a tick later or fail on its
   * own — and a panel that offered "send it to a tablet" for the beat before
   * it landed would be offering to send an agreement that is already in
   * somebody's hands.
   */
  if (row.activeSession) {
    return live && live.disputedDetails.length > 0 && !live.disputeResolution
      ? 'detail_wrong'
      : 'on_a_tablet';
  }
  const workable = row.pushable || SEND_CARD_CLEARS.includes(row.blockedReason ?? '');
  if (!workable) return 'waiting';
  return row.assignorConfirmedAt === null ? 'who_is_signing' : 'ready_to_send';
}

/**
 * THE ROWS FOR ONE PATIENT'S DAY — four of paperwork, and the visit itself.
 *
 * `rows` and `covered` are this patient's slice of the two lists the desk
 * already holds. A patient can legitimately appear in both — signed on the way
 * in, then billed for something the agreement covers — which is why the
 * covered line is what tells "already signed" apart from "never needed to".
 */
export function visitChecklist(
  rows: readonly PushableRow[],
  covered: readonly CoveredServiceRow[],
  deviceLabel: (deviceId: string | null | undefined) => string | null,
): ChecklistRow[] {
  /*
   * BEFORE THE SERVICE AND AFTER IT ARE DIFFERENT ROWS OF THE CHECKLIST, so
   * they are separated here rather than at four call sites. An ongoing
   * agreement counts as the before-the-service one: it is what the patient
   * signs so that today's visit is covered.
   */
  const before = rows.filter((row) => row.agreementType !== 'episodic_post');
  const after = rows.filter((row) => row.agreementType === 'episodic_post');
  const first = before[0] ?? null;
  const later = after[0] ?? null;
  const line = covered[0] ?? null;

  /*
   * ROW 1 — DOES THIS VISIT NEED AN AGREEMENT? Already answered by the
   * versioned visit policy at arrival (`VISIT-CHECKLIST.md` §2), so this reads
   * the answer rather than asking again. A drafted agreement IS the answer
   * "yes", and its type is which kind; a covered line is the answer "no", and
   * carries the rule key that decided.
   */
  const needed: ChecklistRow = first
    ? {
        key: 'needed',
        state: 'done',
        detail: first.agreementType === 'enduring' ? 'ongoing' : 'todaysVisit',
        provider: first.providerName,
      }
    : later
      ? { key: 'needed', state: 'done', detail: 'afterService', provider: later.providerName }
      : { key: 'needed', state: 'not_needed', detail: 'nothingToSign', ruleKey: line?.reason ?? null };

  /*
   * ROW 2 — IS IT READY TO SIGN? Drafting, validating, rendering and locking
   * are automatic, so this is outstanding only where something on the
   * agreement itself is still missing: the description of the service, or a
   * lock that has not happened. Every other refusal is about the device or the
   * signer and belongs to rows 3 and below, not to whether the form is made.
   */
  const made: ChecklistRow = !first
    ? { key: 'made', state: 'not_needed', detail: 'nothingToMake' }
    : first.blockedReason === 'service_description_missing' || !first.particularsLocked
      ? { key: 'made', state: 'outstanding', detail: 'beingPrepared' }
      : { key: 'made', state: 'done', detail: 'ready' };

  /*
   * ROW 3 — SIGNED ON A TABLET. Carl's second note puts the send card here,
   * and this row is what it hangs from.
   *
   * "DONE" IS REACHED THROUGH THE COVERED LINE, not through the queue. The
   * queue holds only UNSIGNED agreements, so a signature takes the row off it
   * entirely; what remains is today's covered line, and `covered` means the
   * item was covered by the agreement they signed on the way in. An ongoing
   * agreement covering the visit is `covered_by_enduring` — nobody signed
   * anything today — so that one reads "nothing to sign" and not "done".
   */
  const signed: ChecklistRow = first
    ? first.activeSession
      ? {
          key: 'signed',
          state: 'outstanding',
          detail: 'withThemNow',
          device: deviceLabel(first.activeSession.deviceId),
        }
      : { key: 'signed', state: 'outstanding', detail: 'notSignedYet' }
    : line && line.decision === 'covered'
      ? { key: 'signed', state: 'done', detail: 'signedAndStored', ruleKey: line.reason }
      : { key: 'signed', state: 'not_needed', detail: 'nothingToSign', ruleKey: line?.reason ?? null };

  /*
   * ROW 4 — SIGNED AFTER THE VISIT. It exists precisely because a service was
   * rendered and the item billed was not covered by what already stood; until
   * that happens there is nothing to sign afterwards, and saying so is more
   * useful than hiding the row and leaving somebody to wonder.
   *
   * NO AMOUNT, AND NO FIELD FOR ONE, anywhere in here (hard rule 4).
   */
  const afterRow: ChecklistRow = later
    ? { key: 'after', state: 'outstanding', detail: 'afterOutstanding', provider: later.providerName }
    : { key: 'after', state: 'not_needed', detail: 'nothingBilledYet' };

  /*
   * ROW 4 (AND ROW 5 IS THE OLD ROW 4) — HAS THE PATIENT BEEN SEEN?
   * D-2026-09-12-20, from Carl with the two pages side by side: *"on /frontdesk
   * the patient goes to 'Finished list' yet on /waiting the dr has not seen the
   * patient as yet. Hence, we need a step 'Consultation completed'."*
   *
   * THE WORD WAS DOING THE LYING. Signing happens in the waiting room, BEFORE
   * the service, so a desk that read "signed" as "finished" announced that a
   * patient was done while the practitioner had not yet called them in.
   *
   * IT READS THE STATE AND NEVER MINTS ONE. `pending` | `with_patient_now` |
   * `completed` | `reassign` are already set from
   * `/practice/practitioner/waiting` by the person who knows, and
   * `completed` is already the service-rendered signal (D-2026-09-12-07). Two
   * places disagreeing about whether somebody has been seen would be worse than
   * the bug this fixes, so this row is a READ.
   *
   * NULL MEANS THERE IS NO VISIT TO BE IN A STATE — a post-service agreement
   * drafted after the fact, a draft with no arrival behind it — and the row
   * says "nothing to see" rather than reporting a state nobody holds.
   *
   * IT GATES NOTHING (hard rule 8, REQ-REC-04). No value here disables a
   * control or refuses a send.
   */
  const seenBy = first ?? later;
  const state = seenBy?.visitState ?? null;
  const consultation: ChecklistRow = state === null
    ? { key: 'consultation', state: 'not_needed', detail: 'visitState', visitState: null }
    : {
        key: 'consultation',
        state: isTheServiceRenderedSignal(state) ? 'done' : 'outstanding',
        detail: 'visitState',
        visitState: state,
      };

  return [needed, made, signed, consultation, afterRow];
}
