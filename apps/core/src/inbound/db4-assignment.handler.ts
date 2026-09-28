import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Db4JobOutcome, Db4PlacementReason, PrintJobEnvelope } from '@aobplatform/contracts';
import { AgreementsService } from '../agreements/agreements.service';
import { CaptureService } from '../capture/capture.service';
import { decideDb4Reprint, type Db4Particulars } from './db4-reprint';
import { PrismaService } from '../prisma/prisma.service';
import { ArrivalsService, ArrivalRefusal } from '../arrivals/arrivals.service';
import type { ServiceRenderedDto } from '../arrivals/arrivals.dto';

/**
 * A DB4 PRINTED TO AOBPRINTER BECOMES A POST-SERVICE AGREEMENT
 * (DB4-AND-AOBL.md §13a piece 1; D-2026-09-14-02/-03/-04).
 *
 * A DB4 IS PRECISELY A POST-SERVICE EVENT, so this class decides nothing. It
 * reads the printed form, assembles the `ServiceRenderedDto` that form is
 * describing, and hands it to `ArrivalsService.serviceRendered` — the one code
 * path that owns the regulated work: the billing-role gate, the versioned
 * post-service policy and its version (hard rule 14), the service record keyed
 * on `pmsInvoiceKey`, the `episodic_post` draft, the in-practice capture
 * request, the assignor carry-forward, and the lock of the particulars before a
 * signature is possible (hard rule 2, REQ-REG-06). A second implementation of
 * any of that would be a second place the rules have to hold.
 *
 * WHAT DOES *NOT* CROSS THE BOUNDARY. The DB4 Print Record carries
 * `patient.medicareCardNumber`, `patient.irn` and `services[].benefitAssigned`
 * because the Signed-DB4 reproduces the practice's own printed form
 * (D-2026-09-14-03). None of the three reaches an agreement, its particulars, a
 * log line or a vault event. The mechanism is structural rather than careful:
 * only the fields `ServiceRenderedDto` declares are assembled, and
 * `assertNoMedicareOrAmount` is handed the very key list we send, so a field
 * added here that looked like either would be refused out loud rather than
 * quietly carried (hard rules 4 and 9).
 *
 * THE CHART NUMBER IS THE JOIN KEY, AND THE ONLY ONE. `patient.pmsLinkageKey`
 * is what the generic print lane matches on and is deliberately not used here —
 * `serviceRendered` looks a patient up by `patientRecordNumber`, and two keys
 * for one person is how the two come to disagree. The Medicare number is never
 * a key for anything (hard rule 1, REQ-VER-02).
 *
 * THE SERVICING PROVIDER ANCHORS THE VISIT. A DB4 prints two: the person who
 * rendered the service and the person the benefit is paid to. The agreement
 * must name whose provider number the claim goes under (s 65C(5)(a)), which is
 * the servicing one. The payee is recorded on the job outcome, for the write-back
 * and for the claim, and never used to anchor.
 *
 * IT NEVER THROWS FOR A FORM IT CANNOT PLACE (hard rule 8, REQ-REC-04). An
 * unknown chart number, a provider this practice cannot bill under, a service
 * an agreement already covers — each is a normal answer, written onto the job
 * row as a reason code so the row is `done` rather than retried eight times on
 * the lane that serves the patient standing at the desk. Only a fault that
 * retrying could fix — the database having a moment, the rules service down —
 * is allowed out of here.
 */
/**
 * THE FOUR DB4-DETERMINED PARTICULARS, READ OFF A LOCKED AGREEMENT.
 *
 * FROM `particulars`, WHICH IS THE LOCK ITSELF — not from the columns beside
 * it. The locked JSON is what the rules engine validated, what the renderer
 * printed and what the patient assented to; a column is the working copy. If
 * the two ever disagree, the lock is the one a corrected form has to be
 * compared against, because the lock is the contract.
 *
 * NULL WHEN NOTHING IS LOCKED YET, which `decideDb4Reprint` reads as "nothing
 * to disagree with" rather than as "everything changed".
 *
 * THE PATIENT COMES FROM THE COLUMN and not from `particulars.patientName`,
 * deliberately: a name is a rendering of a person and two people may share
 * one. `patientId` is the identity the chart number resolved to, which is
 * what "is this the same patient" actually asks.
 */
