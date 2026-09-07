import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ArrivalPreview,
  ArrivalProviderChoice,
  ArrivalReceipt,
  RefusedArrival,
} from '@aobplatform/contracts';
import { ARRIVAL_SOURCE_TYPED_BY_A_PERSON } from '@aobplatform/contracts';
import {
  BILLING_ROLES_VERSION,
  buildAssignorForAnother,
  decideVisitAgreement,
  detailTypeForPatientField,
  HardRuleViolation,
  mayBeProviderOnAgreement,
  providerIsGpFor,
  SERVICE_DESCRIPTIONS_VERSION,
  type ConfirmableDetailType,
  type CorrectablePatientField,
  type VisitAgreementDecision,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { AgreementsService } from '../agreements/agreements.service';
import { CaptureService } from '../capture/capture.service';
import { EnduringService } from '../enduring/enduring.service';
import {
  anchorForAffiliation,
  anchorForLegacyProvider,
  anchorsForAffiliations,
  anchorsForAgreements,
  type AgreementAnchor,
} from '../affiliations/agreement-anchor';
import type { Actor } from '../auth/actor.decorator';
import { ArrivalDto, ArrivalPreviewDto } from './arrivals.dto';

/**
 * THE ARRIVAL IS THE PRACTICE'S SOFTWARE SPEAKING, NOT A PERSON. Nobody at the
 * desk pressed anything; the connector relayed what the PMS said. So the actor
 * is the platform, and the row records `source` to keep a real practice's
 * connector and a dev script from ever looking alike in the evidence.
 */
const SYSTEM_ACTOR = { principalType: 'system', id: 'arrivals' } as const;

/**
 * EXCEPT WHEN A PERSON TYPED IT (W2, Carl 7 Sep 2026).
 *
 * A `reception` arrival is the one kind somebody's hands actually made, and
 * the evidence should not say "the platform did this" about an act a named
 * staff member performed. The subject of the token the realm signed, never a
 * name from a form (`SessionActor`'s own docstring: a name in a body is an
 * assertion, an id in a token is a claim somebody signed).
 */
function actorFor(actor: Actor | undefined): { principalType: string; id: string } {
  return actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR;
}

/**
 * THE ARRIVAL NAMED SOMEBODY WHO CANNOT BE THE PROVIDER ON AN AGREEMENT
 * (Carl's ruling, 5–7 Sep 2026).
 *
 * 422 rather than 400: the message is well-formed and the platform understood
 * it perfectly. What it cannot do is act on it, because the person it names
 * does not bill under their own number — the claim, and therefore the
 * assignment, goes under somebody else's. A 400 would tell a connector author
 * to check their JSON, which is the wrong hunt.
 *
 * SHAPED LIKE `PushRefusal` — a reason CODE plus an honest fallback sentence —
 * because the console maps the code to its own words and to a destination
 * (Carl, 4 Sep 2026: shortcuts to the answer, not directions to a screen).
 * Here the destination is `/practice/patients`, where the arrival is waiting
 * with a provider picker on it.
 */
export class ArrivalRefusal extends HttpException {
  constructor(
    readonly reason: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super({ statusCode: 422, message, reason, ...extra }, 422);
  }
}

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

/**
 * THE AFFILIATION AN ARRIVAL RESOLVED TO, plus the legacy `providers` row it
 * came in by where the deprecated `providerId` field was used. Both, while
 * both exist: the anchor is what the agreement is made on, and the legacy id
 * is what the refusal list shows a receptionist who is looking at a name their
 * own software sent.
 */
type ArrivalAnchor = AgreementAnchor & { readonly legacyProviderId: string | null };

/** Live first: a role recorded against a finished affiliation is history. */
const LIVE_AFFILIATION_STATUSES = ['active', 'ending', 'invited'];

interface DecidedArrival {
  arrivalId: string;
  patientId: string;
  assignorId: string;
  /** The anchor the draft is made on — the practitioner at this location. */
  affiliationId: string;
  decision: VisitAgreementDecision;
  practiceDefaultD6a: string | null;
  /** D5 — the day named by a person, else the calendar day they arrived. */
  serviceDate: string;
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

  async receive(
    practiceId: string,
    dto: ArrivalDto,
    sentFieldNames: string[],
    /**
     * WHOSE HANDS TYPED IT — present only for a `reception` arrival, absent
     * for every machine push, and the absence is a fact rather than a gap
     * (see `actorFor`). The service never READS this to decide anything; it
     * records it. Authorisation is `@PracticeScoped` and RLS, as it was.
     */
    actor?: Actor,
  ): Promise<ArrivalReceipt> {
    this.assertNothingForbiddenWasSent(sentFieldNames, dto.source);

    // ---------------------------------------------------------------------
    // PHASE 0 — read what already exists, OUTSIDE any transaction the writes
    // will need. Coverage in particular is `EnduringService`'s answer, and it
    // opens its own transaction; asking it from inside ours would be asking a
    // second connection about rows that have not committed.
    // ---------------------------------------------------------------------
    const existing = await this.prisma.withPractice(practiceId, (tx) =>
      tx.arrival.findFirst({ where: { practiceId, idempotencyKey: dto.idempotencyKey } }),
    );
    /*
     * A RETRY OF A REFUSAL IS NOT A REPEAT — IT IS THE FIX (Carl, 5–7 Sep 2026).
     *
     * A refused arrival produced nothing: no mirror change, no assignor, no
     * draft, no queue row. Reception's answer to it is the SAME walk-in with a
     * servicing provider named, and it comes back under the same idempotency
     * key deliberately, so the retry supersedes the refusal instead of putting
     * one person on the queue twice. So a refused row falls through to be
     * decided again, and only a row that was actually acted on short-circuits.
     */
    if (existing && existing.outcome !== 'refused') return this.receiptFor(existing, true);

    const { anchor, patient } = await this.prisma.withPractice(practiceId, async (tx) => ({
      anchor: await this.findAnchor(tx, practiceId, dto),
      patient: await tx.patient.findFirst({
        where: { practiceId, patientRecordNumber: dto.pmsPatientRecordNumber },
      }),
    }));

    /*
     * WHOSE NUMBER DOES THE CLAIM GO UNDER — asked before anything is written
     * (Carl's ruling, 5–7 Sep 2026). The provider on an assignment of benefit
     * is the servicing provider, never (of itself) the person who delivered
     * the service, and an arrival naming a nurse is refused so that reception
     * picks the provider the claim will go under. The role is now read off the
     * affiliation the arrival resolved to, which is where it lives — the
     * three-key guesswork the previous build needed went with the anchor.
     */
    if (!mayBeProviderOnAgreement(anchor.billingRole)) {
      await this.recordRefusal(practiceId, dto, anchor, patient?.id ?? null, actor, existing?.id);
      throw new ArrivalRefusal(
        'provider_not_servicing',
        `${anchor.name} is recorded as "${anchor.billingRole}" at this practice and cannot be the provider ` +
          'on an agreement — the claim goes under somebody else’s provider number. Pick the provider the ' +
          'claim will go under.',
        { providerId: anchor.legacyProviderId, affiliationId: anchor.affiliationId, billingRole: anchor.billingRole },
      );
    }

    /*
     * AND AN ARRIVAL CANNOT ANCHOR AN AGREEMENT ON A ROW THAT NAMES NO PERSON.
     * Only the deprecated `providerId` path can reach here: a `providers` row
     * that matched no affiliation. The agreement it would produce could not
     * state who signed for whom or where (s 65C(5)(a)), so reception is asked
     * for the practitioner — the same fix, on the same screen, as a refused
     * nurse.
     */
    if (!anchor.affiliationId) {
      await this.recordRefusal(
        practiceId,
        dto,
        anchor,
        patient?.id ?? null,
        actor,
        existing?.id,
        'provider_not_anchored',
      );
      throw new ArrivalRefusal(
        'provider_not_anchored',
        `${anchor.name} is not linked to a practitioner at one of this practice’s locations, so an ` +
          'agreement naming them could not say who signed for whom or where. Pick the practitioner the ' +
          'claim will go under.',
        { providerId: anchor.legacyProviderId },
      );
    }

    /*
     * AND IF SOMEBODY ELSE IS SIGNING, THEY ARE CHECKED BEFORE A ROW MOVES
     * (hard rule 10; W2, Carl 7 Sep 2026).
     *
     * THE SAME DOMAIN FUNCTION `changeAssignor` WILL RUN — imported, not
     * reimplemented, because a second copy of "who may be an assignor" is a
     * second chance to disagree with the first. It hard-blocks practice staff
     * against the practice's own staff list (REQ-VUL-04, fail closed), refuses
     * a party who has not declared they are of full age (REQ-AGE-01), refuses
     * a basis outside REQ-VUL-01's fixed list, refuses `other` without its
     * note, and refuses a party with no usable contact channel (REQ-REG-08).
     *
     * HERE, BEFORE ANYTHING IS WRITTEN, for the same reason the servicing-
     * provider guard is: a refusal should leave the desk able to fix the one
     * field and send again, not leave a half-made walk-in behind it. Nothing
     * is stored by this call — it builds a party in memory and throws if the
     * party is not one this regime allows. The assignor ROW is created later,
     * by `changeAssignor` itself, between the capture request and the lock.
     *
     * IT NEVER ASKS ABOUT CAPACITY, and there is no parameter for it
     * (REQ-VUL-05). The absence is the requirement.
     */
    if (dto.assignor) {
      const staffNames = await this.prisma.withPractice(practiceId, async (tx) =>
        (await tx.staffMember.findMany({ select: { name: true } })).map((s) => s.name),
      );
      try {
        buildAssignorForAnother({
          name: dto.assignor.name,
          authorityBasis: dto.assignor.authorityBasis,
          note: dto.assignor.note,
          declaresEighteenOrOver: dto.assignor.declaresEighteenOrOver,
          mobile: dto.assignor.mobile,
          email: dto.assignor.email,
          practiceStaffNames: staffNames,
        });
      } catch (err) {
        // The rule's own words, naming the requirement and never the name that
        // was typed — the same mapping `changeAssignor` makes.
        if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
        throw err;
      }
    }

    const coverage = patient
      ? await this.enduring.coverage(practiceId, {
          patientId: patient.id,
          /*
           * THE PERSON, NOT THE ROW. A GP at two of this practice's locations
           * is ONE practitioner, so an enduring agreement made at the Main
           * Street site covers the same patient seeing them at After Hours —
           * `enduring_coverage_is_per_practitioner_across_locations`.
           */
          practitionerId: anchor.practitionerId ?? undefined,
        })
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
        /*
         * BOTH HALVES, AND NEITHER IMPLIES THE OTHER (Carl, 5–7 Sep 2026). A
         * nurse practitioner is a servicing provider and is NOT a GP, so no
         * enduring agreement (hard rule 6, REQ-END-01a); and a GP recorded as
         * working under another provider at this location cannot be the
         * provider on any agreement here, so the question never arises. One
         * predicate in the domain rather than two conditions here, because
         * there are three call sites and the second half was missing from all
         * of them.
         */
        providerIsGp: providerIsGpFor({
          billingRole: anchor.billingRole,
          providerType: anchor.providerType,
        }),
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
      /*
       * UPSERT, BECAUSE A REFUSED ARRIVAL IS ALREADY HERE. Reception's fix
       * comes back under the same idempotency key so that the retry supersedes
       * the refusal rather than creating a second walk-in; the refusal's own
       * fields are cleared, and the held payload with them — the patient row
       * IS the record from here (REQ-DATA-10), and a second copy of the same
       * details in a JSON column is data with no reason to exist.
       */
      const accepted = {
        patientId: mirror.patientId,
        affiliationId: anchor.affiliationId,
        providerId: anchor.legacyProviderId,
        providerNumber: dto.providerNumber ?? null,
        assignorId: assignor.id,
        patientCreated: mirror.created,
        detailsChanged: mirror.changedTypes,
        visitDecision: decision.type,
        decisionReason: decision.reason,
        policyVersion: decision.policyVersion,
        arrivedAt,
        source: dto.source,
        /*
         * WHOSE HANDS TYPED IT, when a person's did — and NULL when nobody's
         * did, which the database insists on
         * (`arrivals_principal_only_when_typed`). A connector push naming a
         * staff member would be a record asserting that somebody at the desk
         * vouched for a message nobody read.
         */
        receivedByPrincipalId:
          dto.source === ARRIVAL_SOURCE_TYPED_BY_A_PERSON ? (actor?.id ?? null) : null,
        outcome: 'received',
        refusedReason: null,
        refusedPayload: Prisma.DbNull,
      };
      const arrival = await tx.arrival.upsert({
        where: { practiceId_idempotencyKey: { practiceId, idempotencyKey: dto.idempotencyKey } },
        update: accepted,
        create: {
          practiceId,
          pmsPatientRecordNumber: dto.pmsPatientRecordNumber,
          idempotencyKey: dto.idempotencyKey,
          ...accepted,
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
        /*
         * THE PLATFORM FOR A MACHINE PUSH, THE NAMED STAFF MEMBER FOR A TYPED
         * ONE (W2). An event that said "the platform did this" about an act a
         * receptionist performed would be evidence with the witness removed.
         */
        actor: actorFor(actor),
        subject: { type: 'Arrival', id: arrival.id },
        payload: {
          practiceId,
          patientId: mirror.patientId,
          /*
           * THE PRACTITIONER AND THE PLACE, by id (Carl, 7 Sep 2026). The
           * affiliation is the anchor; the practitioner id is on the event
           * beside it because "was this patient already covered for this
           * PERSON" is the question REQ-END-01 asks, and an event that only
           * named the location edge could not answer it without a join into a
           * table the vault does not hold.
           */
          affiliationId: anchor.affiliationId ?? '',
          practitionerId: anchor.practitionerId ?? '',
          locationId: anchor.locationId ?? '',
          legacyProviderId: anchor.legacyProviderId ?? '',
          source: dto.source,
          patientCreated: mirror.created,
          detailTypesChanged: mirror.changedTypes.join(','),
          detailTypesChangedCount: mirror.changedTypes.length,
          visitDecision: decision.type,
          decisionReason: decision.reason,
          policyVersion: decision.policyVersion,
          decidedBy: 'visit_policy',
          /*
           * WHOSE NUMBER THE CLAIM GOES UNDER, and which list said so. Hard
           * rule 14: the role is versioned content, and an agreement made
           * under it should be answerable in 2028 without guessing which
           * version of the list was live.
           */
          billingRole: anchor.billingRole,
          billingRolesVersion: BILLING_ROLES_VERSION,
          billingRoleResolved: anchor.billingRoleRecorded,
          /*
           * WHO SENT IT, BY ID (W2). An id from a signed token, never a name
           * — the same rule every other payload in this file follows
           * (REQ-LOG-08). Empty string for a machine push, because the vault
           * payload holds scalars and "nobody typed this" is the true answer.
           */
          receivedBy: actor?.id ?? '',
          receivedByType: actor?.principalType ?? 'system',
          /* D7 as it will stand on the draft, before anything is drafted. */
          assignorIsPatient: dto.assignor === undefined,
        },
      });

      return {
        arrivalId: arrival.id,
        patientId: mirror.patientId,
        assignorId: assignor.id,
        affiliationId: anchor.affiliationId!,
        decision,
        practiceDefaultD6a: practice.defaultServiceDescription,
        /*
         * D5 — THE DAY THE SERVICE IS FOR.
         *
         * `serviceDate` when a person named one (they may be typing up
         * yesterday's walk-in after the system came back), otherwise the
         * calendar day of `arrivedAt` exactly as it always was. The explicit
         * date is why the reception form sends one at all: this line takes the
         * UTC calendar day, and 9 a.m. in Sydney is the previous day in UTC.
         */
        serviceDate: dto.serviceDate ?? arrivedAt.toISOString().slice(0, 10),
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
      affiliationId: decided.affiliationId,
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

    /*
     * PHASE 4b — SOMEBODY ELSE IS SIGNING, SAID AT THE DESK (D7, hard rule 10;
     * W2, Carl 7 Sep 2026). `reception` only — the DTO fence above refuses it
     * from anything else.
     *
     * AFTER THE LOCK IS TOO LATE, AND BEFORE THE QUEUE ROW IS TOO EARLY.
     *
     * Too late, because who signs is one of the LOCKED PARTICULARS
     * (REQ-REG-06, hard rule 2): nothing edits it once phase 5 has locked
     * them — a correction supersedes, it does not edit (HARD-02). Posting the
     * arrival and then re-pointing it still works (7 Sep 2026: after the lock,
     * `POST /agreements/:id/assignor` supersedes rather than refusing), but it
     * would spend a whole agreement — a second validate, a second render, a
     * second row in the evidence — on a fact reception already knew when they
     * typed the arrival. Said here, it is simply what the first agreement
     * says.
     *
     * Too early, because the platform never blocks care (hard rule 8,
     * REQ-REC-04). Placed before phase 4, a party the rules engine's C8 check
     * refused would leave a draft with no capture request and nobody on
     * reception's queue. Here, the patient is already on the queue with
     * themselves as assignor before this runs, so the worst case is a refusal
     * the desk fixes on a row that exists — and the particulars are still
     * unlocked, so who signs can still be changed there.
     *
     * THE HARD-RULE-10 REFUSALS THEMSELVES HAPPEN EARLIER STILL, in phase 0,
     * over the same `buildAssignorForAnother` — so a staff member or an
     * undeclared party is refused before a single row moves.
     *
     * THROUGH THE SERVICE THAT OWNS THE GUARDS, and not one line of hard rule
     * 10 lives in this module: `changeAssignor` runs
     * `buildAssignorForAnother`, which hard-blocks practice staff against the
     * practice's own staff list (REQ-VUL-04, fail closed), refuses a party who
     * has not declared they are of full age (REQ-AGE-01), refuses a basis
     * outside the fixed list, refuses `other` with no note, and refuses a
     * party with no usable contact channel (REQ-REG-08). It writes its own
     * `agreement.assignor_changed` event in its own transaction.
     */
    if (dto.assignor) {
      await this.agreements.changeAssignor(
        practiceId,
        draft.id,
        {
          assignorIsPatient: false,
          name: dto.assignor.name,
          authorityBasis: dto.assignor.authorityBasis,
          note: dto.assignor.note,
          declaresEighteenOrOver: dto.assignor.declaresEighteenOrOver,
          relationship: dto.assignor.relationship,
          relationshipsVersion: dto.assignor.relationshipsVersion,
          mobile: dto.assignor.mobile,
          email: dto.assignor.email,
        },
        // The receptionist, not the platform — the same reasoning `actorFor`
        // gives for `arrival.received`, applied to the event that records who
        // the party to the contract is.
        actor,
      );
    }


    // ---------------------------------------------------------------------
    // PHASE 5 — D6a, then the lock. EPISODIC ONLY.
    //
    // An enduring draft stops at the capture request on purpose: D6a is a
    // pre-agreement particular and the s 65C rule set has no enduring path at
    // all (a human-authored zone, CLAUDE.md §7 — see `blockingReason`'s
    // `enduring_rules_not_authored`). Locking one would mean an agent writing
    // regulation. It sits on the queue with that reason until GA-PLAN B5.
    // ---------------------------------------------------------------------
    /*
     * D6a — THE PRACTICE'S DEFAULT, OR THE ONE A PERSON CHOSE INSTEAD (W2).
     *
     * `dto.serviceDescription` is `reception` only and is `@IsIn` the
     * versioned list, so it is never typed prose and never a description the
     * rules engine's C6 check would then refuse (hard rule 14). Where reception
     * chose nothing, this is exactly the connector's path: the practice's own
     * default, and no lock at all if the practice has not set one.
     */
    const chosenD6a = dto.serviceDescription ?? decided.practiceDefaultD6a;

    if (decided.decision.type === 'episodic_pre' && chosenD6a) {
      const chosenByAPerson = dto.serviceDescription !== undefined;
      await this.prisma.withPractice(practiceId, async (tx) => {
        await tx.agreement.update({
          where: { id: draft.id },
          data: {
            serviceDescription: chosenD6a,
            /*
             * WHO CHOSE THE WORDS. Null where the PLATFORM did — the practice
             * default applied to a machine push — rather than naming a staff
             * member who was not there, the same distinction the appointment
             * sweep draws. The named staff member where one actually picked
             * from the list on the reception form.
             */
            serviceDescriptionSetBy: chosenByAPerson ? (actor?.id ?? null) : null,
            serviceDescriptionSetAt: new Date(),
          },
        });
        await enqueueVaultEvent(tx, {
          type: 'agreement.service_description_set',
          actor: chosenByAPerson ? actorFor(actor) : SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: draft.id },
          payload: {
            serviceDescription: chosenD6a,
            serviceDescriptionsVersion: SERVICE_DESCRIPTIONS_VERSION,
            source: chosenByAPerson ? 'reception' : 'practice_default',
          },
        });
      });

      await this.agreements.transition(practiceId, draft.id, 'awaiting_signature');
      // D5 is the day a person named, else the day they walked in. D6a is read
      // from the column written above rather than resent, exactly as the staff
      // surface's lock does (REQ-DATA-11: the client supplies only what the
      // server cannot know).
      await this.agreements.lockParticulars(practiceId, draft.id, { serviceDate: decided.serviceDate });
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

  /**
   * "WHAT WOULD THIS VISIT NEED?" — THE SAME ANSWER, WITHOUT THE ARRIVAL
   * (Carl, 7 Sep 2026; PMS_to_AoB_Workflow.md W2 item 5).
   *
   * WHY RECEPTION MAY NOT SIMPLY BE ASKED. What a visit needs — a first
   * ongoing agreement, an agreement for today's service, or nothing because
   * one already covers this practitioner — is decided by the versioned visit
   * policy and never by the sender (hard rules 6 and 14). That holds whether
   * the sender is a connector or a receptionist: the whole defence against
   * regulatory whipsaw is that the rule lives in one versioned place. So the
   * form does not offer a choice; it shows the answer, live, before Submit.
   *
   * IT IS THE SAME CODE, NOT A SECOND COPY. The same `findAnchor`, the same
   * `mayBeProviderOnAgreement` guard, the same `EnduringService.coverage` read
   * — asked about the PERSON, so a GP working at two of the practice's sites
   * is one practitioner (REQ-END-01) — and the same `decideVisitAgreement`
   * over the same four inputs. A preview that could disagree with the pipeline
   * would be worse than no preview at all.
   *
   * IT WRITES NOTHING AND EMITS NOTHING. No mirror row, no assignor, no
   * arrival, no vault event, no idempotency key. A receptionist changing a
   * dropdown three times must not put a patient on a queue.
   *
   * WHAT IT REFUSES, IT REFUSES AS A VALUE. A nurse or an unanchored provider
   * comes back as `blocked` with the pipeline's own reason CODE rather than as
   * a 422, because on this screen it is not an error — it is the answer to a
   * question that was legitimately asked, and the console maps the code to its
   * own words and a destination (CLAUDE.md §7).
   *
   * A PATIENT THE PRACTICE HAS NEVER SEEN IS NOT AN ERROR EITHER: `coverage`
   * is simply false, which is the truth about somebody with no record here.
   */
  async preview(practiceId: string, dto: ArrivalPreviewDto): Promise<ArrivalPreview> {
    const { anchor, patient, practice } = await this.prisma.withPractice(practiceId, async (tx) => ({
      anchor: await this.findAnchor(tx, practiceId, dto),
      patient: await tx.patient.findFirst({
        where: { practiceId, patientRecordNumber: dto.pmsPatientRecordNumber },
        select: { id: true },
      }),
      practice: await tx.practice.findFirst({}),
    }));
    if (!practice) throw new NotFoundException('Practice not found.');

    const locationLabel = await this.prisma.withPractice(practiceId, async (tx) =>
      anchor.locationId ? ((await this.locationLabels(tx, [anchor])).get(anchor.locationId) ?? null) : null,
    );

    // The two refusals the pipeline would make, said as answers rather than
    // as errors. Both leave `decision` null: nothing could be decided, and the
    // reason is why.
    if (!mayBeProviderOnAgreement(anchor.billingRole) || !anchor.affiliationId) {
      return {
        decision: null,
        policyVersion: '',
        providerName: anchor.name,
        locationLabel,
        coveringAgreementId: null,
        blocked: {
          reason: anchor.affiliationId ? 'provider_not_servicing' : 'provider_not_anchored',
          billingRole: anchor.billingRoleRecorded ? anchor.billingRole : null,
        },
      };
    }

    const coverage = patient
      ? await this.enduring.coverage(practiceId, {
          patientId: patient.id,
          // THE PERSON, NOT THE ROW — the same read the pipeline makes, for
          // the same reason (hard rule 6, REQ-END-01).
          practitionerId: anchor.practitionerId ?? undefined,
        })
      : { covered: false, agreementIds: [] as string[] };

    const decision = decideVisitAgreement({
      providerIsGp: providerIsGpFor({ billingRole: anchor.billingRole, providerType: anchor.providerType }),
      activeEnduringForProviderAndPatient: coverage.covered,
      practiceOffersEnduringByDefault:
        (practice as unknown as { enduringByDefault?: boolean | null }).enduringByDefault ?? true,
      // Nothing stores a decline yet — the pipeline says the same, in the same
      // words, and both will change in one place when something does.
      patientDeclinedEnduring: false,
    });

    return {
      decision: { type: decision.type, reason: decision.reason },
      policyVersion: decision.policyVersion,
      providerName: anchor.name,
      locationLabel,
      /*
       * WHICH AGREEMENT SAYS "NOTHING TO SIGN", so the line can LINK to it
       * rather than assert it (CLAUDE.md §7: shortcuts to the answer). Only
       * where coverage is what decided; null otherwise.
       */
      coveringAgreementId: decision.type === 'none' ? (coverage.agreementIds[0] ?? null) : null,
      blocked: null,
    };
  }

  // -------------------------------------------------------------------------
  // The billing role — refusing, listing, and fixing
  // -------------------------------------------------------------------------

  /**
   * THE REFUSAL, WRITTEN DOWN (Carl's ruling, 5–7 Sep 2026).
   *
   * NOTHING ABOUT THE PATIENT MOVES. No mirror row is created or updated, no
   * assignor, no decision, no draft, nothing on reception's queue — the
   * arrival named somebody who cannot be the provider, so none of it would be
   * right. `patientId` is filled in only when the practice ALREADY had a
   * record of this person, and that is a read, not a change: it is what lets
   * the desk see a name rather than a record number.
   *
   * THE PMS'S OWN MESSAGE IS HELD, and only until this is fixed. Reception's
   * answer is one click — choose the provider the claim goes under — and the
   * platform replays the arrival it already has rather than asking the
   * practice's software to send it again. The column is cleared the moment the
   * arrival is accepted, and the database refuses to hold it otherwise
   * (`arrivals_payload_held_only_while_refused`).
   *
   * THE EVENT AND THE ROW COMMIT TOGETHER (hard rule 11, FR-11.2), so a
   * refusal with no record of having happened is structurally impossible.
   */
  private async recordRefusal(
    practiceId: string,
    dto: ArrivalDto,
    anchor: ArrivalAnchor,
    patientId: string | null,
    /** Whose hands typed it, where a person's did. Null for every machine push. */
    actor: Actor | undefined,
    existingArrivalId?: string,
    reason: 'provider_not_servicing' | 'provider_not_anchored' = 'provider_not_servicing',
  ): Promise<void> {
    await this.prisma.withPractice(practiceId, async (tx) => {
      const refused = {
        patientId,
        /*
         * THE ANCHOR IS RECORDED EVEN ON A REFUSAL, where there was one. A
         * nurse practitioner refused for their billing role IS a practitioner
         * at a location, and the row saying which one is what lets the desk
         * see who was named. `provider_not_anchored` is the case where there
         * is none, and that is the whole reason it was refused.
         */
        affiliationId: anchor.affiliationId,
        providerId: anchor.legacyProviderId,
        providerNumber: dto.providerNumber ?? null,
        arrivedAt: new Date(dto.arrivedAt),
        source: dto.source,
        /*
         * A REFUSED TYPED ARRIVAL STILL NAMES WHO TYPED IT. "The desk sent us
         * somebody who cannot be the provider" is a fact about an onboarding
         * and it has a witness; a machine push does not, and the column stays
         * null (`arrivals_principal_only_when_typed`).
         */
        receivedByPrincipalId:
          dto.source === ARRIVAL_SOURCE_TYPED_BY_A_PERSON ? (actor?.id ?? null) : null,
        outcome: 'refused',
        refusedReason: reason,
        refusedPayload: dto as unknown as Prisma.InputJsonValue,
      };
      const arrival = await tx.arrival.upsert({
        where: { practiceId_idempotencyKey: { practiceId, idempotencyKey: dto.idempotencyKey } },
        update: refused,
        create: {
          practiceId,
          pmsPatientRecordNumber: dto.pmsPatientRecordNumber,
          idempotencyKey: dto.idempotencyKey,
          ...refused,
        },
      });

      /*
       * IDS, A REASON CODE AND A ROLE. No name, no date of birth, no address,
       * no provider number, no amount (REQ-LOG-08, hard rules 1 and 4). The
       * content version is here because the list of roles is versioned content
       * and "which list said so" is the question hard rule 14 exists to answer.
       */
      await enqueueVaultEvent(tx, {
        type: 'arrival.refused',
        actor: actorFor(actor),
        subject: { type: 'Arrival', id: arrival.id },
        payload: {
          practiceId,
          affiliationId: anchor.affiliationId ?? '',
          practitionerId: anchor.practitionerId ?? '',
          legacyProviderId: anchor.legacyProviderId ?? '',
          reason,
          billingRole: anchor.billingRole,
          billingRolesVersion: BILLING_ROLES_VERSION,
          source: dto.source,
          patientKnown: patientId !== null,
          replacedRefusal: existingArrivalId !== undefined,
        },
      });
    });

    this.logger.log(
      `Arrival refused for practice ${practiceId} (${reason}): ` +
        `${anchor.affiliationId ?? anchor.legacyProviderId ?? 'unknown'} is "${anchor.billingRole}" here. ` +
        'Waiting on reception to name the provider the claim goes under.',
    );
  }

  /**
   * THE DESK'S "NEEDS A PROVIDER" LIST.
   *
   * WHY IT IS NOT ON THE PUSHABLE QUEUE. A refused arrival has no agreement,
   * so there is nothing to push and no work page to open — the queue reads
   * agreements and this has none. Leaving it only in a 422 nobody sees would
   * mean the patient is at the desk, the connector has been refused, and no
   * screen in the practice says so. That is exactly the "generic fallback
   * message is a defect" case (Carl, 4 Sep 2026): the reason travels, and it
   * lands on the item where it is fixed.
   */
  async needingAProvider(practiceId: string): Promise<RefusedArrival[]> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.arrival.findMany({
        where: { practiceId, outcome: 'refused' },
        orderBy: { arrivedAt: 'desc' },
        take: 50,
      });
      if (rows.length === 0) return [];

      const patientIds = [...new Set(rows.map((r) => r.patientId).filter((id): id is string => id !== null))];
      const patients = patientIds.length
        ? await tx.patient.findMany({
            where: { id: { in: patientIds } },
            select: { id: true, familyName: true, givenNames: true },
          })
        : [];

      /*
       * WHO WAS NAMED, read the same way the agreement would have read it: the
       * affiliation where the arrival resolved to one (a nurse practitioner
       * refused for their role has one), the legacy `providers` row where it
       * did not — which is what `provider_not_anchored` means.
       */
      const anchors = await anchorsForAgreements(
        tx,
        rows.map((row) => ({ id: row.id, affiliationId: row.affiliationId, providerId: row.providerId })),
      );

      return rows.map((row) => {
        const anchor = anchors.get(row.id) ?? null;
        const patient = patients.find((p) => p.id === row.patientId) ?? null;
        return {
          arrivalId: row.id,
          reason: row.refusedReason ?? 'provider_not_servicing',
          pmsPatientRecordNumber: row.pmsPatientRecordNumber,
          /*
           * ONLY WHEN THE PRACTICE ALREADY HAD A RECORD. A refused arrival
           * changes nothing about the person, so a walk-in the platform has
           * never seen is identified by the practice's own record number —
           * which is what reception is reading off their own screen anyway.
           */
          patientName: patient ? `${patient.givenNames} ${patient.familyName}` : null,
          affiliationId: row.affiliationId,
          providerId: row.providerId,
          providerName: anchor?.name ?? null,
          billingRole: anchor && anchor.billingRoleRecorded ? anchor.billingRole : null,
          arrivedAt: row.arrivedAt.toISOString(),
          source: row.source as RefusedArrival['source'],
        } satisfies RefusedArrival;
      });
    });
  }

  /**
   * WHO RECEPTION MAY CHOOSE INSTEAD — servicing providers only.
   *
   * A picker that offered the nurse again would be a picker that can reproduce
   * the refusal, so it does not: the list is filtered by the same predicate
   * that refused the arrival, from the same content file.
   */
  async servicingProviders(practiceId: string): Promise<ArrivalProviderChoice[]> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      /*
       * PRACTITIONERS AT LOCATIONS, not practice-wide rows (Carl, 7 Sep 2026).
       * The picker offers exactly what an agreement can be anchored on, so a
       * choice made here cannot produce a draft the service then refuses.
       * Ended affiliations are out: somebody who has left is not a choice.
       */
      const affiliations = await tx.affiliation.findMany({
        where: { status: { in: LIVE_AFFILIATION_STATUSES } },
        select: { id: true, billingRole: true },
      });
      const anchors = await anchorsForAffiliations(
        tx,
        affiliations.filter((a) => mayBeProviderOnAgreement(a.billingRole)).map((a) => a.id),
      );
      const labels = await this.locationLabels(tx, [...anchors.values()]);

      return [...anchors.values()]
        .map((anchor) => ({
          affiliationId: anchor.affiliationId!,
          name: anchor.name,
          providerType: anchor.providerType,
          /*
           * WHICH SITE, because the same person can appear twice. A picker
           * showing one name twice is a picker that makes reception guess.
           */
          locationLabel: (anchor.locationId ? labels.get(anchor.locationId) : null) ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || (a.locationLabel ?? '').localeCompare(b.locationLabel ?? ''));
    });
  }

  /** The practice's own label for a site — its code, else the suburb. */
  private async locationLabels(
    tx: Prisma.TransactionClient,
    anchors: readonly AgreementAnchor[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(anchors.map((a) => a.locationId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const locations = await tx.practiceLocation.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, suburb: true, address: true },
    });
    return new Map(locations.map((l) => [l.id, l.code ?? l.suburb ?? l.address]));
  }

  /**
   * RECEPTION NAMES THE PROVIDER THE CLAIM WILL GO UNDER, and the arrival is
   * replayed.
   *
   * SAME IDEMPOTENCY KEY, DELIBERATELY. It is the same walk-in: the retry must
   * supersede the refusal rather than put one person on the queue twice. The
   * message replayed is the PMS's own, held on the row since it was refused —
   * so what lands on the mirror is what the practice's software said, not what
   * a console form retyped (REQ-DATA-10).
   */
  async chooseProvider(
    practiceId: string,
    arrivalId: string,
    affiliationId: string,
    actor?: Actor,
  ): Promise<ArrivalReceipt> {
    const row = await this.reread(practiceId, arrivalId);
    if (row.outcome !== 'refused' || !row.refusedPayload) {
      throw new BadRequestException(
        'That arrival is not waiting for a provider. Only an arrival refused for naming somebody who ' +
          'cannot be the provider on an agreement can be re-sent this way.',
      );
    }
    const held = row.refusedPayload as unknown as ArrivalDto;
    // The practitioner is the ONE thing reception is changing. Everything else
    // is the PMS's own message, replayed verbatim — and every OTHER way of
    // naming a provider is cleared, so the replay cannot resolve back to the
    // person who was just refused.
    const replay: ArrivalDto = {
      ...held,
      affiliationId,
      practitionerId: undefined,
      locationId: undefined,
      providerId: undefined,
      providerNumber: undefined,
      idempotencyKey: row.idempotencyKey,
    };
    /*
     * THE ACTOR TRAVELS WITH THE REPLAY. A refused RECEPTION arrival is fixed
     * by a person at the desk exactly as a refused connector one is, and the
     * replay is that person's act — the row would otherwise come back with no
     * `receivedByPrincipalId` and look like a machine push
     * (`arrivals_principal_only_when_typed` allows it either way; the record
     * being right is the point, not the constraint).
     */
    return this.receive(practiceId, replay, Object.keys(replay), actor);
  }

  // -------------------------------------------------------------------------

  private assertNothingForbiddenWasSent(sentFieldNames: string[], source?: string): void {
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

    /*
     * THE THREE FIELDS ONLY A PERSON MAY SEND (W2, Carl 7 Sep 2026).
     *
     * `serviceDate`, `serviceDescription` and `assignor` are answers somebody
     * at the desk gives. A connector has nobody to ask — which is exactly why
     * the practice's default D6a exists and why the patient is their own
     * assignor on a machine push — so a PMS body carrying one is refused OUT
     * LOUD rather than silently stripped, the same posture the Medicare and
     * agreement-type fences take. `whitelist: true` would have swallowed them
     * and taught their sender nothing.
     *
     * IT IS A CONTRACT FENCE, NOT AN AUTHORISATION ONE. What a caller may do
     * at all is `@PracticeScoped` and RLS; this says what an arrival MEANS,
     * so a connector author who assumes they may assert who signs learns it
     * once. Named test: `reception_only_fields_are_refused_from_a_connector`.
     */
    if (source !== ARRIVAL_SOURCE_TYPED_BY_A_PERSON) {
      const typed = sentFieldNames.filter((name) =>
        ['serviceDate', 'serviceDescription', 'assignor'].includes(name),
      );
      if (typed.length > 0) {
        throw new BadRequestException(
          `An arrival from "${source ?? 'an unnamed source'}" may not carry ${typed.join(', ')}. The day ` +
            'the service is for, the Basic Service Description and who is signing are answers a person ' +
            'at the desk gives — a practice management system has nobody to ask, which is why the ' +
            'practice’s default description exists (REQ-REG-01 D6a) and why the patient is their own ' +
            'assignor on a machine push (D7, hard rule 10). Send source "reception" if a person typed this.',
        );
      }
    }
  }

  /**
   * WHO THE PATIENT IS HERE TO SEE, RESOLVED TO THE PRACTITIONER AT THIS
   * LOCATION (Carl, 7 Sep 2026).
   *
   * FOUR KEYS, ANY ONE OF THEM, and the server does the resolving:
   *
   *   * `affiliationId` — the practitioner at a location outright. What a
   *     connector should send once it holds our ids.
   *   * `practitionerId` + `locationId` — the same fact said the long way,
   *     for a sender that knows the person and the site separately.
   *   * `providerNumber` — issued per practitioner per location (FR-1.8), so
   *     it names both by itself. What `arrive.sh` sends, and the likeliest
   *     thing a PMS actually holds.
   *   * `providerId` — DEPRECATED, accepted for one release. The practice-wide
   *     `providers` row, matched to an affiliation on the keys the two tables
   *     can share (`matchAffiliationsForProvider`). Removed once the connector
   *     names practitioners; TODO.md carries the date.
   *
   * AN ARRIVAL MUST NAME ONE OF THEM. An enduring agreement is per
   * practitioner × patient (hard rule 6, REQ-END-01), so an arrival that
   * cannot say who is one the policy cannot decide — refused rather than
   * defaulted to whoever is first in the list, which is how a consent record
   * comes to name the wrong doctor.
   */
  private async findAnchor(
    tx: Prisma.TransactionClient,
    practiceId: string,
    /*
     * THE FOUR KEYS AND NOTHING ELSE. Structural rather than `ArrivalDto` so
     * `POST /arrivals/preview` resolves the provider through the IDENTICAL
     * code the pipeline does — a preview that answered from its own lookup
     * would be a preview that can disagree with the thing it previews.
     */
    dto: Pick<ArrivalDto, 'affiliationId' | 'practitionerId' | 'locationId' | 'providerNumber' | 'providerId'>,
  ): Promise<ArrivalAnchor> {
    if (dto.affiliationId) {
      const anchor = await anchorForAffiliation(tx, dto.affiliationId);
      if (!anchor) throw new NotFoundException('That affiliation was not found in this practice.');
      return { ...anchor, legacyProviderId: null };
    }

    if (dto.practitionerId && dto.locationId) {
      const affiliation = await tx.affiliation.findFirst({
        where: { practiceId, practitionerId: dto.practitionerId, locationId: dto.locationId },
        select: { id: true },
      });
      if (!affiliation) {
        throw new NotFoundException(
          'That practitioner has no affiliation at that location in this practice, so there is no ' +
            'provider number and no place of practice to name on an agreement (s 65C(5)(a)).',
        );
      }
      const anchor = await anchorForAffiliation(tx, affiliation.id);
      if (!anchor) throw new NotFoundException('That affiliation was not found in this practice.');
      return { ...anchor, legacyProviderId: null };
    }

    if (dto.providerNumber) {
      /*
       * A NUMBER NAMES A PERSON AND A PLACE, so it must name exactly ONE of
       * them here. Two affiliations carrying the same number in one practice
       * is a data fault, not a choice to make at a desk, and picking the first
       * would put a coin toss on a contract.
       */
      const matches = await tx.affiliation.findMany({
        // Scoped explicitly as well as by RLS — a provider number is unique
        // within a practice, and the query should say which practice it means.
        where: { practiceId, providerNumber: dto.providerNumber },
        select: { id: true, status: true },
      });
      const live = matches.filter((row) => LIVE_AFFILIATION_STATUSES.includes(row.status));
      const candidates = live.length > 0 ? live : matches;
      if (candidates.length === 0) {
        throw new NotFoundException('No practitioner at this practice holds that provider number.');
      }
      if (candidates.length > 1) {
        throw new BadRequestException(
          `Provider number ${dto.providerNumber} is recorded against more than one practitioner at this ` +
            'practice. A provider number is issued per practitioner per location, so this is a records ' +
            'fault to fix rather than a choice to make — nothing was guessed.',
        );
      }
      const anchor = await anchorForAffiliation(tx, candidates[0]!.id);
      if (!anchor) throw new NotFoundException('That affiliation was not found in this practice.');
      return { ...anchor, legacyProviderId: null };
    }

    if (dto.providerId) {
      const provider = await tx.provider.findFirst({ where: { id: dto.providerId } });
      if (!provider) throw new NotFoundException('That provider was not found in this practice.');
      const anchor = await anchorForLegacyProvider(tx, provider);
      return { ...anchor, legacyProviderId: provider.id };
    }

    throw new BadRequestException(
      'An arrival must name the practitioner the patient is here to see — by affiliationId, by ' +
        'practitionerId and locationId together, or by providerNumber. An enduring agreement is per ' +
        'practitioner and patient, never per practice (REQ-END-01).',
    );
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
