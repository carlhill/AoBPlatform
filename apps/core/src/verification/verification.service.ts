import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  assertValidIdentifierSet,
  IdentifierSetError,
  type ApprovedIdentifierType,
} from '@aobplatform/domain';
import type { Prisma } from '@prisma/client';
import type { PmsAdapter } from '@aobplatform/contracts';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateChallenge, type PatientIdentityRecord } from './identifier-matching';
import { PMS_ADAPTER } from '../pms/pms.tokens';

/** D-06 default until a practice-config surface exists: lockout after 5 failed attempts. */
export const LOCKOUT_AFTER_ATTEMPTS = 5;

/**
 * The statutory floor of three, until a practice configures its own
 * (REQ-VER-06). Name, date of birth and address — three of the approved six,
 * and never the Medicare card number, which is not an identity identifier and
 * whose exclusion is not configurable (REQ-VER-02, hard rule 1).
 */
export const DEFAULT_IDENTIFIER_TYPES = ['name', 'date_of_birth', 'address'] as const;

/** The one message a failed attempt ever returns — never which identifier failed (REQ-SEC-07). */
export const GENERIC_MISMATCH_MESSAGE = 'Some of those details do not match our records.';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PMS_ADAPTER) private readonly adapter: PmsAdapter,
  ) {}

  /**
   * ADR A-08: verification compares against PMS-held values fetched at
   * challenge time where the adapter allows — the PMS stays the source of
   * truth and our mirror stays minimal. Falls back to the mirror when the
   * PMS is unreachable (an outage slows nothing; REQ-REC-04).
   */
  private async identityRecordFor(patient: {
    pmsLinkageKey: string | null;
    familyName: string;
    givenNames: string;
    dateOfBirth: Date;
    genderAsIdentified: string | null;
    address: string | null;
    patientRecordNumber: string | null;
    ihi: string | null;
  }): Promise<PatientIdentityRecord> {
    if (patient.pmsLinkageKey && this.adapter.capabilities.readPatient) {
      try {
        const live = await this.adapter.readPatient(patient.pmsLinkageKey);
        if (live) {
          return {
            familyName: live.familyName,
            givenNames: live.givenNames,
            dateOfBirth: new Date(live.dateOfBirth),
            genderAsIdentified: live.genderAsIdentified ?? null,
            address: live.address ?? null,
            patientRecordNumber: live.patientRecordNumber ?? null,
            ihi: live.ihi ?? null,
          };
        }
      } catch (err) {
        this.logger.warn(`PMS unavailable at challenge time, using mirror: ${(err as Error).message}`);
      }
    }
    return patient;
  }

  /**
   * Starts a challenge: the identifier types to state, from the approved six
   * only — the Medicare exclusion is enforced by the domain guard and is not
   * configurable (REQ-VER-02).
   */
  async startChallenge(
    practiceId: string,
    input: { patientId: string; channel: string; identifierTypes: string[] },
  ) {
    try {
      assertValidIdentifierSet(input.identifierTypes);
    } catch (err) {
      if (err instanceof IdentifierSetError) throw new BadRequestException(err.message);
      throw err;
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: input.patientId } });
      if (!patient) throw new NotFoundException('Patient not found in this practice.');
      const challenge = await tx.verificationChallenge.create({
        data: {
          practiceId,
          patientId: input.patientId,
          channel: input.channel,
          identifierTypes: input.identifierTypes,
        },
      });
      return { challengeId: challenge.id, identifierTypes: challenge.identifierTypes };
    });
  }

  /**
   * THE STAFF CHECK ACROSS THE DESK, RECORDED — no values, because there were
   * never any values to have (REQ-VER-03/-04; TODO.md "Push-to-device
   * capture", Carl 4 Sep 2026).
   *
   * WHY THIS IS NOT `attempt`. `attempt` exists for a channel where somebody
   * STATES identifiers into a form and the server compares them: the remote
   * link, and the walk-up kiosk where an unsupported patient proves it is
   * them. Reception is a different act entirely. The receptionist has the
   * patient in front of them, has already checked the Medicare card in the PMS,
   * and has already asked date of birth, mobile, email and address across the
   * desk — THAT is the three-identifier check, and it happened outside this
   * system. What the platform can record is which TYPES were checked, that
   * they matched, on which channel, and BY WHOM. Routing it through `attempt`
   * would mean inventing values to compare, which would be a fabricated
   * verification dressed as a real one.
   *
   * IT TAKES THE CALLER'S TRANSACTION, and that is the point. The push commits
   * this event, the particulars lock and the tablet session together or not at
   * all (hard rule 11): a locked agreement on a tablet with no record of who
   * verified the patient is precisely the evidence gap this product exists to
   * close.
   *
   * THE STAFF IDENTITY IS REQUIRED. A staff-verified event attributed to
   * nobody is worse than no event: later it cannot be questioned, and it looks
   * exactly like one that could.
   *
   * NO VALUE OF ANY KIND IS WRITTEN HERE, and there is no parameter that could
   * carry one. `mobile` and `email` are deliberately absent from the identifier
   * types even though reception asked for them: they are CONTACT details, not
   * identity identifiers, and counting them toward the three would be the
   * Medicare-number mistake one step sideways (REQ-VER-02).
   */
  async recordStaffVerified(
    tx: Prisma.TransactionClient,
    practiceId: string,
    input: { patientId: string; identifierTypes: string[]; staffId: string; channel?: string },
  ): Promise<{ verificationEventId: string; identifierTypes: string[] }> {
    try {
      assertValidIdentifierSet(input.identifierTypes);
    } catch (err) {
      if (err instanceof IdentifierSetError) throw new BadRequestException(err.message);
      throw err;
    }
    if (!input.staffId) {
      throw new BadRequestException(
        'A staff-verified check is recorded against the person who made it. Without one it is refused ' +
          'rather than recorded as nobody (REQ-VER-03).',
      );
    }
    const channel = input.channel ?? 'in_practice';
    const now = new Date();

    /*
     * A CHALLENGE ROW, EVEN THOUGH NOBODY WAS CHALLENGED ON A SCREEN. It is
     * what the event hangs off, it records WHICH types were checked at the
     * moment they were checked, and it is marked passed immediately with a
     * single attempt — because that is what happened. Faking a sequence of
     * attempts would be more misleading than recording the one.
     */
    const challenge = await tx.verificationChallenge.create({
      data: {
        practiceId,
        patientId: input.patientId,
        channel,
        identifierTypes: input.identifierTypes,
        attempts: 1,
        passedAt: now,
      },
    });

    // Evidence: types and outcome only — never values (REQ-VER-04).
    const event = await tx.verificationEvent.create({
      data: {
        practiceId,
        patientId: input.patientId,
        challengeId: challenge.id,
        identifierTypes: input.identifierTypes,
        outcome: 'passed',
        channel,
        verifiedByStaffId: input.staffId,
      },
    });
    await enqueueVaultEvent(tx, {
      type: 'verification.staff_verified',
      actor: { principalType: 'staff', id: input.staffId },
      subject: { type: 'VerificationEvent', id: event.id },
      payload: {
        outcome: 'passed',
        channel,
        /*
         * THE TYPES THEMSELVES, not merely a count. This event is the whole
         * evidence of the check — "which three did you ask for" is the
         * question an auditor asks in 2028 — and a TYPE is not a value
         * (REQ-VER-04). Joined into one string because a vault payload holds
         * scalars, and sorted so two events recording the same check compare
         * equal regardless of the order a caller listed them in.
         */
        identifierTypes: [...input.identifierTypes].sort().join(','),
        identifierTypeCount: input.identifierTypes.length,
        staffVerified: true,
      },
    });

    return { verificationEventId: event.id, identifierTypes: input.identifierTypes };
  }

  /**
   * The identifier types this practice challenges on, or the statutory floor
   * of three (REQ-VER-06). Read through the module rather than copied into
   * every caller, so a practice that configures a fourth is honoured
   * everywhere at once.
   */
  async identifierTypesFor(practiceId: string): Promise<string[]> {
    const practice = await this.prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({}));
    return practice?.identifierTypes?.length ? practice.identifierTypes : [...DEFAULT_IDENTIFIER_TYPES];
  }

  /**
   * One attempt: stated values are compared constant-time against the held
   * record and DISCARDED — nothing below persists or logs a value. The
   * response never says which identifier failed.
   */
  async attempt(
    practiceId: string,
    challengeId: string,
    input: { stated: Record<string, string>; verifiedByStaffId?: string },
  ): Promise<{ outcome: 'passed' | 'failed' | 'locked_out'; verificationEventId?: string; message?: string }> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const challenge = await tx.verificationChallenge.findFirst({ where: { id: challengeId } });
      if (!challenge) throw new NotFoundException('Challenge not found.');
      if (challenge.passedAt) throw new BadRequestException('Challenge already completed.');
      if (challenge.lockedAt) {
        return { outcome: 'locked_out' as const, message: 'Verification is locked. Contact the practice.' };
      }

      const patient = await tx.patient.findFirst({ where: { id: challenge.patientId } });
      if (!patient) throw new NotFoundException('Patient record unavailable.');
      const identity = await this.identityRecordFor(patient);

      const passed = evaluateChallenge(
        challenge.identifierTypes as ApprovedIdentifierType[],
        input.stated,
        identity,
      );
      const attempts = challenge.attempts + 1;
      const lockout = !passed && attempts >= LOCKOUT_AFTER_ATTEMPTS;
      const outcome = passed ? 'passed' : lockout ? 'locked_out' : 'failed';

      await tx.verificationChallenge.update({
        where: { id: challengeId },
        data: {
          attempts,
          passedAt: passed ? new Date() : undefined,
          lockedAt: lockout ? new Date() : undefined,
        },
      });

      // Evidence: types and outcome only — never values (REQ-VER-04).
      const event = await tx.verificationEvent.create({
        data: {
          practiceId,
          patientId: challenge.patientId,
          challengeId,
          identifierTypes: challenge.identifierTypes,
          outcome,
          channel: challenge.channel,
          verifiedByStaffId: input.verifiedByStaffId,
        },
      });
      await enqueueVaultEvent(tx, {
        type: lockout ? 'verification.locked_out' : 'verification.attempted',
        actor: input.verifiedByStaffId
          ? { principalType: 'staff', id: input.verifiedByStaffId }
          : SYSTEM_ACTOR,
        subject: { type: 'VerificationEvent', id: event.id },
        payload: {
          outcome,
          channel: challenge.channel,
          identifierTypeCount: challenge.identifierTypes.length,
          attempts,
        },
      });

      if (passed) return { outcome: 'passed' as const, verificationEventId: event.id };
      if (lockout) {
        // Practice notification lands with the notification module (M6-adjacent);
        // the vault event above is the durable record meanwhile.
        return { outcome: 'locked_out' as const, message: 'Verification is locked. Contact the practice.' };
      }
      return { outcome: 'failed' as const, message: GENERIC_MISMATCH_MESSAGE };
    });
  }
}