function lockedParticularsOf(agreement: {
  patientId: string;
  particularsLockedAt: Date | null;
  particulars: unknown;
}): Db4Particulars | null {
  if (agreement.particularsLockedAt === null) return null;
  const locked = (agreement.particulars ?? {}) as Record<string, unknown>;
  const items = Array.isArray(locked.mbsItemNumbers)
    ? locked.mbsItemNumbers.filter((n): n is string => typeof n === 'string')
    : [];
  return {
    patientId: agreement.patientId,
    servicingProviderNumber: typeof locked.providerNumber === 'string' ? locked.providerNumber : null,
    serviceDate: typeof locked.serviceDate === 'string' ? locked.serviceDate : null,
    mbsItemNumbers: items,
  };
}

@Injectable()
export class Db4AssignmentHandler {
  private readonly logger = new Logger(Db4AssignmentHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly arrivals: ArrivalsService,
    /*
     * FOR THE SUPERSESSION A CORRECTED FORM CAN CAUSE, and for nothing else.
     * The handler still decides nothing about agreements: it asks
     * `supersedeForCorrectedPrintRecord`, which owns that write for the same
     * reason `serviceRendered` owns the placement.
     */
    private readonly agreements: AgreementsService,
    private readonly capture: CaptureService,
  ) {}

