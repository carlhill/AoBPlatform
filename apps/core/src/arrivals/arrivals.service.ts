import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ArrivalReceipt } from '@aobplatform/contracts';
import {
  canOfferEnduring,
  decideVisitAgreement,
  detailTypeForPatientField,
  SERVICE_DESCRIPTIONS_VERSION,
  type ConfirmableDetailType,
  type CorrectablePatientField,
  type ProviderType,
  type VisitAgreementDecision,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { AgreementsService } from '../agreements/agreements.service';
import { CaptureService } from '../capture/capture.service';
import { EnduringService } from '../enduring/enduring.service';
import { ArrivalDto } from './arrivals.dto';

/**
 * THE ARRIVAL IS THE PRACTICE'S SOFTWARE SPEAKING, NOT A PERSON. Nobody at the
 * desk pressed anything; the connector relayed what the PMS said. So the actor
 * is the platform, and the row records `source` to keep a real practice's
 * connector and a dev script from ever looking alike in the evidence.
 */
const SYSTEM_ACTOR = { principalType: 'system', id: 'arrivals' } as const;

/**
 * ANY FIELD NAME WITH "MEDICARE" IN IT IS REFUSED, WHATEVER IT IS FOR — the
 * same fence `PatientsService.correctDetails` puts up, at the only other place
 * a caller can reach with a JSON body no compiler sees (hard rule 1,
 * REQ-VER-02). It matches on the NAME rather than on a list of spellings,
 * because the mistake arrives under a new one every time.
 */
const MEDICARE_FIELD = /medicare/i;

/**
 * AND ANY FIELD THAT TRIES TO DECIDE WHAT THE VISIT NEEDS. `agreementType`,
 * `visitDecision`, `enduring` — refused with the reason, because a connector
 * author who sends one has a mental model that has to be corrected once rather
 * than silently indulged (hard rules 6 and 14).
 */
const DECISION_FIELD = /agreement.?type|visit.?decision|^enduring|pathway/i;

/** The five details an arrival carries, in the mirror's own column names. */
const MIRRORED_FIELDS = [
  'familyName',
  'givenNames',
  'dateOfBirth',
  'address',
  'mobile',
  'email',
] as const satisfies readonly CorrectablePatientField[];

interface DecidedArrival {
  arrivalId: string;
  patientId: string;
  assignorId: string;
  decision: VisitAgreementDecision;
  practiceDefaultD6a: string | null;
  arrivalDate: string;
}

/**
 * "THIS PATIENT HAS JUST ARRIVED AT RECEPTION TO SEE THIS PROVIDER" (Carl,
 * 4 Sep 2026; TODO.md "Reception-centric: the patient work page" §2).
 *
 * WHAT WAS MISSING. Reception's queue was fed by dev staging scripts and by the
 * appointment sweep; nothing told the platform that a person actually walked
 * in. This is the message that does, and we define its SHAPE because D-01 is
 * unresolved — nobody knows yet whether Evolution pushes events or whether the
 * site connector polls the appointment book, and CLAUDE.md §5 forbids guessing
 * a PMS's API. Whatever D-01 turns out to allow, the connector's job becomes
 * "produce this". Nothing in this module names a Medtech endpoint.
 *
 * THE PMS IS THE MASTER OF WHO THE PATIENT IS (REQ-DATA-10), and an arrival is
 * the moment it says so. The five details ride in the message and land on the
 * one mirror row; what stays HERE is which detail TYPES moved, never a value,
 * old or new (REQ-VER-04, REQ-LOG-08).
 *
 * THE PMS IS NOT THE MASTER OF WHAT THE VISIT NEEDS, and that separation is the
 * whole reason this module exists rather than a `POST /agreements` from the
 * connector. Whether today needs a first enduring agreement, an episodic
 * pre-agreement or nothing at all is a rules question — is the provider a GP
 * (hard rule 6, REQ-END-01a), and is there already a live enduring agreement
 * for THIS provider and THIS patient (REQ-END-01; never per practice) — and the
 * versioned table answers it, with its version travelling onto the row (hard
 * rule 14). If the PMS said "enduring" and we obeyed, we would have hardcoded
 * the mapping that versioning exists to prevent, in a system we do not control.
 *
 * IN PHASES, NOT ONE TRANSACTION, and `AutoCaptureService` already learned why
 * the hard way: `AgreementsService.createDraft`, `CaptureService.open` and
 * `lockParticulars` each open their OWN transaction because they own their
 * domain guards, and a row created inside an outer transaction is invisible to
 * them until it commits — the assignor "did not exist" and the draft was
 * refused. So phase 1 does the mirror, the assignor, the arrival row, the
 * decision AND the `arrival.received` event together and commits (hard rule 11:
 * an arrival with no record of having been received is structurally
 * impossible), and the drafting follows.
 *
 * IT NEVER BLOCKS CARE (hard rule 8, REQ-REC-04). Every failure below leaves
 * the patient seen and billable; the worst case is that evidence is slower.
 */
@Injectable()
export class ArrivalsService {
  private readonly logger = new Logger(ArrivalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agreements: AgreementsService,
    private readonly capture: CaptureService,
    private readonly enduring: EnduringService,
  ) {}

  async receive(practiceId: string, dto: ArrivalDto, sentFieldNames: string[]): Promise<ArrivalReceipt> {
    this.assertNothingForbiddenWasSent(sentFieldNames);

    // ---------------------------------------------------------------------
    // PHASE 0 — read what already exists, OUTSIDE any transaction the writes
    // will need. Coverage in particular is `EnduringService`'s answer, and it
    // opens its own transaction; asking it from inside ours would be asking a
    // second connection about rows that have not committed.
    // ---------------------------------------------------------------------
    const existing = await this.prisma.withPractice(practiceId, (tx) =>
      tx.arrival.findFirst({ where: { practiceId, idempotencyKey: dto.idempotencyKey } }),
    );
    if (existing) return this.receiptFor(existing, true);

    const { provider, patient } = await this.prisma.withPractice(practiceId, async (tx) => ({
      provider: await this.findProvider(tx, dto),
      patient: await tx.patient.findFirst({
        where: { practiceId, patientRecordNumber: dto.pmsPatientRecordNumber },
      }),
    }));

    const coverage = patient
      ? await this.enduring.coverage(practiceId, { patientId: patient.id, providerId: provider.id })
      : { covered: false, agreementIds: [] as string[] };

    // ---------------------------------------------------------------------
    // PHASE 1 — the mirror, the assignor, the decision, the row and its event,
    // in ONE transaction; then commit so the services below can see them.
    // ---------------------------------------------------------------------
    const decided = await this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.findFirst({});
      if (!practice) throw new NotFoundException('Practice not found.');

      const mirror = await this.mirrorPatient(tx, practiceId, dto, patient?.id ?? null);
      const assignor = await this.selfAssignorFor(tx, practiceId, dto);

      /*
       * THE DECISION. Four inputs and nothing else can reach it — in
       * particular there is no practice-wide coverage input, which is hard
       * rule 6 made structural rather than remembered.
       */
      const decision = decideVisitAgreement({
        // The SAME predicate the draft guard uses (`assertEnduringAllowed`
        // calls it too), so "is this a GP" cannot come to mean two things.
        providerIsGp: canOfferEnduring(provider.providerType as ProviderType),
        activeEnduringForProviderAndPatient: coverage.covered,
        /*
         * THE PRACTICE'S STANDING SETTING (GA-PLAN B6). Read through a cast
         * because the column landed on `practices` the same afternoon this was
         * written, from another hand: the cast reads it wherever it exists and
         * falls back to the product's intent — enduring by default for a GP
         * practice — anywhere the client has not caught up.
         *
         * WORTH KNOWING AT THE DESK: while this is true, a GP arrival decides
         * `enduring`, and an enduring draft cannot yet be pushed or locked (the
         * s 65C rule set has no enduring path — `blockingReason` returns
         * `enduring_rules_not_authored`). The queue shows the row with that
         * reason until GA-PLAN B5 lands.
         */
        practiceOffersEnduringByDefault:
          (practice as unknown as { enduringByDefault?: boolean | null }).enduringByDefault ?? true,
        /*
         * NOTHING STORES THIS YET. No column, no endpoint, and inventing one
         * from a spare field would be worse than saying so: a patient who has
         * never been asked has not declined. False until a decline is recorded
         * somewhere a person can see and revoke it.
         */
        patientDeclinedEnduring: false,
      });

      const arrivedAt = new Date(dto.arrivedAt);
      const arrival = await tx.arrival.create({
        data: {
          practiceId,
          pmsPatientRecordNumber: dto.pmsPatientRecordNumber,
          patientId: mirror.patientId,
          providerId: provider.id,
          providerNumber: dto.providerNumber ?? null,
          assignorId: assignor.id,
          patientCreated: mirror.created,
          detailsChanged: mirror.changedTypes,
          visitDecision: decision.type,
          decisionReason: decision.reason,
          policyVersion: decision.policyVersion,
          arrivedAt,
          source: dto.source,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      /*
       * THE EVENT, IN THIS TRANSACTION (FR-11.2, hard rule 11). Ids, the
       * decision, the policy version and the detail TYPES that moved — joined
       * into a string because a vault payload holds scalars, and because a
       * list of TYPES is not a list of values. No name, no address, no
       * Medicare number (none is held), no amount (hard rule 4).
       */
      await enqueueVaultEvent(tx, {
        type: 'arrival.received',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Arrival', id: arrival.id },
        payload: {
          practiceId,
          patientId: mirror.patientId,
          providerId: provider.id,
          source: dto.source,
          patientCreated: mirror.created,
          detailTypesChanged: mirror.changedTypes.join(','),
          detailTypesChangedCount: mirror.changedTypes.length,
          visitDecision: decision.type,
          decisionReason: decision.reason,
          policyVersion: decision.policyVersion,
          decidedBy: 'visit_policy',
        },
      });

      return {
        arrivalId: arrival.id,
        patientId: mirror.patientId,
        assignorId: assignor.id,
        decision,
        practiceDefaultD6a: practice.defaultServiceDescription,
        arrivalDate: arrivedAt.toISOString().slice(0, 10),
      } satisfies DecidedArrival;
    });

    if (decided.decision.type === 'none') {
      /*
       * NOTHING IS DRAFTED, AND THAT IS THE ANSWER (REQ-END-01). A live
       * enduring agreement already assigns this provider's services for this
       * patient; asking them to sign again would be collecting a second
       * consent for a service the first one covers.
       *
       * WHAT IS STILL OWED: the queue line that says so — "covered by an
       * ongoing agreement with Dr X, nothing to sign". Both queue reads live
       * in modules this build does not own (`patients`, `tablet-sessions`), so
       * the fact is recorded here and on the event, and the line is a
       * follow-up for the work-page owner rather than a reach across a
       * boundary (CLAUDE.md §4).
       */
      this.logger.log(`Arrival ${decided.arrivalId}: covered by an ongoing agreement — nothing drafted.`);
      return this.receiptFor(await this.reread(practiceId, decided.arrivalId), false);
    }

    // ---------------------------------------------------------------------
    // PHASE 2 — the draft, through the service that owns the guards.
    // ---------------------------------------------------------------------
    const draft = await this.agreements.createDraft(practiceId, {
      type: decided.decision.type,
      enduringPathway: decided.decision.enduringPathway,
      providerId: provider.id,
      patientId: decided.patientId,
      // D7 is explicit and never inferred: the person who arrived is signing
      // for themselves. Somebody else signing is a change made at the desk
      // (`POST /agreements/:id/assignor`), not something a PMS push asserts.
      assignorId: decided.assignorId,
      assignorIsPatient: true,
    });

    // PHASE 3 — link AT ONCE, for the reason the cascade gives: from here a
    // crash leaves an arrival WITH an agreement and the existing resend path,
    // never one that looks untouched and gets a second draft on a retry.
    await this.prisma.withPractice(practiceId, (tx) =>
      tx.arrival.update({ where: { id: decided.arrivalId }, data: { agreementId: draft.id } }),
    );

    // PHASE 4 — the in-practice capture request. THIS is what puts them on
    // reception's queue.
    const opened = await this.capture.open(practiceId, { agreementId: draft.id, channel: 'in_practice' });
    await this.prisma.withPractice(practiceId, (tx) =>
      tx.arrival.update({ where: { id: decided.arrivalId }, data: { captureRequestId: opened.captureRequestId } }),
    );

    // ---------------------------------------------------------------------
    // PHASE 5 — D6a, then the lock. EPISODIC ONLY.
    //
    // An enduring draft stops at the capture request on purpose: D6a is a
    // pre-agreement particular and the s 65C rule set has no enduring path at
    // all (a human-authored zone, CLAUDE.md §7 — see `blockingReason`'s
    // `enduring_rules_not_authored`). Locking one would mean an agent writing
    // regulation. It sits on the queue with that reason until GA-PLAN B5.
    // ---------------------------------------------------------------------
    if (decided.decision.type === 'episodic_pre' && decided.practiceDefaultD6a) {
      await this.prisma.withPractice(practiceId, async (tx) => {
        await tx.agreement.update({
          where: { id: draft.id },
          data: {
            serviceDescription: decided.practiceDefaultD6a,
            // THE PLATFORM DID THIS, and the record says so rather than naming
            // a staff member who was not there — the same distinction the
            // appointment sweep draws.
            serviceDescriptionSetBy: null,
            serviceDescriptionSetAt: new Date(),
          },
        });
        await enqueueVaultEvent(tx, {
          type: 'agreement.service_description_set',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: draft.id },
          payload: {
            serviceDescription: decided.practiceDefaultD6a!,
            serviceDescriptionsVersion: SERVICE_DESCRIPTIONS_VERSION,
            source: 'practice_default',
          },
        });
      });

      await this.agreements.transition(practiceId, draft.id, 'awaiting_signature');
      // `serviceDate` is the day they walked in. D6a is read from the column
      // written above rather than resent, exactly as the staff surface's lock
      // does (REQ-DATA-11: the client supplies only what the server cannot know).
      await this.agreements.lockParticulars(practiceId, draft.id, { serviceDate: decided.arrivalDate });
    }
    /*
     * NO DEFAULT D6a MEANS NO LOCK — AND NO TRANSITION EITHER. The practice has
     * not said which words to write, the platform never guesses a particular of
     * a contract, and an agreement sitting at `awaiting_signature` with
     * unlocked particulars is exactly the shape hard rule 2 (REQ-REG-06)
     * forbids. It stays where the existing "set the D6a on the row" path
     * expects to find it, and the queue already says `service_description_missing`.
     */

    return this.receiptFor(await this.reread(practiceId, decided.arrivalId), false);
  }

  // -------------------------------------------------------------------------

  /** One arrival, for the console and for the tests that read it back. */
  async get(practiceId: string, arrivalId: string): Promise<ArrivalReceipt> {
    return this.receiptFor(await this.reread(practiceId, arrivalId), false);
  }

  // -------------------------------------------------------------------------

  private assertNothingForbiddenWasSent(sentFieldNames: string[]): void {
    const medicare = sentFieldNames.filter((name) => MEDICARE_FIELD.test(name));
    if (medicare.length > 0) {
      throw new BadRequestException(
        'The Medicare card number is not an identity identifier and is never held here — the exclusion ' +
          'is not configurable (hard rule 1, REQ-VER-02). An arrival carries name, date of birth, ' +
          'address, the patient record number and contact details, and nothing else about identity.',
      );
    }
    const decides = sentFieldNames.filter((name) => DECISION_FIELD.test(name));
    if (decides.length > 0) {
      throw new BadRequestException(
        'An arrival does not decide what the visit needs. Whether today needs an enduring agreement, an ' +
          'episodic pre-agreement or nothing at all is decided by the versioned visit policy — is the ' +
          'provider a GP (REQ-END-01a), and is there already a live enduring agreement for this ' +
          'provider and this patient (REQ-END-01) — and the version travels with the record ' +
          '(hard rule 14). Send the arrival; the answer comes back in the response.',
      );
    }
  }

  /**
   * THE PROVIDER, AND AN ARRIVAL MUST NAME ONE. An enduring agreement is per
   * practitioner × patient (hard rule 6), so an arrival with no provider is
   * one the policy cannot decide — refused rather than defaulted to whoever is
   * first in the list, which is how a consent record comes to name the wrong
   * doctor.
   */
  private async findProvider(tx: Prisma.TransactionClient, dto: ArrivalDto) {
    if (!dto.providerId && !dto.providerNumber) {
      throw new BadRequestException(
        'An arrival must name the provider the patient is here to see, by providerId or providerNumber. ' +
          'An enduring agreement is per practitioner and patient, never per practice (REQ-END-01).',
      );
    }
    const provider = dto.providerId
      ? await tx.provider.findFirst({ where: { id: dto.providerId } })
      : await tx.provider.findFirst({ where: { providerNumber: dto.providerNumber, active: true } });
    if (!provider) throw new NotFoundException('That provider was not found in this practice.');
    return provider;
  }

  /**
   * THE MIRROR ROW, BROUGHT UP TO WHAT THE PMS NOW SAYS (REQ-DATA-10).
   *
   * Matched on `(practiceId, patientRecordNumber)` — the practice's own handle
   * — rather than on a name, because two people at one practice share a name
   * more often than anybody designing a schema expects.
   *
   * IT RETURNS TYPES, NOT VALUES. `address`, `mobile` — the same vocabulary the
   * tablet's tick-boxes use — so the arrival row and the vault event can say
   * what moved without saying what it moved to (REQ-VER-04).
   */
  private async mirrorPatient(
    tx: Prisma.TransactionClient,
    practiceId: string,
    dto: ArrivalDto,
    knownPatientId: string | null,
  ): Promise<{ patientId: string; created: boolean; changedTypes: ConfirmableDetailType[] }> {
    const incoming = {
      familyName: dto.familyName,
      givenNames: dto.givenNames,
      dateOfBirth: new Date(dto.dateOfBirth),
      address: dto.address,
      mobile: dto.mobile ?? null,
      email: dto.email ?? null,
    };

    if (!knownPatientId) {
      const created = await tx.patient.create({
        data: { practiceId, ...incoming, patientRecordNumber: dto.pmsPatientRecordNumber },
      });
      return { patientId: created.id, created: true, changedTypes: [] };
    }

    const current = await tx.patient.findFirst({ where: { id: knownPatientId } });
    if (!current) throw new NotFoundException('That patient was not found.');

    const changed: CorrectablePatientField[] = [];
    for (const field of MIRRORED_FIELDS) {
      const before = field === 'dateOfBirth' ? current.dateOfBirth.toISOString().slice(0, 10) : current[field];
      const after = field === 'dateOfBirth' ? dto.dateOfBirth : (incoming[field] as string | null);
      if ((before ?? null) !== (after ?? null)) changed.push(field);
    }
    if (changed.length > 0) {
      await tx.patient.update({ where: { id: current.id }, data: incoming });
    }

    // De-duplicated: `givenNames` and `familyName` both answer the one
    // tick-box the patient would have crossed.
    const changedTypes = [...new Set(changed.map((field) => detailTypeForPatientField(field)))];
    return { patientId: current.id, created: false, changedTypes };
  }

  /**
   * THE PATIENT AS THEIR OWN ASSIGNOR — the same shape the cascade and the
   * staging script both produce. `Assignor` has no link to `Patient` (an
   * assignor is often NOT the patient, D7), so "the same person" is name plus
   * date of birth plus `authorityBasis: 'self'` within the practice.
   */
  private async selfAssignorFor(tx: Prisma.TransactionClient, practiceId: string, dto: ArrivalDto) {
    const name = `${dto.givenNames} ${dto.familyName}`;
    const dateOfBirth = new Date(dto.dateOfBirth);
    const existing = await tx.assignor.findFirst({
      where: { practiceId, authorityBasis: 'self', name, dateOfBirth },
    });
    if (existing) return existing;
    return tx.assignor.create({ data: { practiceId, name, dateOfBirth, authorityBasis: 'self' } });
  }

  private async reread(practiceId: string, arrivalId: string) {
    const row = await this.prisma.withPractice(practiceId, (tx) =>
      tx.arrival.findFirst({ where: { id: arrivalId } }),
    );
    if (!row) throw new NotFoundException('That arrival was not found.');
    return row;
  }

  private receiptFor(row: Awaited<ReturnType<ArrivalsService['reread']>>, repeat: boolean): ArrivalReceipt {
    return {
      arrivalId: row.id,
      patientId: row.patientId ?? '',
      decision: {
        type: (row.visitDecision ?? 'none') as ArrivalReceipt['decision']['type'],
        reason: row.decisionReason ?? '',
      },
      agreementId: row.agreementId,
      policyVersion: row.policyVersion ?? '',
      repeat,
    };
  }
}
