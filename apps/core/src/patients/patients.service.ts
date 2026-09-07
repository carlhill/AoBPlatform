import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CORRECTABLE_PATIENT_FIELDS,
  detailTypeForPatientField,
  isCorrectablePatientField,
  type AgreementType,
  type ConfirmableDetailType,
  type CorrectablePatientField,
  type DisputeResolutionOutcome,
  type PatientQueueItem,
  type PatientQueueRow,
  type PatientTimelineEntry,
  type TabletSessionState,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TabletSessionsService } from '../tablet-sessions/tablet-sessions.service';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';

/**
 * ANY FIELD NAME WITH "MEDICARE" IN IT IS REFUSED, WHATEVER IT IS FOR.
 *
 * Hard rule 1 and REQ-VER-02: the Medicare card number is NOT an identity
 * identifier, the approved set is name, date of birth, gender, address,
 * patient record number and IHI, and the exclusion is NON-CONFIGURABLE. The
 * ESLint rule fails the build on the identifier and there is a named test
 * `medicare_number_rejected_as_identifier`; this is the third fence, at the
 * only place a caller could reach — a JSON body, which no compiler sees.
 *
 * IT MATCHES ON THE NAME, NOT ON A LIST OF KNOWN SPELLINGS, because the
 * mistake arrives under a new spelling every time: `medicareNumber`,
 * `medicare_card`, `medicareIrn`, `patientMedicare`. A whitelist of the six
 * correctable fields would already have dropped it silently; refusing LOUDLY
 * is the point, so that whoever sent it learns why rather than wondering where
 * their field went.
 */
const MEDICARE_FIELD = /medicare/i;

export interface CorrectionOutcome {
  patientId: string;
  /** The COLUMNS that changed — names, never values. */
  fields: CorrectablePatientField[];
  /** The tick-box TYPES those columns answer, which is what reception disputed. */
  types: ConfirmableDetailType[];
  correctedAt: string;
}