  /**
   * @param printJobId the row this form arrived on. Recorded on the agreement
   * it becomes, so the Signed-DB4 can be rendered from the very record that
   * produced it rather than from a JSON scan of the queue — see
   * `linkToPrintJob` below.
   */
  async handle(practiceId: string, envelope: PrintJobEnvelope, printJobId: string): Promise<Db4JobOutcome> {
    const servicing = (envelope.providers ?? []).find((p) => p.role === 'servicing');
    const payee = (envelope.providers ?? []).find((p) => p.role === 'payee');
    const base = {
      idempotencyKey: null,
      patientMatched: false,
      servicingProviderNumber: servicing?.providerNumber ?? null,
      payeeProviderNumber: payee?.providerNumber ?? null,
      serviceRecordId: null,
      repeat: false,
      decision: null,
      policyVersion: null,
      agreementId: null,
      placed: false,
      refusedStatus: null,
    } satisfies Omit<Db4JobOutcome, 'reason'>;
    const nothing = (reason: Db4PlacementReason): Db4JobOutcome => {
      // The CODE, never the value it came from — no chart number, no Medicare
      // number, no name, no amount in a log line (hard rule 9).
      this.logger.log(`DB4 for practice ${practiceId}: no agreement — ${reason}.`);
      return { ...base, reason };
    };

    /*
     * IDEMPOTENCY IS ON THE FORM, NOT ON THE BYTES. `sourceSha256` identifies
     * the spool, and a reprint of one form spools different bytes because the
     * driver stamps a creation id — so the queue's own sha dedup lets the same
     * form in twice. `db4:<formReference>` becomes the service record's
     * `pmsInvoiceKey`, and `serviceRendered` short-circuits on a row that has
     * already been decided. Two prints, one service record, one agreement.
     */
    const formReference = envelope.form?.formReference?.trim();
    if (!formReference) return nothing('no_form_reference');
    const idempotencyKey = `db4:${formReference}`;

    if (!servicing?.providerNumber) return nothing('no_servicing_provider');

    const patientRecordNumber = envelope.patient?.patientRecordNumber?.trim();
    if (!patientRecordNumber) return nothing('no_chart_number');

    /*
     * D5, from the form first and its service rows second. `serviceRendered`
     * takes one date because an agreement's particulars carry one; a DB4 prints
     * the same date on the form and on every row it lists.
     */
    const serviceDate =
      envelope.form?.serviceDate ?? (envelope.services ?? []).map((s) => s.serviceDate).find((d) => !!d);
    if (!serviceDate) return nothing('no_service_date');

    /*
     * D6b, EVERY ITEM THE FORM LISTED AND NOTHING FILTERED. An item number this
     * platform does not recognise is the rules engine's judgement to make (C7),
     * not a thing to drop quietly on the way past — a dropped item is a
     * particular missing from a contract nobody can see was ever there.
     */
    const mbsItemNumbers = (envelope.services ?? [])
      .map((s) => s.mbsItemNumber?.trim())
      .filter((n): n is string => !!n);
    if (mbsItemNumbers.length === 0) return nothing('no_service_items');

    /*
     * ASKED HERE SO THE ANSWER HAS A CODE. `serviceRendered` refuses an unknown
     * chart number with a 404 that says the fix in words, and a 404 out of it
     * could equally be the provider — two different reasons, one status. The
     * read is the same read on the same key; it buys the job row a reason
     * somebody can act on rather than "not found".
     */
    const patient = await this.prisma.withPractice(practiceId, (tx) =>
      tx.patient.findFirst({ where: { practiceId, patientRecordNumber }, select: { id: true } }),
    );
    if (!patient) return nothing('unknown_chart_number');

    /*
     * EXACTLY THE FIELDS `ServiceRenderedDto` DECLARES. Not a spread of the
     * record, not a cast of it — an assembly, so that what crosses is
     * enumerable and a reader can see there is no Medicare number and no amount
     * among them. `source: 'connector'` because nobody typed this: the form was
     * printed and a service read it, so `receivedByPrincipalId` stays null and
     * the row does not claim a person's hands (`service_records_principal_only_when_typed`).
     */
    const dto: ServiceRenderedDto = {
      pmsPatientRecordNumber: patientRecordNumber,
      providerNumber: servicing.providerNumber,
      serviceDate,
      mbsItemNumbers,
      source: 'connector',
      idempotencyKey,
    };

    try {
      const receipt = await this.arrivals.serviceRendered(practiceId, dto, Object.keys(dto));
      const placed = receipt.decision.outcome === 'episodic_post';
      /*
       * ONLY THE AGREEMENT THIS FORM MADE. `already_covered` also comes back
       * with an agreement id — today's signed pre-agreement, or a live ongoing
       * one — and that agreement did not come from this form. Linking it would
       * put a Signed-DB4 of THIS page onto a contract made for something else,
       * which is the one way this feature could produce a wrong document.
       */
      const reprint =
        placed && receipt.agreementId
          ? await this.linkOrReprocess(practiceId, receipt.agreementId, printJobId, {
              patientId: patient.id,
              servicingProviderNumber: servicing.providerNumber ?? null,
              serviceDate,
              mbsItemNumbers,
            })
          : null;
      return {
        ...base,
        idempotencyKey,
        patientMatched: true,
        serviceRecordId: receipt.serviceRecordId,
        repeat: receipt.repeat,
        decision: receipt.decision.outcome,
        policyVersion: receipt.policyVersion,
        agreementId: receipt.agreementId,
        placed,
        reprint,
        /*
         * COVERED IS AN ANSWER, NOT A FAILURE. Today's signed pre-agreement or a
         * live ongoing agreement already assigns the benefit for this service,
         * and asking again would collect a second consent for one service. The
         * covering agreement is on the service record, which is where the desk
         * reads it.
         */
        reason: placed ? null : 'already_covered',
      };
    } catch (err) {
      /*
       * A FAULT RETRYING COULD FIX IS NOT OURS TO SWALLOW. Anything that is not
       * the platform declining in a 4xx — the database having a moment, the
       * rules service down — goes back to the lane, which backs off and tries
       * again. Swallowing it would mark a form `done` that nothing was done
       * with.
       */
      if (!(err instanceof HttpException) || err.getStatus() >= 500) throw err;

      /*
       * REPORT WHAT ACTUALLY EXISTS — AND LET IT DECIDE WHAT THE REFUSAL WAS.
       *
       * `serviceRendered` runs in phases, and the service record is written and
       * COMMITTED in phase 1, before the draft, the capture request and the
       * lock. So its existence answers the only question the status code cannot:
       * whether the provider had already resolved. A record here means the
       * refusal came LATER — the rules engine declining the particulars at the
       * lock, an open capture request on the channel — and reading it as a
       * provider-records fault would send whoever diagnoses it to the wrong
       * screen, which is the failure CLAUDE.md §7 names.
       *
       * An outcome that said "nothing was created" would also be a row lying
       * about the state of the database, which is worse than the refusal it is
       * describing.
       */
      const record = await this.prisma.withPractice(practiceId, (tx) =>
        tx.serviceRecord.findFirst({
          where: { practiceId, pmsInvoiceKey: idempotencyKey },
          select: { id: true, agreementId: true, visitDecision: true, policyVersion: true },
        }),
      );
      const reason = this.reasonFor(err, record !== null);
      this.logger.log(`DB4 for practice ${practiceId}: no agreement — ${reason} (${err.getStatus()}).`);
      return {
        ...base,
        idempotencyKey,
        patientMatched: true,
        serviceRecordId: record?.id ?? null,
        decision: record?.visitDecision ?? null,
        policyVersion: record?.policyVersion ?? null,
        agreementId: record?.agreementId ?? null,
        placed: false,
        reason,
        refusedStatus: err.getStatus(),
      };
    }
  }

