import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertValidIdentifierSet,
  IdentifierSetError,
  type ApprovedIdentifierType,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateChallenge } from './identifier-matching';

/** D-06 default until a practice-config surface exists: lockout after 5 failed attempts. */
export const LOCKOUT_AFTER_ATTEMPTS = 5;

/** The one message a failed attempt ever returns — never which identifier failed (REQ-SEC-07). */
export const GENERIC_MISMATCH_MESSAGE = 'Some of those details do not match our records.';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

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

      const passed = evaluateChallenge(
        challenge.identifierTypes as ApprovedIdentifierType[],
        input.stated,
        patient,
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