/**
 * THE PLATFORM'S PATIENT MIRROR, AND THE ONE THING STAFF MAY CHANGE ON IT
 * (TODO.md "Check-your-details: tick or cross per row", Carl 4 Sep 2026).
 *
 * WHY THIS MODULE EXISTS AT ALL. Until now nothing outside the PMS sync ever
 * wrote a patient row — `PmsSyncService.ensurePatient` mirrors what the PMS
 * says and the PMS is the source of truth (REQ-DATA-10). Then the tablet
 * started asking the patient whether what we hold is right, and a patient who
 * says "no" needs somebody able to say what is. That is a staff act, on a
 * staff surface, with the staff member's identity on it — and it is a
 * different act from a sync, so it lives in a different place.
 *
 * CARL'S CAVEAT, WHICH THE CONSOLE REPEATS ON SCREEN VERBATIM: "The PMS is the
 * source of truth for patient details, and until the Medtech write-back (D-01)
 * exists, a correction made in our console lives on our mirror. That's fine for
 * the agreement being signed today — the particulars are right and locked — but
 * reception should still fix it in the PMS too, or the next sync will bring the
 * old address back." Which is why every correction stamps `detailsCorrectedAt`
 * and the per-field map beside it: when D-01 lands, the sync compares per field
 * and must not silently overwrite a staff correction newer than the PMS value.
 *
 * THE TYPE AND THE PERSON GO IN THE VAULT; THE VALUE DOES NOT. `name`,
 * `address`, `mobile` — the same vocabulary the tick-boxes use — plus who
 * typed it (REQ-VER-04's rule about identifier values, applied to the mirror).
 * The value itself lives only in the column it changed.
 *
 * ONE EVENT PER FIELD, not one per request. "Somebody corrected two things" is
 * a worse record than "somebody corrected the address, and somebody corrected
 * the mobile", and only the second can be joined to the cross the patient
 * actually made.
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * THE PUSH LIST'S OWN NOTION OF "TODAY", BORROWED RATHER THAN COPIED
     * (Carl, 4 Sep 2026). Reception's work list must name exactly the patients
     * `/practice/tablet` names — a second query that decided for itself what
     * "open today" meant would be a second answer to one question, and the two
     * screens would disagree in front of a patient. So this module asks the
     * module that owns the question, through its service, and reads none of
     * its tables (CLAUDE.md §4).
     */
    private readonly tabletSessions: TabletSessionsService,
    /**
     * THE PATIENT'S OWN REQUESTS, ASKED FOR RATHER THAN READ (Carl, 4 Sep
     * 2026). A patient who presses "ask the practice to correct this" on their
     * own page raises a review task, and until now the only place it appeared
     * was `/practice/reviews` — a queue nobody stands at while a patient is at
     * the desk. It belongs on that patient's work page, so this module asks the
     * module that owns the table for it (CLAUDE.md §4) rather than joining to
     * `review_tasks` itself.
     */
    private readonly reviewTasks: ReviewTasksService,
  ) {}

  /**
   * THE SIX CORRECTABLE DETAILS AS THEY STAND, FOR THE ONE PERSON ABOUT TO
   * CHANGE ONE.
   *
   * WHY THIS IS NOT ON THE THREE-SECOND POLL. `/practice/tablet` shows reception
   * a STATUS, not a mirror of the tablet's screen (TODO.md), and putting a
   * date of birth and a home address in a response that refreshes every three
   * seconds would put them on a monitor at the front counter, facing the room,
   * all morning. Reception does not need them there: they asked for them
   * across the desk minutes ago. They need them at the moment they open the
   * correction control, and that is when this is read.
   *
   * IT RETURNS ONLY WHAT MAY BE CORRECTED. No gender, no patient record
   * number, no IHI, no confidentiality flag, no linkage key — and no Medicare
   * number, because there is no column for one (hard rule 1). A read that
   * returned the whole row would make the correction screen a patient-record
   * viewer by accident.
   */
  async correctableDetails(practiceId: string, patientId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: patientId } });
      if (!patient) throw new NotFoundException('That patient was not found.');
      return {
        id: patient.id,
        givenNames: patient.givenNames,
        familyName: patient.familyName,
        dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
        address: patient.address,
        mobile: patient.mobile,
        email: patient.email,
        /*
         * SO THE CONSOLE CAN SAY "corrected here at 9:12, not yet in your
         * practice software". Until D-01 lands that sentence is the only thing
         * standing between a correction and the next sync quietly undoing it
         * (REQ-DATA-10; TODO.md's caveat, Carl 4 Sep 2026).
         */
        detailsCorrectedAt: patient.detailsCorrectedAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * CORRECT ONE OR MORE DETAILS ON THIS PRACTICE'S OWN PATIENT ROW.
   *
   * `sentFieldNames` IS THE RAW BODY'S KEYS, not the validated DTO's. The
   * global `ValidationPipe` runs with `whitelist: true`, so an unknown field is
   * STRIPPED before the handler sees it — which would turn a Medicare field
   * into a silent no-op rather than a refusal. The controller passes what
   * actually arrived so the refusal can be loud.
   */
  async correctDetails(
    practiceId: string,
    patientId: string,
    changes: Partial<Record<CorrectablePatientField, string>>,
    sentFieldNames: readonly string[],
    actor: Actor | undefined,
  ): Promise<CorrectionOutcome> {
    /*
     * NO ACTOR, NO CORRECTION. A patient detail that changed with nobody to
     * ask about it is exactly the shape this platform exists to make
     * impossible — the same reasoning the push gives about the verification
     * record, and the same one `devices_has_actor` gives in the database.
     */
    if (!actor) {
      throw new BadRequestException(
        'Correcting a patient detail records who did it, so it needs a signed-in staff member.',
      );
    }

    const forbidden = sentFieldNames.filter((name) => MEDICARE_FIELD.test(name));
    if (forbidden.length > 0) {
      throw new BadRequestException(
        'The Medicare card number is not an identity identifier and is never held here — the exclusion is ' +
          'not configurable (REQ-VER-02). The details that may be corrected are name, date of birth, ' +
          'address, mobile and email.',
      );
    }

    const unknown = sentFieldNames.filter((name) => !isCorrectablePatientField(name));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Only these details may be corrected here: ${CORRECTABLE_PATIENT_FIELDS.join(', ')}.`,
      );
    }

    const asked = CORRECTABLE_PATIENT_FIELDS.filter((field) => changes[field] !== undefined);
    if (asked.length === 0) {
      throw new BadRequestException('Nothing to correct — send at least one detail.');
    }

    const outcome = await this.prisma.withPractice(practiceId, async (tx) => {
      // A cross-practice id finds nothing: RLS filters on the
      // transaction-local scope, so this fails closed rather than admitting
      // the patient exists somewhere else.
      const patient = await tx.patient.findFirst({ where: { id: patientId } });
      if (!patient) throw new NotFoundException('That patient was not found.');

      /*
       * ONLY WHAT ACTUALLY CHANGED. Reception opens the field, looks at it and
       * saves without editing it more often than not; recording that as a
       * correction would put an event in the vault saying somebody changed
       * something when nobody did, and would move `detailsCorrectedAt` past a
       * PMS value it does not actually disagree with.
       */
      const now = new Date();
      const data: Prisma.PatientUpdateInput = {};
      const changed: CorrectablePatientField[] = [];
      for (const field of asked) {
        const next = (changes[field] ?? '').trim();
        const current =
          field === 'dateOfBirth'
            ? patient.dateOfBirth.toISOString().slice(0, 10)
            : ((patient[field] as string | null) ?? '');
        if (next === current) continue;
        changed.push(field);
        if (field === 'dateOfBirth') {
          const parsed = new Date(`${next}T00:00:00.000Z`);
          if (Number.isNaN(parsed.getTime())) {
            throw new BadRequestException('A date of birth must be a real date, written yyyy-mm-dd.');
          }
          data.dateOfBirth = parsed;
        } else {
          // An emptied contact detail is a null, not an empty string: "we hold
          // nothing" is what makes the tablet not draw the row at all.
          (data as Record<string, unknown>)[field] = next.length > 0 ? next : null;
        }
      }

      if (changed.length === 0) {
        return {
          patientId: patient.id,
          fields: [],
          types: [],
          correctedAt: patient.detailsCorrectedAt?.toISOString() ?? '',
        };
      }

      /*
       * THE ROW-LEVEL STAMP AND THE PER-FIELD MAP, both (schema.prisma says
       * why): the first answers "has anybody touched this mirror since the
       * last sync" cheaply, the second answers "which field, and when", which
       * is the comparison D-01's write-back will actually have to make. The
       * map is MERGED rather than replaced — correcting the address today must
       * not forget that the mobile was corrected last week.
       */
      const previous =
        patient.detailsCorrectedFields && typeof patient.detailsCorrectedFields === 'object'
          ? (patient.detailsCorrectedFields as Record<string, unknown>)
          : {};
      const map: Record<string, string> = {};
      for (const [key, value] of Object.entries(previous)) {
        if (typeof value === 'string') map[key] = value;
      }
      for (const field of changed) map[field] = now.toISOString();

      await tx.patient.update({
        where: { id: patient.id },
        data: { ...data, detailsCorrectedAt: now, detailsCorrectedFields: map },
      });

      const types = [...new Set(changed.map(detailTypeForPatientField))];
      for (const field of changed) {
        await enqueueVaultEvent(tx, {
          type: 'patient.details_corrected',
          // A NAMED PERSON. Never `system`, and never the practice: somebody
          // typed this, and the record is worth nothing if it cannot say who.
          actor: { principalType: 'staff', id: actor.id },
          subject: { type: 'Patient', id: patient.id },
          payload: {
            /*
             * THE FIELD AND THE TYPE, AND NOT ONE CHARACTER OF THE VALUE — not
             * the old one, not the new one, not a length, not a hash
             * (REQ-VER-04, REQ-LOG-08). What changed is in the encrypted
             * column; that it changed, and who changed it, is here.
             */
            field,
            detailType: detailTypeForPatientField(field),
            correctedBy: actor.name,
            /*
             * SAID OUT LOUD ON THE RECORD, because it is the thing somebody
             * will ask about in a year: this changed OUR mirror. The PMS is
             * the source of truth (REQ-DATA-10) and until D-01 lands nothing
             * carried this home (TODO.md, Carl 4 Sep 2026).
             */
            mirrorOnly: true,
            writtenBackToPms: false,
          },
        });
      }

      return { patientId: patient.id, fields: changed, types, correctedAt: now.toISOString() };
    });

    /*
     * AND THE PATIENT WHO ASKED FOR THIS IS NO LONGER WAITING (Carl, 4 Sep
     * 2026). Saving a correction to a detail a patient asked about closes their
     * request, because reception has just done the thing the request was for --
     * leaving them to find the task afterwards is how a queue fills with work
     * that was already done.
     *
     * AFTER THE TRANSACTION, NOT INSIDE IT. The review-tasks module opens its
     * own practice-scoped transaction, and nesting one inside this one would be
     * two connections holding rows for one act. The consequence is honest and
     * small: a correction that saved and a task that did not close leaves the
     * request open, which is the safe direction -- somebody looks again.
     */
    if (outcome.types.length > 0) {
      await this.reviewTasks.resolveCorrectionRequests(practiceId, patientId, outcome.types, actor);
    }

    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Reception's work list (TODO.md "Reception-centric: the patient work page")
  // ---------------------------------------------------------------------------

  /**
   * THE PATIENTS WITH SOMETHING OPEN TODAY - reception's queue, one row per
   * PERSON rather than one per agreement (Carl, 4 Sep 2026).
   *
   * IT INVENTS NO NEW NOTION OF "TODAY". Both halves come from
   * `TabletSessionsService`: the push list, whose own comment defines today as
   * the appointment's date (or, for a walk-in nobody booked, the day the draft
   * was created), and the last twenty-four hours of tablet sessions, which is
   * what makes a session that ENDED this morning still worth showing. A second
   * definition here would be a second answer to one question, and the two
   * screens would disagree in front of a patient.
   *
   * ONE ROW PER PATIENT, WITH EVERY OPEN THING ON IT. The same person can have
   * an agreement waiting, a session that timed out at nine and a crossed
   * detail nobody has answered - which is three rows on `/practice/tablet` and
   * one conversation at the desk.
   *
   * THE DATE OF BIRTH IS THE ONE DETAIL THAT TRAVELS, and only because two
   * people share a name (Carl asked for it by name). Nothing else about the
   * person is here: no address, no contact detail, no record number, no
   * Medicare number - there is no column for one and it is not an identity
   * identifier in any case (hard rule 1, REQ-VER-02). The five details are
   * still read only when somebody opens the control that corrects them.
   *
   * NO AMOUNTS, ANYWHERE (hard rule 4). Nothing in the shape could carry one.
   */
  async openToday(practiceId: string): Promise<PatientQueueRow[]> {
    const [pushable, sessions, corrections, lockedInvitations] = await Promise.all([
      this.tabletSessions.pushable(practiceId),
      // `false` = the last twenty-four hours, so an ended session still shows.
      this.tabletSessions.list(practiceId, false),
      /*
       * A PATIENT'S OWN CORRECTION REQUEST IS "SOMETHING OPEN" (Carl, 4 Sep
       * 2026), AND IT IS NOT BOUNDED BY TODAY. Somebody pressed a button on
       * their own page — possibly on a Sunday, possibly weeks ago — and nobody
       * here has answered it. Ageing it out of this list would make an
       * unanswered request invisible on the one screen reception actually uses,
       * which is how it stays unanswered.
       */
      this.reviewTasks.openForPatients(practiceId, 'portal_correction_requested'),
      /*
       * AND A PORTAL INVITATION THAT LOCKED (Carl, 5 Sep 2026), on the same
       * reasoning and with the same lack of a time bound. The patient was told
       * to ask the practice; this is the practice being told without waiting
       * for them to remember. Nothing here says which detail they got wrong —
       * the task does not carry it (REQ-VER-04, hard rule 9).
       */
      this.reviewTasks.openForPatients(practiceId, 'portal_activation_locked'),
    ]);

    const itemsByPatient = new Map<string, PatientQueueItem[]>();
    const push = (patientId: string, item: PatientQueueItem) => {
      const held = itemsByPatient.get(patientId);
      if (held) held.push(item);
      else itemsByPatient.set(patientId, [item]);
    };

    /*
     * SESSIONS FIRST, because the freshest fact about a patient is what their
     * tablet is doing - the console reads the whole list to decide the row's
     * one line, but a caller reading only the first item still gets the thing
     * that changed most recently. `list` orders by `pushedAt` descending.
     */
    for (const session of sessions) {
      push(session.patientId, {
        kind: 'session',
        agreementId: session.agreementId,
        agreementType: session.agreementType,
        sessionId: session.id,
        sessionState: session.state as TabletSessionState,
        deviceLabel: session.deviceLabel,
        endedAt: session.endedAt,
        disputedDetails: session.disputedDetails,
        disputeResolution: session.disputeResolution as DisputeResolutionOutcome | null,
      });
    }

    /*
     * THE REQUESTS FIRST AFTER THE SESSIONS, because they are the only item on
     * this list that a patient raised THEMSELVES and the only one nobody at the
     * practice has yet acknowledged. The TYPE of the detail travels; no value
     * does, and none was ever asked for (APP 13 routes a correction to the
     * record owner — it does not let an unverified channel write to a clinical
     * system).
     */
    for (const task of corrections) {
      const detail = (task.detail ?? {}) as Record<string, unknown>;
      push(task.subjectId, {
        kind: 'portal_correction_requested',
        reviewTaskId: task.id,
        fieldType: typeof detail.fieldType === 'string' ? detail.fieldType : undefined,
        requestedAt: task.raisedAt.toISOString(),
      });
    }

    for (const task of lockedInvitations) {
      const detail = (task.detail ?? {}) as Record<string, unknown>;
      push(task.subjectId, {
        kind: 'portal_activation_locked',
        reviewTaskId: task.id,
        lockedAt: task.raisedAt.toISOString(),
        ...(typeof detail.invitationId === 'string' ? { invitationId: detail.invitationId } : {}),
        /*
         * THE AGREEMENT THE LOCKED INVITATION WAS MINTED FOR, as a floor. It
         * is replaced below by the patient's most recent SIGNED agreement
         * where there is one, because that is the one a new invitation should
         * hang off — an invitation is minted against an agreement and this
         * saves reception finding it.
         */
        ...(typeof detail.agreementId === 'string' ? { agreementId: detail.agreementId } : {}),
      });
    }

    for (const row of pushable) {
      push(row.patientId, {
        kind: 'awaiting_signature',
        agreementId: row.agreementId,
        agreementType: row.agreementType as AgreementType,
        pushable: row.pushable,
        blockedReason: row.blockedReason,
      });
    }

    if (itemsByPatient.size === 0) return [];

    const lockedPatientIds = lockedInvitations.map((task) => task.subjectId);
    const { patients, latestSigned } = await this.prisma.withPractice(practiceId, async (tx) => {
      const found = await tx.patient.findMany({ where: { id: { in: [...itemsByPatient.keys()] } } });
      /*
       * THE MOST RECENT SIGNED AGREEMENT PER PATIENT WITH A LOCKED INVITATION,
       * and only for them. `POST /agreements/:id/portal-invitation` mints
       * against an agreement and refuses one that has not been signed
       * (FR-1.14), so the work page's "Send a new invitation" needs an id — and
       * the newest signed one is the right id, not the one the dead invitation
       * happened to name.
       */
      const signed = lockedPatientIds.length
        ? await tx.agreement.findMany({
            where: { patientId: { in: lockedPatientIds }, signatureEventId: { not: null } },
            select: { id: true, patientId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      const newest = new Map<string, string>();
      for (const agreement of signed) {
        if (!newest.has(agreement.patientId)) newest.set(agreement.patientId, agreement.id);
      }
      return { patients: found, latestSigned: newest };
    });

    for (const [patientId, items] of itemsByPatient) {
      const agreementId = latestSigned.get(patientId);
      if (!agreementId) continue;
      for (const item of items) {
        if (item.kind === 'portal_activation_locked') item.agreementId = agreementId;
      }
    }

    const rows: PatientQueueRow[] = patients.map((patient) => ({
      patientId: patient.id,
      patientName: `${patient.givenNames} ${patient.familyName}`,
      dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
      items: itemsByPatient.get(patient.id) ?? [],
    }));

    /*
     * THE ONES SOMEBODY HAS TO GET UP FOR, FIRST: an unanswered cross, then a
     * tablet with a live session on it, then everybody else by name. Sorting
     * by name alone would bury the one row that is actually waiting on a
     * person behind twelve that are waiting on nobody.
     */
    const rank = (row: PatientQueueRow): number => {
      const unanswered = row.items.some(
        (item) => (item.disputedDetails?.length ?? 0) > 0 && !item.disputeResolution,
      );
      if (unanswered) return 0;
      // A REQUEST THE PATIENT MADE AND NOBODY HAS ANSWERED ranks with the
      // things a person has to get up for, above a tablet that is simply busy.
      if (row.items.some((item) => item.kind === 'portal_correction_requested')) return 1;
      // A LOCKED INVITATION IS ALSO SOMEBODY WAITING ON US, and has been since
      // the third attempt — but a patient who asked a question outranks it.
      if (row.items.some((item) => item.kind === 'portal_activation_locked')) return 2;
      if (row.items.some((item) => item.kind === 'session' && item.endedAt === null)) return 3;
      return 4;
    };
    rows.sort((a, b) => rank(a) - rank(b) || a.patientName.localeCompare(b.patientName, 'en-AU'));
    return rows;
  }

  /**
   * WHAT HAPPENED TO THIS PATIENT, IN ORDER (the work page's History card).
   *
   * TYPES, TIMES AND SHORT CODES - never a value, never a sentence
   * (REQ-VER-04, REQ-LANG-01). A verification entry says which identifier
   * TYPES were checked and how it went; a correction says which detail moved
   * and never what it moved from or to; a signature says one happened. The
   * words are the console's, keyed by the type.
   *
   * IT IS A READ, AND ONLY A READ. Every WRITE this platform makes still goes
   * through the module that owns the row - the push through
   * `TabletSessionsService`, the lock and the signature through
   * `AgreementsService`. This assembles a projection of what those modules
   * already wrote, in one query per table, because the alternative is five
   * round trips from the browser and a screen that assembles evidence itself.
   *
   * IT IS NOT THE EVIDENCE. The vault holds the non-repudiable chain; this is
   * the same story told from the domain rows so reception can read it without
   * leaving the patient they are standing in front of.
   */
  async timeline(
    practiceId: string,
    patientId: string,
  ): Promise<{ patientId: string; entries: PatientTimelineEntry[] }> {
    /*
     * THE PATIENT'S OWN REQUESTS, READ BEFORE THE TRANSACTION OPENS, because
     * they belong to another module and are asked for through its service
     * rather than joined to (CLAUDE.md §4).
     */
    const [correctionRequests, lockedInvitations] = await Promise.all([
      this.reviewTasks.forPatient(practiceId, 'portal_correction_requested', patientId),
      this.reviewTasks.forPatient(practiceId, 'portal_activation_locked', patientId),
    ]);
    return this.prisma.withPractice(practiceId, async (tx) => {
      // A cross-practice id finds nothing rather than being refused - RLS
      // filters on the transaction-local scope, so this fails closed.
      const patient = await tx.patient.findFirst({ where: { id: patientId } });
      if (!patient) throw new NotFoundException('That patient was not found.');

      const agreements = await tx.agreement.findMany({
        where: { patientId },
        orderBy: { createdAt: 'asc' },
      });
      const agreementIds = agreements.map((a) => a.id);

      const [captures, signatures, verifications, sessions] = await Promise.all([
        agreementIds.length
          ? tx.captureRequest.findMany({ where: { agreementId: { in: agreementIds } } })
          : Promise.resolve([]),
        agreementIds.length
          ? tx.signatureEvent.findMany({ where: { agreementId: { in: agreementIds } } })
          : Promise.resolve([]),
        tx.verificationEvent.findMany({ where: { patientId } }),
        agreementIds.length
          ? tx.tabletSession.findMany({ where: { agreementId: { in: agreementIds } } })
          : Promise.resolve([]),
      ]);

      const entries: PatientTimelineEntry[] = [];
      const add = (
        when: Date | string | null | undefined,
        entry: Omit<PatientTimelineEntry, 'at'>,
      ) => {
        const iso = when instanceof Date ? when.toISOString() : (when ?? null);
        if (iso) entries.push({ at: iso, ...entry });
      };

      for (const agreement of agreements) {
        add(agreement.createdAt, {
          type: 'agreement_created',
          agreementId: agreement.id,
          detail: agreement.type,
        });
        add(agreement.particularsLockedAt, {
          type: 'particulars_locked',
          agreementId: agreement.id,
        });
        /*
         * THE SUPERSESSION IS RECORDED AGAINST THE AGREEMENT THAT WAS
         * REPLACED (HARD-02: corrections supersede, they do not edit), at the
         * moment the replacement was created - which is when it happened.
         */
        if (agreement.supersedesAgreementId) {
          add(agreement.createdAt, {
            type: 'agreement_superseded',
            agreementId: agreement.supersedesAgreementId,
          });
        }
      }

      for (const capture of captures) {
        add(capture.createdAt, {
          type: 'capture_opened',
          agreementId: capture.agreementId,
          detail: capture.channel,
        });
        add(capture.completedAt, {
          type: 'capture_closed',
          agreementId: capture.agreementId,
          detail: capture.status,
        });
      }

      for (const signature of signatures) {
        add(signature.createdAt, {
          type: 'agreement_signed',
          agreementId: signature.agreementId,
          detail: signature.method,
        });
      }

      for (const verification of verifications) {
        add(verification.createdAt, {
          type: 'verification',
          detail: verification.outcome,
          // THE TYPES THAT WERE CHECKED, never what they said (REQ-VER-04).
          detailTypes: [...verification.identifierTypes],
        });
      }

      for (const session of sessions) {
        add(session.pushedAt, {
          type: 'session_pushed',
          agreementId: session.agreementId,
          sessionId: session.id,
        });
        add(session.detailsConfirmedAt, {
          type: 'session_details_confirmed',
          agreementId: session.agreementId,
          sessionId: session.id,
          detailTypes: [...session.detailsConfirmedTypes],
        });
        add(session.detailsDisputedAt, {
          type: 'session_details_disputed',
          agreementId: session.agreementId,
          sessionId: session.id,
          detailTypes: [...session.detailsDisputedTypes],
        });
        add(session.disputeResolvedAt, {
          type: 'session_dispute_resolved',
          agreementId: session.agreementId,
          sessionId: session.id,
          detail: session.disputeResolution ?? undefined,
        });
        add(session.endedAt, {
          type: 'session_ended',
          agreementId: session.agreementId,
          sessionId: session.id,
          detail: session.state,
        });
      }

      /*
       * THE CORRECTIONS THIS MIRROR HAS TAKEN - from the per-field map, which
       * holds the LATEST time each detail was corrected (schema.prisma says
       * why it exists). A detail corrected twice therefore shows once; the
       * vault holds every one of them, and this is a projection rather than
       * the record.
       */
      const corrected =
        patient.detailsCorrectedFields && typeof patient.detailsCorrectedFields === 'object'
          ? (patient.detailsCorrectedFields as Record<string, unknown>)
          : {};
      for (const [field, when] of Object.entries(corrected)) {
        if (typeof when !== 'string' || !isCorrectablePatientField(field)) continue;
        add(when, { type: 'details_corrected', detailTypes: [detailTypeForPatientField(field)] });
      }

      /*
       * WHAT THE PATIENT ASKED FOR, AND WHAT WE DID ABOUT IT. Two entries and
       * not one: "somebody corrected the mobile" and "the patient asked us to
       * and we answered" are different facts, and only the second says whether
       * the person who asked was ever dealt with.
       *
       * TYPES ONLY, as everywhere else on this timeline (REQ-VER-04). The
       * request never carried a replacement value — the portal has no box for
       * one — so there is none here to leak.
       */
      for (const task of correctionRequests) {
        const detail = (task.detail ?? {}) as Record<string, unknown>;
        const fieldType = typeof detail.fieldType === 'string' ? detail.fieldType : null;
        add(task.raisedAt, {
          type: 'portal_correction_requested',
          ...(fieldType ? { detailTypes: [fieldType] } : {}),
        });
        if (task.resolvedAt) {
          add(task.resolvedAt, {
            type: 'portal_correction_resolved',
            ...(fieldType ? { detailTypes: [fieldType] } : {}),
            ...(task.resolution ? { detail: task.resolution } : {}),
          });
        }
      }

      /*
       * THE INVITATION LOCKED, AND WHETHER A NEW ONE WENT. The task carries
       * both times, so both are here — a patient who still cannot get in is
       * asking about the second, and its absence is the answer.
       *
       * NO IDENTIFIER TYPE AND NO OUTCOME, because the task holds none. What
       * failed is not on this timeline and is not readable anywhere reception
       * can reach (REQ-VER-04, hard rule 9).
       */
      for (const task of lockedInvitations) {
        add(task.raisedAt, { type: 'portal_activation_locked' });
        if (task.resolvedAt && task.resolution === 'reinvited') {
          add(task.resolvedAt, { type: 'portal_reinvited' });
        }
      }

      entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return { patientId: patient.id, entries: entries.slice(0, 200) };
    });
  }
}