  /**
   * THE LINK FROM THE AGREEMENT BACK TO THE FORM THAT MADE IT.
   *
   * WHY IT IS A COLUMN AND NOT A QUERY. The Signed-DB4 is rendered from the
   * DB4 Print Record — the headings, the patient block, the service rows with
   * their amounts, the privacy notice, the statements — and none of that is in
   * the agreement's particulars, because piece 1 deliberately kept the
   * Medicare card number and the amounts out of them. So the producer has to
   * find the print job, and before this the only routes were
   * `inbound_print_jobs.outcome->'db4'->>'agreementId'`, which is unindexed
   * JSON pointing the wrong way, and a join through the service record's
   * `pmsInvoiceKey` string convention. Neither is a thing to hang a rendered
   * artefact on.
   *
   * FIRST FORM WINS WAS THE RULE UNTIL 28 SEPTEMBER 2026 AND IS NOT ANY MORE.
   * `sourcePrintJobId IS NULL` in the filter made a reprint a no-op — right
   * for a re-spool of the same page, and wrong for a CORRECTION, which is the
   * case Carl asked for: *"I should be able to correct the missing data (as
   * though corrected from the PMS) and reprint to AOBPrinter and resend to AOB
   * for reprocessing."* Under the old filter the agreement kept pointing at
   * the record that could not be read, so the desk went on refusing a form the
   * practice had already fixed.
   *
   * A RE-SPOOL STILL COSTS NOTHING, and not because of this filter: identical
   * bytes are the SAME JOB by `@@unique([practiceId, documentType,
   * sourceSha256])`, so an unchanged reprint never reaches here at all. What
   * reaches here has different content, which is exactly when a decision is
   * worth making. `the_same_form_printed_twice_creates_one_agreement` still
   * holds and is unchanged: one form reference is one service record and one
   * agreement, however many times it is printed.
   *
   * THE RULE IS `decideDb4Reprint`, WHICH HAS NO DATABASE IN IT and carries
   * the whole of the reasoning. This method is the part that touches rows.
   *
   * THE ROW IS LOCKED FIRST, for the reason both supersession paths in
   * `AgreementsService` lock theirs: two corrected prints of one form arriving
   * together must serialise, or one visit ends up with two contracts each
   * claiming to replace the same one. `agreements_one_successor` is the
   * backstop underneath.
   *
   * NO VAULT EVENT FOR A REPOINT, and the reasoning is the one this method
   * always carried: the link becomes EVIDENCE when it is relied upon, which
   * is when `SignedDb4Service` writes `sourcePrintJobId` into the
   * `agreement.rendered` event in the same transaction as the artefact. A
   * SUPERSESSION is different and does write one, because a replaced contract
   * is a fact about the agreement rather than about a pointer —
   * `supersedeForCorrectedPrintRecord` owns that write.
   */
  private async linkOrReprocess(
    practiceId: string,
    agreementId: string,
    printJobId: string,
    arriving: Db4Particulars,
  ): Promise<NonNullable<Db4JobOutcome['reprint']>> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "agreements" WHERE "id" = ${agreementId}::uuid FOR UPDATE`;

      const agreement = await tx.agreement.findFirst({ where: { id: agreementId, practiceId } });
      /*
       * RLS MAKES THIS REACHABLE AND SILENCE IS THE RIGHT ANSWER, the same
       * posture `updateMany` took: a filter that matches nothing must not
       * throw, because a form is not broken because an agreement moved.
       */
      if (!agreement) return { action: 'already_linked' as const, changed: [], supersededBy: null };

      /*
       * THE LIVE ONE, NOT THE REPLACED ONE. Naming a carer supersedes the
       * agreement (`supersedeForAssignorChange`) while the SERVICE RECORD
       * goes on naming the row it created, so the id that arrives here can be
       * a superseded one. Repointing that would move the pointer on a
       * contract nobody can sign and leave the live one still reproducing the
       * broken page — the exact failure this method exists to fix, made
       * invisible. One successor per agreement is a database constraint, so
       * one hop is the whole walk.
       */
      const successor = await tx.agreement.findFirst({
        where: { supersedesAgreementId: agreement.id },
        orderBy: { createdAt: 'asc' },
      });
      const live = successor ?? agreement;

      const decision = decideDb4Reprint({
        linkedPrintJobId: live.sourcePrintJobId,
        arrivingPrintJobId: printJobId,
        signed: live.signatureEventId !== null,
        locked: lockedParticularsOf(live),
        arriving,
      });

      if (decision.action === 'already_linked' || decision.action === 'refused_signed') {
        if (decision.action === 'refused_signed') {
          // THE CODE, NEVER THE VALUE IT CAME FROM (hard rule 9).
          this.logger.log(
            `DB4 for practice ${practiceId}: a corrected form arrived for a SIGNED agreement — not repointed.`,
          );
        }
        return { action: decision.action, changed: [], supersededBy: null };
      }

      if (decision.action === 'supersede') {
        const replacement = await this.agreements.supersedeForCorrectedPrintRecord(
          tx,
          practiceId,
          live,
          decision.changed,
          printJobId,
        );
        /*
         * AND NOTHING MAY STILL BE SIGNED AGAINST THE OLD ONE — the same act
         * both other supersession paths make, on every channel at once. Its
         * own evidence is untouched (hard rule 13); what closes is every door
         * that could still collect a signature on particulars we now know
         * disagree with the practice's own form.
         */
        await this.capture.cancelOpenFor(tx, live.id, 'agreement_superseded');
        await this.capture.openInPractice(tx, practiceId, replacement.id);
        this.logger.log(
          `DB4 for practice ${practiceId}: a corrected form changed ${decision.changed.join(',')} — superseded.`,
        );
        return { action: 'supersede' as const, changed: decision.changed, supersededBy: replacement.id };
      }

      /* `linked` and `repointed` are the same write and a different story. */
      await tx.agreement.update({
        where: { id: live.id },
        data: { sourcePrintJobId: printJobId },
      });
      return { action: decision.action, changed: [], supersededBy: null };
    });
  }

  /**
   * THE PLATFORM'S REFUSAL, AS A CODE THE JOB ROW CAN CARRY.
   *
   * `ArrivalRefusal` already speaks in codes and they are passed through.
   *
   * EVERYTHING ELSE IS DISAMBIGUATED BY THE SERVICE RECORD, NOT BY THE STATUS.
   * A bare 404 and a bare 400 each have several sources inside
   * `serviceRendered` — `findAnchor` not resolving a provider number or finding
   * two, and, further on, `createDraft`, `capture.open` and the rules engine
   * declining the particulars at the lock. The status alone cannot tell them
   * apart, and a mapping that guessed would file a rules-engine refusal as a
   * provider-records fault. The service record is written and committed in
   * phase 1, before any of the later three run, so `serviceRecordExists` is the
   * fact that separates "the provider never resolved" from "it resolved and
   * something later declined" — and the caller records the status beside the
   * code so an unmapped refusal shows its code rather than a shrug.
   */
  private reasonFor(err: HttpException, serviceRecordExists: boolean): Db4PlacementReason {
    if (err instanceof ArrivalRefusal) {
      const known: readonly string[] = ['provider_not_servicing', 'provider_not_anchored'];
      return known.includes(err.reason) ? (err.reason as Db4PlacementReason) : 'refused';
    }
    if (serviceRecordExists) return 'refused_after_service_record';
    if (err.getStatus() === 404) return 'provider_not_found';
    if (err.getStatus() === 400) return 'provider_number_ambiguous';
    return 'refused';
  }
}
