import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ARRIVAL_SOURCE_TYPED_BY_A_PERSON } from '@aobplatform/contracts';
import {
  DEFAULT_VISIT_STATE,
  REASSIGNMENT_TASK_KIND,
  VISIT_STATES_VERSION,
  VISIT_STATE_KEYS,
  isTheServiceRenderedSignal,
  latestVisitState,
  maySetVisitState,
  mayBeSetByHand,
  paperworkFor,
  raisesAFrontDeskTask,
  servicesNeedABillingProvider,
  whoTheyCameToSee,
  type AgreementNeeded,
  type WaitingGroup,
  type WaitingList,
  type WaitingRow,
  type WaitingScope,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { AffiliationsService } from '../affiliations/affiliations.service';
import { ArrivalsService } from '../arrivals/arrivals.service';
import { idsOf, newestAgreementInChain, receivedArrivalsIn } from '../arrivals/arrival-day';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';
import type { Actor } from '../auth/actor.decorator';

/**
 * WHAT THE SERVICE-RENDERED SIGNAL CAME TO — a reason code, never prose, and
 * never a gate (hard rule 8). Every one of these leaves the state recorded and
 * the patient seen and billable.
 *
 *  - `raised` — the post-service path ran and answered. WHAT it answered is the
 *    versioned table's business and is on the service record, not here.
 *  - `already_decided` — the practice's software had already told us about this
 *    service and the post-service question was already settled. A second
 *    press is a retry, not a second visit.
 *  - `awaiting_item_numbers` — THE ORDINARY CASE TODAY, and the one Carl has to
 *    decide about. A post-service agreement's particulars include D6b, the MBS
 *    item number(s), and REQ-REG-01 sources them from the PMS invoice. A
 *    practitioner pressing "Completed" does not know them and this platform
 *    must never invent a statutory particular (CLAUDE.md §7). So the signal is
 *    recorded, nothing is drafted, and the existing reconciliation and invoice
 *    paths raise the agreement when the invoice arrives — which is exactly what
 *    they do today. See TODO.md and PRACTITIONER-QUEUE-PAGE.md §3a.
 *  - `provider_not_named` — the visit has no billing provider yet (a nurse's
 *    patient whose supervising provider reception has not named). Recorded, not
 *    refused: ARRIVAL-WHO-IS-SEEN.md §5 says one field is missing, not that the
 *    visit did not happen.
 *  - `not_raised` — the path was attempted and declined the service, with the
 *    reason logged. The state still stands.
 */
export const SERVICE_RENDERED_OUTCOMES = [
  'raised',
  'already_decided',
  'awaiting_item_numbers',
  'provider_not_named',
  'not_raised',
] as const;
export type ServiceRenderedOutcome = (typeof SERVICE_RENDERED_OUTCOMES)[number];

/** What one press of the control comes back with. Ids, keys and times only. */
export interface VisitStateReceipt {
  readonly arrivalId: string;
  readonly state: string;
  readonly statesVersion: string;
  readonly setAt: string;
  /** Null for every state that is not the service-rendered signal. */
  readonly renderedOutcome: ServiceRenderedOutcome | null;
  /** The reception task this raised, where it raised one (§3a rule 4). */
  readonly reviewTaskId: string | null;
}

/** Affiliation statuses that mean somebody is working here now. */
const LIVE_AFFILIATION_STATUSES = ['active', 'ending'] as const;

/**
 * WHO IS WAITING, AND IS THEIR PAPERWORK DONE (PRACTITIONER-QUEUE-PAGE.md §3,
 * §5; Carl 12 September 2026).
 *
 * A READ AND NOTHING ELSE. There is no write on this service and no method
 * that could grow one: §3 says *"no buttons that act on an agreement — a
 * practitioner does not send tablets or correct addresses, and a control they
 * will never legitimately use is a control that will one day be pressed by
 * mistake."* The same reasoning applies a layer down. Nothing here writes, so
 * nothing here needs an outbox event, and the vault is untouched.
 *
 * IT REPORTS; IT DOES NOT GATE (hard rule 8, REQ-REC-04). No caller can be
 * refused a consultation by anything this returns, and a failure here slows
 * the evidence rather than the service.
 *
 * ARRIVALS, NOT AGREEMENTS, ARE THE SPINE. The desk's `pushable` list reads
 * AGREEMENTS and excludes signed ones by construction — which is right for a
 * work queue and wrong here, because "Done" is the answer this page exists to
 * give. It is also the list that cannot show a patient who needs no agreement
 * at all (ARRIVAL-WHO-IS-SEEN.md §3). So this reads the arrivals for today and
 * asks each one what its paperwork came to.
 *
 * WHOSE LIST, DECIDED HERE AND NEVER BY THE CALLER. §4.2: *"Never show another
 * practitioner's list. Scoped to the signed-in practitioner, enforced at the
 * query."* There is no practitioner parameter on any method below — a token
 * carrying a practitioner claim gets that practitioner's list and there is
 * nothing to ask for instead.
 *
 * NO PII LEAVES BUT THE NAME THE ROW IS ABOUT. `WaitingRow` has no field for
 * an identifier value, a date of birth or an amount (hard rules 1, 4, 9), and
 * nothing here logs.
 */
@Injectable()
export class PractitionerQueueService {
  private readonly logger = new Logger(PractitionerQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly affiliations: AffiliationsService,
    private readonly arrivals: ArrivalsService,
    private readonly reviewTasks: ReviewTasksService,
  ) {}

  /**
   * TODAY'S LIST FOR WHOEVER IS ASKING.
   *
   * TWO MODES, ONE READ (Carl, 12 Sep 2026, widening §3):
   *
   *   - A TOKEN WITH A PRACTITIONER CLAIM gets `mine` — their own patients at
   *     this practice, one group. Checked FIRST, because it is the narrower
   *     answer and a person holding both claims must get the narrower one:
   *     widening by accident is the failure that matters here, and narrowing
   *     by accident is merely inconvenient.
   *   - A TOKEN WITH ONLY A PRACTICE CLAIM gets `practice` — every
   *     practitioner with somebody waiting, grouped. An administrator, a
   *     manager or a receptionist needs to know who is waiting for whom.
   *
   * ACROSS PRACTICES IT FINDS NOTHING. `withPractice` sets the RLS scope, and
   * a practitioner's own practice is checked against their live affiliations
   * before the scope is opened — so a practitioner naming somebody else's
   * practice gets a refusal, and a query that somehow reached the database
   * anyway would still see none of its rows.
   */
  async waiting(actor: Actor | undefined, headerPracticeId: string | undefined): Promise<WaitingList> {
    const { practiceId, scope, ownAffiliationIds } = await this.resolveScope(actor, headerPracticeId);
    const own = new Set(ownAffiliationIds);
    return this.prisma.withPractice(practiceId, async (tx) => {
      /*
       * THE PRACTICE'S NAME, FOR THE SESSION BADGE (Carl, 12 Sep 2026). A
       * practitioner's token carries no practice claim, so the page cannot name
       * the practice itself. This service already had to resolve the practice
       * to answer at all, so it says which one. Display only — it grants
       * nothing and gates nothing.
       */
      const practice = await tx.practice.findFirst({ where: { id: practiceId }, select: { name: true } });
      const list = await this.build(tx, scope, (affiliationId) =>
        scope === 'practice' ? true : affiliationId !== null && own.has(affiliationId),
      );
      return { ...list, practiceName: practice?.name ?? null };
    });
  }

  /**
   * WHOSE LIST, AND AT WHICH PRACTICE — the one answer both the read and the
   * write are built on.
   *
   * IT IS SHARED DELIBERATELY (§3a rule 2). *"A practitioner may set a state
   * only on their own patients."* If the write resolved "who am I and what is
   * mine" by its own route, a practitioner could one day be able to SET a state
   * on a row they cannot SEE, or the reverse. One function means the two
   * questions have one answer and cannot drift.
   *
   * A PRACTITIONER CLAIM IS CHECKED FIRST, because it is the narrower answer
   * and a person holding both claims must get the narrower one: widening by
   * accident is the failure that matters, narrowing by accident is merely
   * inconvenient.
   *
   * THE AFFILIATIONS ARE READ INSIDE THE PRACTICE SCOPE. A practitioner can
   * hold more than one here — two locations, two departments — and every one of
   * them is theirs. RLS makes anybody else's invisible to the query, so the set
   * cannot widen.
   */
  private async resolveScope(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
  ): Promise<{ practiceId: string; scope: WaitingScope; ownAffiliationIds: string[] }> {
    const practitionerId = actor?.practitionerId;
    if (!practitionerId) {
      return { practiceId: requirePractice(headerPracticeId), scope: 'practice', ownAffiliationIds: [] };
    }

    const practiceId = await this.practiceForPractitioner(practitionerId, headerPracticeId);
    const mine = await this.prisma.withPractice(practiceId, (tx) =>
      tx.affiliation.findMany({
        where: { practitionerId, status: { in: [...LIVE_AFFILIATION_STATUSES] } },
        select: { id: true },
      }),
    );
    return { practiceId, scope: 'mine', ownAffiliationIds: mine.map((row) => row.id) };
  }

  /**
   * SET WHERE THIS VISIT HAS GOT TO (§3a; Carl, 12 September 2026).
   *
   * THE ONE WRITE THIS PAGE HAS, AND IT IS NARROW BY CONSTRUCTION. §3 forbids
   * *"buttons that act on an agreement"* and that rule stands: this touches no
   * agreement, sends no tablet, corrects no detail and moves no patient. It
   * records attendance — who said where a visit had got to, and when
   * (VISIT-CHECKLIST.md §5: *"the only control a practitioner ever gets is 'I
   * have seen this patient'"*).
   *
   * WHO MAY, AND IT FAILS CLOSED (§3a rule 2). A practitioner may set a state
   * only on patients who came to see THEM; practice staff may set any. The
   * decision is `maySetVisitState` in the domain, given the affiliations the
   * caller's own practice scope already returned — so the two ways this can be
   * wrong are both impossible: a cross-practitioner write has no matching
   * affiliation, and a cross-practice one cannot see the arrival at all, twice
   * over (the practitioner's practice is checked against their live
   * affiliations before any scope opens, and RLS then hides the row).
   *
   * NO FREE TEXT ANYWHERE (§3a rule 1). The only thing a caller may send is a
   * state key, and a key not in the versioned list is refused rather than
   * stored. There is no note parameter and there is nowhere for one to go.
   *
   * REVERSIBLE, AND THE CORRECTION IS KEPT BESIDE THE ORIGINAL (§3a rule 6).
   * Every press is an INSERT. Nothing here updates and nothing deletes.
   *
   * THE ORDER OF THE WRITES IS DELIBERATE AND IT IS HARD RULE 8. The
   * service-rendered attempt runs FIRST and outside the transaction, because
   * `serviceRendered` opens its own (as `receive` does, and for the same
   * reason). Whatever it comes to — including a failure — the state is then
   * recorded WITH ITS OUTCOME in one transaction beside its vault event, so a
   * state row without its event, or an event without its row, is structurally
   * impossible (hard rule 11).
   *
   * WHAT THAT ORDERING DOES NOT PROMISE, said plainly rather than glossed. If
   * the post-service path SUCCEEDS and the state transaction then fails, an
   * agreement exists and no `visit_states` row records the press that caused
   * it. That is not a gap in the evidence — `serviceRendered` writes its own
   * `service.rendered` event in its own transaction, so what happened to the
   * AGREEMENT is fully evidenced either way — it is a gap in the ATTENDANCE
   * note, which is a working view and not the record of care
   * (VISIT-CHECKLIST.md §7 rule 6). The caller sees the failure and presses
   * again; the second press is a retry (`already_decided`) and not a second
   * visit. The alternative ordering is worse: writing the state first would
   * mean a row asserting the signal had been raised when it had not.
   *
   * A platform that could not raise the post-agreement has slowed the
   * evidence; it has not stopped the patient being seen or billed (REQ-REC-04).
   */
  async setState(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
    arrivalId: string,
    state: string,
  ): Promise<VisitStateReceipt> {
    /*
     * THE KEY IS CHECKED AGAINST THE VERSIONED CONTENT, NOT AGAINST A LITERAL
     * (hard rule 14). `pending` is refused here as well as by the database
     * CHECK: it is the starting state and §3a's table gives it no setter, so
     * storing one would be a person moving a patient backwards into "not yet
     * seen" after the service-rendered signal had already gone.
     */
    if (!mayBeSetByHand(state)) {
      throw new BadRequestException(
        `"${state}" is not a state anybody can set here. Choose one of: ` +
          `${VISIT_STATE_KEYS.filter((key) => mayBeSetByHand(key)).join(', ')}. ` +
          `"${DEFAULT_VISIT_STATE}" is where every visit starts and is never set by hand.`,
      );
    }

    const { practiceId, scope, ownAffiliationIds } = await this.resolveScope(actor, headerPracticeId);

    /*
     * THE ARRIVAL, INSIDE THE SCOPE. A row belonging to another practice is not
     * refused — it is INVISIBLE, because RLS never returns it, so this reads as
     * "no such visit" and gives away nothing about whose it was.
     */
    const arrival = await this.prisma.withPractice(practiceId, (tx) =>
      tx.arrival.findUnique({
        where: { id: arrivalId },
        select: {
          id: true,
          patientId: true,
          affiliationId: true,
          seeingAffiliationId: true,
          pmsPatientRecordNumber: true,
          arrivedAt: true,
          outcome: true,
        },
      }),
    );
    if (!arrival || arrival.outcome !== 'received') {
      throw new NotFoundException(
        'There is no visit here to set a state on. Open the waiting list again — the person may have been ' +
          'moved, or the arrival may have been sent again with a correction.',
      );
    }

    if (!maySetVisitState({ scope, ownAffiliationIds, seeingAffiliationId: whoTheyCameToSee(arrival) })) {
      /*
       * IT NAMES NOBODY. The caller is being told their own scope is wrong, and
       * a refusal that named the practitioner whose patient this is would be a
       * roster leak to anybody with a practitioner account.
       */
      throw new ForbiddenException(
        'This patient did not come to see you, so their visit is not yours to mark. The front desk can set ' +
          'a state on anybody.',
      );
    }

    /*
     * COMPLETED IS THE SERVICE-RENDERED SIGNAL (§3a rule 3, VISIT-CHECKLIST.md
     * §6) — attempted before the state is written, so its answer can be recorded
     * on the same row. It is never allowed to throw: hard rule 8.
     */
    const rendered = isTheServiceRenderedSignal(state)
      ? await this.raiseTheServiceRendered(practiceId, arrival, actor)
      : null;

    const principal = actorFor(actor);

    return this.prisma.withPractice(practiceId, async (tx) => {
      /*
       * REASSIGN NEVER REASSIGNS (§3a rule 4). It raises a task for RECEPTION
       * and changes nothing about who the patient is here to see: no field on
       * the arrival is touched, no agreement is superseded, nobody is moved.
       * Who the patient DOES see is reception's decision on the front desk
       * page, where the covering-provider check runs — an enduring agreement is
       * per practitioner × patient (hard rule 6) — and the patient is asked
       * first (D-2026-09-12-03).
       *
       * IT REUSES `review_tasks` RATHER THAN ADDING A TABLE. That queue already
       * carries practice-scoped work with a subject, already surfaces on the
       * patient's own work page through `openForPatients`, and already has the
       * stakes rule that stops an automated check closing something a person
       * must do. A second table would have been a second inbox.
       *
       * IN THE SAME TRANSACTION AS THE STATE, for the reason `raise`'s own
       * docstring gives: a state saved without its task is a request nobody
       * will see, and it would look exactly like a request nobody needed.
       */
      const task = raisesAFrontDeskTask(state)
        ? await this.reviewTasks.raise(tx, {
            practiceId,
            kind: REASSIGNMENT_TASK_KIND,
            /*
             * THE SUBJECT IS THE PATIENT WHERE THERE IS ONE, because that is
             * what puts the task on the patient's own work page at the desk —
             * the same join `portal_correction_requested` uses. The arrival
             * travels in `detail` either way, so the desk can land on today's
             * visit.
             *
             * AND IT IS THE ARRIVAL WHERE THERE IS NOT. `Arrival.patientId` is
             * nullable — *"null only if resolution failed"* — and a row saying
             * `subjectType: 'Patient'` over an ARRIVAL id would be a lie the
             * patient work page could never resolve, and would look exactly
             * like a task about somebody who does not exist. The request is
             * still recorded, because refusing it would be blocking on a
             * missing join (hard rule 8); the desk finds it on the review queue
             * rather than on a patient page, which is where an unresolved
             * arrival belongs anyway.
             */
            subjectType: arrival.patientId ? 'Patient' : 'Arrival',
            subjectId: arrival.patientId ?? arrival.id,
            /*
             * NO FREE TEXT FROM THE CALLER (§3a rule 1). This sentence is OURS,
             * fixed, and carries no reason because the control offers none —
             * the practitioner said "not me" and that is the whole message.
             */
            summary:
              'A practitioner asked for this patient to be seen by somebody else today. Nobody has been ' +
              'moved: choose who sees them, and check whether their agreement still covers the visit.',
            detail: { arrivalId: arrival.id, seeingAffiliationId: arrival.seeingAffiliationId ?? null },
            raisedBy: principal.id,
          })
        : null;

      const row = await tx.visitState.create({
        data: {
          practiceId,
          arrivalId: arrival.id,
          state,
          /* Hard rule 14: which list this was chosen from, on the record. */
          statesVersion: VISIT_STATES_VERSION,
          setByPrincipalId: principal.id,
          setByPrincipalType: principal.principalType,
          serviceRecordId: rendered?.serviceRecordId ?? null,
          renderedOutcome: rendered?.outcome ?? null,
          reviewTaskId: task?.id ?? null,
        },
      });

      /*
       * THE EVENT, IN THIS TRANSACTION (hard rule 11, FR-11.2). IDS, THE STATE
       * KEY AND THE CONTENT VERSION — no name, no identifier value of any kind
       * (hard rules 1 and 9), no reason, no amount (hard rule 4). There is no
       * free text on the control, so there is none here.
       */
      await enqueueVaultEvent(tx, {
        type: 'visit.state_set',
        actor: principal,
        subject: { type: 'Arrival', id: arrival.id },
        payload: {
          practiceId,
          arrivalId: arrival.id,
          patientId: arrival.patientId ?? '',
          seeingAffiliationId: arrival.seeingAffiliationId ?? '',
          billingAffiliationId: arrival.affiliationId ?? '',
          state,
          statesVersion: VISIT_STATES_VERSION,
          setByScope: scope,
          serviceRenderedOutcome: rendered?.outcome ?? '',
          serviceRecordId: rendered?.serviceRecordId ?? '',
          reviewTaskId: task?.id ?? '',
        },
      });

      return {
        arrivalId: arrival.id,
        state: row.state,
        statesVersion: row.statesVersion,
        setAt: row.setAt.toISOString(),
        renderedOutcome: rendered?.outcome ?? null,
        reviewTaskId: task?.id ?? null,
      } satisfies VisitStateReceipt;
    });
  }

  /**
   * COMPLETED IS THE SERVICE-RENDERED SIGNAL — and what this page can and
   * cannot supply (§3a rule 3, VISIT-CHECKLIST.md §6).
   *
   * IT REUSES `ArrivalsService.serviceRendered` AND REIMPLEMENTS NOTHING. That
   * method owns the two coverage questions, the versioned post-service table
   * that answers them, the draft, the lock and the capture request. A second
   * copy of that decision here would be a second answer to "is another
   * signature owed", and hard rule 14 exists precisely to stop that.
   *
   * WHAT IT CANNOT SUPPLY, AND WHY NOTHING IS INVENTED. A post-service
   * agreement's particulars include D6b — the MBS item number(s) — and
   * REQ-REG-01 sources them from the PMS invoice. `lockParticulars` requires
   * them, and hard rule 2 forbids a signature over an incomplete payload. A
   * practitioner pressing "Completed" does not know the item numbers, and this
   * platform must never infer a statutory particular (CLAUDE.md §7: *"Never
   * invent regulatory facts"*). So:
   *
   *   - WHERE THE PRACTICE'S OWN SOFTWARE HAS ALREADY SAID WHAT WAS DONE — an
   *     undecided `service_records` row for this patient carrying its own item
   *     numbers and its own service date, which is what `PmsSyncService` writes
   *     from an invoice — the signal is passed straight through with the PMS's
   *     OWN particulars. Nothing is invented; the numbers are theirs.
   *   - OTHERWISE the state is recorded, `awaiting_item_numbers` is recorded
   *     beside it, and NOTHING IS DRAFTED. The invoice path raises the
   *     agreement when the invoice arrives, exactly as it does today.
   *
   * FLAGGED FOR CARL RATHER THAN DECIDED (wow.md §9). Whether "Completed"
   * should be able to raise a post-service agreement BEFORE the invoice — and
   * if so, where D5 and D6b would come from — is a regulatory question, not a
   * build one.
   *
   * IT NEVER THROWS (hard rule 8, REQ-REC-04). Every failure below returns a
   * reason code; the state is recorded either way, and the patient is seen and
   * billable either way.
   */
  private async raiseTheServiceRendered(
    practiceId: string,
    arrival: {
      id: string;
      patientId: string | null;
      affiliationId: string | null;
      pmsPatientRecordNumber: string;
      /** The day the visit is about, by the practice's clock. */
      arrivedAt: Date;
    },
    actor: Actor | undefined,
  ): Promise<{ outcome: ServiceRenderedOutcome; serviceRecordId: string | null }> {
    /*
     * NO BILLING PROVIDER, NO POST-SERVICE QUESTION TO ASK. A nurse's patient
     * whose supervising provider reception has not yet named, or a
     * phlebotomist's patient with no claim at all — ARRIVAL-WHO-IS-SEEN.md §5
     * says one field is missing, not that the visit did not happen. Recorded,
     * never refused.
     */
    const patientId = arrival.patientId;
    const billingAffiliationId = arrival.affiliationId;
    if (!billingAffiliationId || !patientId) {
      return { outcome: 'provider_not_named', serviceRecordId: null };
    }

    /*
     * THE ARRIVAL'S OWN DAY, BOUNDED AT BOTH ENDS — not "since midnight".
     *
     * A VISIT IS ONE PATIENT ON ONE DAY, and the day is the one they walked in
     * on (`arrivedAt`, by the practice's clock), not the one the server happens
     * to be having. An unbounded `gte` would let a `findFirst ... desc` pick a
     * FUTURE-dated service record, and a window anchored on "now" is a
     * different window from the arrival's for several hours a day wherever the
     * server's clock and the practice's disagree. Both would attach the
     * service-rendered signal to the wrong service, which is the one mistake
     * here that would put D5 wrong on a contract.
     *
     * BUILT WITH `Date.UTC`, AND THAT IS NOT A STYLE CHOICE. `serviceDate` is
     * `@db.Date` — a plain calendar day (D5), deliberately, because *"a
     * particular of a contract may not depend on which side of midnight
     * Greenwich is"*. Prisma compares such a column by the UTC DATE PART of
     * whatever Date it is given, so a bound built with `setHours(0,0,0,0)` in
     * Sydney (UTC+10) becomes the PREVIOUS calendar day the moment it crosses
     * the wire: the window would then match yesterday's invoice and miss
     * today's, silently. Taking the LOCAL calendar day and stamping it at UTC
     * midnight asks for the day the practice means.
     */
    const day = new Date(arrival.arrivedAt);
    const dayStart = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
    const dayEnd = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate() + 1));

    /*
     * WHAT THE PRACTICE'S SOFTWARE HAS ALREADY TOLD US ABOUT THAT DAY'S SERVICE.
     * `PmsSyncService.upsertServiceRecord` writes one of these per invoice,
     * carrying D5 and D6b and no decision; `serviceRendered` is built to fall
     * through on exactly that row (*"a row the invoice sync created without a
     * decision ... falls through to be decided here, because the patient
     * turning up at the desk is new information about a service the platform
     * already knew about"*).
     */
    const { record, patient } = await this.prisma.withPractice(practiceId, async (tx) => ({
      record: await tx.serviceRecord.findFirst({
        where: { practiceId, patientId, serviceDate: { gte: dayStart, lt: dayEnd } },
        orderBy: { serviceDate: 'desc' },
        select: { id: true, pmsInvoiceKey: true, serviceDate: true, mbsItemNumbers: true, visitDecision: true },
      }),
      /*
       * THE RECORD NUMBER OFF THE MIRROR, NOT OFF THE ARRIVAL'S OWN COPY.
       * `serviceRendered` joins on `Patient.patientRecordNumber` and refuses
       * outright where it finds nobody — *"a rendered service carries no
       * patient details and never creates a record from a billing message"*
       * (REQ-DATA-10). The arrival carries the handle the SENDER used, which
       * resolved to this patient once and may since have been corrected on the
       * mirror. Reading the mirror asks the same question of the same row the
       * `patientId` above already names, so the two cannot disagree.
       */
      patient: await tx.patient.findUnique({
        where: { id: patientId },
        select: { patientRecordNumber: true },
      }),
    }));

    // Already answered. A second press is a retry, not a second visit.
    if (record?.visitDecision) return { outcome: 'already_decided', serviceRecordId: record.id };

    if (!record || record.mbsItemNumbers.length === 0) {
      /*
       * THE ORDINARY CASE TODAY. Nothing is drafted and nothing is invented;
       * the invoice path raises the agreement when the invoice arrives.
       */
      return { outcome: 'awaiting_item_numbers', serviceRecordId: record?.id ?? null };
    }

    try {
      const receipt = await this.arrivals.serviceRendered(
        practiceId,
        {
          pmsPatientRecordNumber: patient?.patientRecordNumber ?? arrival.pmsPatientRecordNumber,
          /* Whose number the claim goes under — the arrival's own billing anchor. */
          affiliationId: billingAffiliationId,
          /* D5 AND D6b ARE THE PMS'S OWN, off the row it wrote. Neither is ours. */
          serviceDate: record.serviceDate.toISOString().slice(0, 10),
          mbsItemNumbers: [...record.mbsItemNumbers],
          /*
           * A PERSON AT THE PRACTICE SAID SO, which is what `reception` means
           * here — the source distinguishes a human's word from a connector's
           * message, and a practitioner pressing a control is a human's word.
           */
          source: ARRIVAL_SOURCE_TYPED_BY_A_PERSON,
          /* The invoice's own key, so a second press is a retry, not a second service. */
          idempotencyKey: record.pmsInvoiceKey,
        },
        /*
         * THE FIELD NAMES WE ACTUALLY SENT, for `assertNoMedicareOrAmount`.
         * There is no Medicare number and no amount among them, and there is no
         * route by which this page could add one.
         */
        ['pmsPatientRecordNumber', 'affiliationId', 'serviceDate', 'mbsItemNumbers', 'source', 'idempotencyKey'],
        actor,
      );
      return { outcome: 'raised', serviceRecordId: receipt.serviceRecordId ?? record.id };
    } catch (err) {
      /*
       * SLOWER EVIDENCE, NEVER SLOWER CARE (hard rule 8, REQ-REC-04). The state
       * still stands, the patient has still been seen, and reception can still
       * capture after the fact. Logged without a patient value.
       */
      /*
       * THE CLASS AND THE STATUS, NEVER THE MESSAGE (hard rule 9, REQ-VER-04).
       * `serviceRendered`'s own refusals are written for a HUMAN at a desk and
       * name the provider (*"Dr Chen is recorded as..."*) or the patient record
       * number it could not match — both of which are exactly what may not
       * reach a log. What a log needs is which failure it was, and the reason
       * CODE where the thrower gave one; the rest is on the state row.
       */
      const why = err as { constructor?: { name?: string }; status?: number; reason?: string };
      this.logger.warn(
        `Arrival ${arrival.id}: "completed" could not raise the post-service question — the state is ` +
          `recorded and the service is still billable. (${why.constructor?.name ?? 'Error'}` +
          `${typeof why.status === 'number' ? ` ${why.status}` : ''}` +
          `${typeof why.reason === 'string' ? `: ${why.reason}` : ''})`,
      );
      return { outcome: 'not_raised', serviceRecordId: record.id };
    }
  }

  /**
   * WHICH PRACTICE A PRACTITIONER IS ASKING ABOUT.
   *
   * A PRACTITIONER'S TOKEN CARRIES NO PRACTICE CLAIM, deliberately and by
   * design: they work at several practices and which ones changes, so stamping
   * one on the token would pick a winner arbitrarily
   * (`PractitionerAccessService`). This page is nonetheless about ONE practice
   * — it is *"my work at THIS practice, today"* (§1) — so the practice has to
   * come from somewhere, and the two honest sources are the request and their
   * own affiliations.
   *
   * THE HEADER IS A REQUEST, NEVER A GRANT. Whatever it names is checked
   * against the affiliations the SECURITY DEFINER function returns for this
   * practitioner, and an unlisted practice is refused. It is checked BEFORE
   * `withPractice` opens the scope rather than after, so a wrong id never
   * becomes an RLS setting at all.
   *
   * NO HEADER AND ONE PRACTICE is the ordinary case and needs no question
   * asked. No header and SEVERAL is a real choice the platform must not make
   * for them, and the refusal says so rather than guessing.
   */
  private async practiceForPractitioner(
    practitionerId: string,
    headerPracticeId: string | undefined,
  ): Promise<string> {
    const rows = await this.affiliations.listForPractitioner(practitionerId);
    const live = [
      ...new Set(
        rows
          .filter((row) => LIVE_AFFILIATION_STATUSES.includes(String(row.status) as 'active' | 'ending'))
          .map((row) => String(row.practiceId)),
      ),
    ];

    if (headerPracticeId) {
      /*
       * FAILS CLOSED, AND SAYS WHY WITHOUT SAYING WHOSE. The message names no
       * practice and no person — it is the caller's own scope that is wrong,
       * and a refusal that confirmed a practice exists would be a small
       * directory of practices for anybody with a practitioner account.
       */
      if (!live.includes(headerPracticeId)) {
        throw new ForbiddenException(
          'You do not work at the practice this page was opened for, so there is no list to show you.',
        );
      }
      return headerPracticeId;
    }

    if (live.length === 1) return live[0]!;
    if (live.length === 0) {
      throw new ForbiddenException(
        'You have no current affiliation with a practice, so there is nobody waiting for you here. If that ' +
          'is wrong, ask the practice to check your listing.',
      );
    }
    throw new BadRequestException(
      'You work at more than one practice, so this page needs to know which one you are at today. Choose ' +
        'the practice first and open your waiting list from there.',
    );
  }

  /**
   * THE LIST ITSELF — one transaction, no network calls, nothing written.
   *
   * `keep` DECIDES WHOSE ROWS SURVIVE, and it is applied to the affiliation the
   * patient came to see, before anything else is read. Filtering after the fact
   * would mean the other rows had already been assembled — names and all — and
   * one careless `return` away from being sent.
   */
  private async build(
    tx: Parameters<Parameters<PrismaService['withPractice']>[1]>[0],
    scope: WaitingScope,
    keep: (seeingAffiliationId: string | null) => boolean,
  ): Promise<WaitingList> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    /*
     * TODAY, AND ONLY WHAT WAS ACCEPTED — the shared read
     * (`arrivals/arrival-day.ts`), which the day register makes too. A refused
     * arrival is not somebody waiting, and arrival order is reception's order;
     * both rules live in one place so the two pages cannot disagree about who
     * came in.
     *
     * NO UPPER BOUND, DELIBERATELY. This is the live list, and a clock a few
     * minutes fast at the sender must never drop somebody standing in the room.
     * The register, which is about a NAMED day, bounds both ends.
     */
    const arrivals = (await receivedArrivalsIn(tx, { from: startOfDay })).filter((arrival) =>
      keep(whoTheyCameToSee(arrival)),
    );

    if (arrivals.length === 0) return { scope, groups: [] };

    const patients = await tx.patient.findMany({
      where: { id: { in: idsOf(arrivals.map((a) => a.patientId)) } },
      select: { id: true, givenNames: true, familyName: true },
    });
    const patientById = new Map(patients.map((p) => [p.id, p]));

    /*
     * THE NEWEST AGREEMENT IN EACH CHAIN, because that is the one that gets
     * signed. `Arrival.agreementId` names the agreement drafted when the
     * patient walked in — the HEAD of the chain — and a correction supersedes
     * it with a new row the arrival has never heard of. Reading only the
     * arrival's own agreement would show "Not yet" for a patient who signed
     * the successor five minutes ago, which is the single worst thing this
     * page can get wrong.
     */
    const newest = await newestAgreementInChain(tx, idsOf(arrivals.map((a) => a.agreementId)));
    const agreements = await tx.agreement.findMany({
      where: { id: { in: [...new Set(newest.values())] } },
      select: { id: true, affiliationId: true, signatureEventId: true },
    });
    const agreementById = new Map(agreements.map((a) => [a.id, a]));

    /*
     * WHERE EACH VISIT HAS GOT TO (§3a). Every saying, for the arrivals on
     * screen, read in one query and flattened per arrival by the domain's own
     * `latestVisitState` — the newest wins and the older ones survive, which IS
     * §3a rule 6: *"a wrong state is corrected, and the correction is kept
     * beside the original rather than over it."*
     */
    const stateRows = await tx.visitState.findMany({
      where: { arrivalId: { in: arrivals.map((a) => a.id) } },
      select: { arrivalId: true, state: true, statesVersion: true, setAt: true },
      orderBy: { setAt: 'asc' },
    });
    const statesByArrival = new Map<string, { state: string; statesVersion: string; setAt: string }[]>();
    for (const row of stateRows) {
      const list = statesByArrival.get(row.arrivalId) ?? [];
      list.push({ state: row.state, statesVersion: row.statesVersion, setAt: row.setAt.toISOString() });
      statesByArrival.set(row.arrivalId, list);
    }

    /*
     * WHO HAS A TABLET IN THEIR HANDS RIGHT NOW. The same read the desk makes,
     * and the only thing on this page that changes minute to minute.
     */
    const liveSessions = await tx.tabletSession.findMany({
      where: { endedAt: null },
      select: { agreementId: true },
    });
    const liveByAgreement = new Set(liveSessions.map((s) => s.agreementId));

    /*
     * THE PEOPLE, BY AFFILIATION — the person the patient came to see, and the
     * person the agreement is anchored on, which §6a says are two facts. Read
     * once for the whole list rather than once a row.
     */
    const affiliationIds = idsOf([
      ...arrivals.map((a) => whoTheyCameToSee(a)),
      ...agreements.map((a) => a.affiliationId),
    ]);
    const affiliationRows = await tx.affiliation.findMany({
      where: { id: { in: affiliationIds } },
      select: { id: true, practitionerId: true, billingRole: true },
    });
    // `practitioners` is deliberately not practice-scoped: a practitioner is
    // one human across the platform. Only names are read, and only for
    // affiliations this practice's own RLS already returned.
    const practitionerRows = await tx.practitioner.findMany({
      where: { id: { in: [...new Set(affiliationRows.map((a) => a.practitionerId))] } },
      select: { id: true, givenNames: true, familyName: true },
    });
    const practitionerById = new Map(practitionerRows.map((p) => [p.id, p]));
    const affiliationById = new Map(
      affiliationRows.map((a) => [
        a.id,
        {
          billingRole: a.billingRole,
          name: nameOf(practitionerById.get(a.practitionerId)),
        },
      ]),
    );

    /*
     * GROUPED BY WHO THE PATIENT CAME TO SEE, in the order the first patient
     * for each practitioner arrived. A practitioner's own list is one group;
     * reception's is one per practitioner with somebody waiting.
     */
    const groups = new Map<string, { affiliationId: string | null; practitionerName: string | null; rows: WaitingRow[] }>();

    for (const arrival of arrivals) {
      const patient = arrival.patientId ? patientById.get(arrival.patientId) : undefined;
      // No resolved patient is no row. There is no name to show and inventing
      // a placeholder would put an anonymous person on a practitioner's list.
      if (!patient) continue;

      const seeing = whoTheyCameToSee(arrival);
      const seeingAffiliation = seeing ? affiliationById.get(seeing) : undefined;

      const agreementId = arrival.agreementId ? newest.get(arrival.agreementId) : undefined;
      const agreement = agreementId ? agreementById.get(agreementId) : undefined;

      const row: WaitingRow = {
        arrivalId: arrival.id,
        patientName: `${patient.givenNames} ${patient.familyName}`.trim(),
        waitingSince: arrival.arrivedAt.toISOString(),
        paperwork: paperworkFor({
          // "Done" IS THE SIGNATURE EVENT, not a status column: the event is a
          // link in the non-repudiation chain, and a status is something
          // somebody could set.
          signatureEventId: agreement?.signatureEventId ?? null,
          liveCaptureSession: agreementId ? liveByAgreement.has(agreementId) : false,
          agreementNeeded: this.agreementNeededFor({
            hasAgreement: Boolean(agreement),
            visitDecision: arrival.visitDecision,
            billingProviderNamed: arrival.affiliationId !== null,
            seeingBillingRole: seeingAffiliation?.billingRole ?? null,
          }),
        }),
        /*
         * WHOSE AGREEMENT IT IS, WHERE THAT IS SOMEBODY ELSE (§6a). *"'Dr
         * Chen's agreement — done' is honest; 'your agreement' would not be."*
         * Null whenever the agreement is anchored on the same person the
         * patient came to see, which is every ordinary GP visit — so a name
         * here always marks a real difference.
         */
        agreementProviderName:
          agreement?.affiliationId && agreement.affiliationId !== seeing
            ? (affiliationById.get(agreement.affiliationId)?.name ?? null)
            : null,
        /*
         * WHERE THE VISIT HAS GOT TO (§3a). `pending` for an untouched row,
         * which is honest and is not a warning: nothing about it gates a
         * consultation or a bill (§3a rule 5, hard rule 8). The flattening is
         * the domain's, not this file's, so the console and the server cannot
         * disagree about which saying is the current one.
         */
        visitState: latestVisitState(statesByArrival.get(arrival.id) ?? []),
      };

      const key = seeing ?? '';
      const group = groups.get(key);
      if (group) group.rows.push(row);
      else {
        groups.set(key, {
          affiliationId: seeing,
          practitionerName: seeingAffiliation?.name ?? null,
          rows: [row],
        });
      }
    }

    return { scope, groups: [...groups.values()] satisfies WaitingGroup[] };
  }

  /**
   * DOES THIS VISIT NEED AN AGREEMENT AT ALL?
   *
   * ANSWERED FROM FACTS, NOT FROM THE POLICY TABLE'S RULE KEYS. The keys in
   * `visit-agreement-policy.json` are versioned content (hard rule 14), and a
   * switch on `already_covered_by_an_enduring_agreement` here would be a
   * second, unversioned copy of that mapping. These three facts stay true
   * whatever the table is edited to say next quarter, and the one content
   * question — "does a service by somebody in this role need a billing
   * provider at all" — is asked of the content itself through
   * `servicesNeedABillingProvider`.
   *
   * THE ORDER MATTERS, and the second and third are the pair
   * ARRIVAL-WHO-IS-SEEN.md §5 says a screen must never blur: a phlebotomist's
   * patient is FINISHED and a nurse's patient with no billing provider named
   * is WAITING, and both come back from the policy table as `none`.
   */
  private agreementNeededFor(facts: {
    hasAgreement: boolean;
    visitDecision: string | null;
    billingProviderNamed: boolean;
    seeingBillingRole: string | null;
  }): AgreementNeeded {
    // A draft exists, so the question is only whether it has been signed.
    if (facts.hasAgreement) return 'yes';

    /*
     * NOTHING DECIDED, OR SOMETHING DECIDED THAT HAS NOT BEEN DRAFTED YET.
     * "Not yet" is the honest answer and the safe one: it says work may be
     * outstanding, which is true, and it gates nothing.
     */
    if (facts.visitDecision !== 'none') return 'yes';

    // The phlebotomist's patient. No Medicare claim, so no benefit to assign
    // and nothing to sign — now or ever. Asked of the versioned content.
    if (facts.seeingBillingRole !== null && !servicesNeedABillingProvider(facts.seeingBillingRole)) return 'no';

    // The nurse's patient with nobody named to bill under. The visit needs a
    // claim and one field is missing, so something IS outstanding.
    if (!facts.billingProviderNamed) return 'yes';

    /*
     * WHAT IS LEFT: a visit that needs no NEW agreement because a signed,
     * stored one already covers it. That is "Done", and it is done — the
     * signature exists, it is simply not today's.
     */
    return 'covered_already';
  }
}

/**
 * WHO SET IT, FROM THE TOKEN AND NEVER FROM A FORM (§3a rule 1;
 * VISIT-CHECKLIST.md §7 rule 4: *"Marking is attributable — who marked it and
 * when, from the token, never a typed name."*).
 *
 * THE SAME SHAPE `ArrivalsService` USES, and deliberately its own copy rather
 * than an import across a module boundary: the subject of the token the realm
 * signed, or the platform where no person is signed in. A name in a body is an
 * assertion; an id in a token is a claim somebody signed.
 */
const SYSTEM_ACTOR = { principalType: 'system', id: 'practitioner-queue' } as const;

function actorFor(actor: Actor | undefined): { principalType: string; id: string } {
  return actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR;
}

function nameOf(practitioner: { givenNames: string; familyName: string } | undefined): string | null {
  return practitioner ? `${practitioner.givenNames} ${practitioner.familyName}`.trim() : null;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}
