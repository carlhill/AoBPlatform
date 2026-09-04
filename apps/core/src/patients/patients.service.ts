import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CORRECTABLE_PATIENT_FIELDS,
  detailTypeForPatientField,
  isCorrectablePatientField,
  type ConfirmableDetailType,
  type CorrectablePatientField,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.withPractice(practiceId, async (tx) => {
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
  }
}
