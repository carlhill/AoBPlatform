import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Db4JobOutcome, Db4PlacementReason, PrintJobEnvelope } from '@aobplatform/contracts';
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
@Injectable()
export class Db4AssignmentHandler {
  private readonly logger = new Logger(Db4AssignmentHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly arrivals: ArrivalsService,
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
      if (placed && receipt.agreementId) {
        await this.linkToPrintJob(practiceId, receipt.agreementId, printJobId);
      }
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
   * FIRST FORM WINS, AND THE DATABASE ENFORCES IT. The `sourcePrintJobId IS
   * NULL` in the filter makes a reprint a no-op rather than a re-point: the
   * same form printed twice is one agreement (`the_same_form_printed_twice_
   * creates_one_agreement`), and the record that made it is the first one.
   * `updateMany` rather than `update` because a filter that matches nothing
   * must be silence, not a thrown `P2025`.
   *
   * NO VAULT EVENT HERE, AND THE REASON IS NOT "IT IS ONLY A COLUMN". The
   * link becomes EVIDENCE at the moment it is relied upon, and that is when
   * the Signed-DB4 is produced — `SignedDb4Service` writes `sourcePrintJobId`
   * into the `agreement.rendered` event that records the reproduction, in the
   * same transaction as the artefact row. An event here as well would say
   * twice, in two places, a fact that only ever matters once, and would put a
   * second entry in the chain for a form that may never be signed at all.
   */
  private async linkToPrintJob(practiceId: string, agreementId: string, printJobId: string): Promise<void> {
    await this.prisma.withPractice(practiceId, (tx) =>
      tx.agreement.updateMany({
        where: { id: agreementId, practiceId, sourcePrintJobId: null },
        data: { sourcePrintJobId: printJobId },
      }),
    );
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
