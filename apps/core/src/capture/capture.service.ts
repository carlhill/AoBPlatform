import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { DEFAULT_LINK_EXPIRY_HOURS, mintCaptureToken, parseCaptureToken } from './capture-token';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;
const REMOTE_CHANNELS = ['sms_link', 'email_link'];
/** Default challenge for remote capture until practice config lands (floor 3, REQ-VER-06). */
const DEFAULT_CHALLENGE_TYPES = ['name', 'date_of_birth', 'address'];

@Injectable()
export class CaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: VerificationService,
  ) {}

  /**
   * Opens a capture request for a draft agreement. Multiple channels may be
   * open at once (send SMS and email where both are held — C3.2); completing
   * any one closes the rest (FR-2.7).
   */
  async open(practiceId: string, input: { agreementId: string; channel: string }) {
    const remote = REMOTE_CHANNELS.includes(input.channel);
    const minted = remote ? mintCaptureToken(practiceId) : null;

    const request = await this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: input.agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');
      if (!['draft', 'verification_pending'].includes(agreement.status)) {
        throw new BadRequestException(`Cannot open capture for an agreement in status ${agreement.status}.`);
      }
      const duplicate = await tx.captureRequest.findFirst({
        where: { agreementId: input.agreementId, channel: input.channel, status: 'open' },
      });
      if (duplicate) {
        throw new BadRequestException('An open capture request already exists for this channel (FR-2.7).');
      }
      const created = await tx.captureRequest.create({
        data: {
          practiceId,
          agreementId: input.agreementId,
          channel: input.channel,
          tokenHash: minted?.tokenHash ?? null,
          expiresAt: remote ? new Date(Date.now() + DEFAULT_LINK_EXPIRY_HOURS * 3600 * 1000) : null,
        },
      });
      if (agreement.status === 'draft') {
        await tx.agreement.update({ where: { id: agreement.id }, data: { status: 'verification_pending' } });
        await enqueueVaultEvent(tx, {
          type: 'agreement.status_changed',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: agreement.id },
          payload: { from: 'draft', to: 'verification_pending' },
        });
      }
      await enqueueVaultEvent(tx, {
        type: 'capture.requested',
        actor: SYSTEM_ACTOR,
        subject: { type: 'CaptureRequest', id: created.id },
        payload: { channel: input.channel, agreementId: input.agreementId },
      });
      return created;
    });

    // The raw token appears exactly once, in this response, for the message
    // dispatcher — it is not recoverable afterwards (only its hash is held).
    return { captureRequestId: request.id, channel: request.channel, token: minted?.token, expiresAt: request.expiresAt };
  }

  /**
   * Public landing: resolves a token to a verification challenge. The
   * response is CONTENT-BLIND (REQ-CHILD-04): it names no patient, no
   * provider, no practice — only what the person must state to proceed.
   */
  async openLink(token: string) {
    const parsed = parseCaptureToken(token);
    if (!parsed) throw new NotFoundException('This link is not valid.');

    return this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const request = await tx.captureRequest.findFirst({ where: { tokenHash: parsed.tokenHash } });
      if (!request) throw new NotFoundException('This link is not valid.');
      if (request.status !== 'open') throw new GoneException('This link has already been used or closed.');
      if (request.expiresAt && request.expiresAt < new Date()) {
        throw new GoneException('This link has expired. Contact the practice for a new one.');
      }

      let challengeId = request.verificationChallengeId;
      if (!challengeId) {
        const agreement = await tx.agreement.findFirst({ where: { id: request.agreementId } });
        if (!agreement) throw new NotFoundException('This link is not valid.');
        const challenge = await tx.verificationChallenge.create({
          data: {
            practiceId: parsed.practiceId,
            patientId: agreement.patientId,
            channel: request.channel,
            identifierTypes: DEFAULT_CHALLENGE_TYPES,
          },
        });
        challengeId = challenge.id;
        await tx.captureRequest.update({
          where: { id: request.id },
          data: { verificationChallengeId: challengeId },
        });
      }
      await enqueueVaultEvent(tx, {
        type: 'capture.link_opened',
        actor: SYSTEM_ACTOR,
        subject: { type: 'CaptureRequest', id: request.id },
        payload: { channel: request.channel },
      });
      return { captureRequestId: request.id, challengeId, identifierTypes: DEFAULT_CHALLENGE_TYPES };
    });
  }

  /**
   * Public landing verification: on pass, the agreement records the
   * verification event and moves to awaiting_signature; on lockout it moves
   * to verification_failed. Values are handled entirely by the verification
   * service and discarded there.
   */
  async verifyLink(token: string, stated: Record<string, string>) {
    const parsed = parseCaptureToken(token);
    if (!parsed) throw new NotFoundException('This link is not valid.');

    const context = await this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const request = await tx.captureRequest.findFirst({ where: { tokenHash: parsed.tokenHash } });
      if (!request?.verificationChallengeId || request.status !== 'open') {
        throw new NotFoundException('This link is not valid.');
      }
      return { requestId: request.id, challengeId: request.verificationChallengeId, agreementId: request.agreementId };
    });

    const result = await this.verification.attempt(parsed.practiceId, context.challengeId, { stated });

    if (result.outcome === 'passed' && result.verificationEventId) {
      await this.prisma.withPractice(parsed.practiceId, async (tx) => {
        await tx.agreement.update({
          where: { id: context.agreementId },
          data: { status: 'awaiting_signature', verificationEventId: result.verificationEventId },
        });
        await enqueueVaultEvent(tx, {
          type: 'agreement.status_changed',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: context.agreementId },
          payload: { from: 'verification_pending', to: 'awaiting_signature' },
        });
      });
    } else if (result.outcome === 'locked_out') {
      await this.prisma.withPractice(parsed.practiceId, async (tx) => {
        await tx.agreement.update({ where: { id: context.agreementId }, data: { status: 'verification_failed' } });
        await enqueueVaultEvent(tx, {
          type: 'agreement.status_changed',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: context.agreementId },
          payload: { from: 'verification_pending', to: 'verification_failed' },
        });
      });
    }
    return result;
  }

  /**
   * Marks a capture request completed and closes every other open request
   * for the agreement — reminders stop instantly on completion (FR-2.7).
   */
  async complete(practiceId: string, captureRequestId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const request = await tx.captureRequest.findFirst({ where: { id: captureRequestId } });
      if (!request) throw new NotFoundException('Capture request not found.');
      if (request.status !== 'open') throw new BadRequestException('Capture request is not open.');

      await tx.captureRequest.update({
        where: { id: captureRequestId },
        data: { status: 'completed', completedAt: new Date() },
      });
      const siblings = await tx.captureRequest.findMany({
        where: { agreementId: request.agreementId, status: 'open', id: { not: captureRequestId } },
      });
      for (const sibling of siblings) {
        await tx.captureRequest.update({ where: { id: sibling.id }, data: { status: 'cancelled' } });
        await enqueueVaultEvent(tx, {
          type: 'capture.cancelled',
          actor: SYSTEM_ACTOR,
          subject: { type: 'CaptureRequest', id: sibling.id },
          payload: { reason: 'another_channel_completed' },
        });
      }
      await enqueueVaultEvent(tx, {
        type: 'capture.completed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'CaptureRequest', id: captureRequestId },
        payload: { channel: request.channel },
      });
      return { completed: captureRequestId, cancelled: siblings.map((s) => s.id) };
    });
  }

  /**
   * Expiry sweep, every minute. Cross-practice system work cannot read
   * through FORCE RLS (an unscoped query fails closed to zero rows), so the
   * expiry itself runs inside the narrow SECURITY DEFINER function
   * expire_due_capture_requests() — one named operation, not a bypass. The
   * function returns what it expired; evidence is enqueued per practice
   * under that practice's own scope.
   */
  @Interval(60_000)
  async expireSweep(): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; practiceId: string }>>`
      SELECT * FROM expire_due_capture_requests()`;
    for (const row of rows) {
      await this.prisma.withPractice(row.practiceId, (tx) =>
        enqueueVaultEvent(tx, {
          type: 'capture.expired',
          actor: SYSTEM_ACTOR,
          subject: { type: 'CaptureRequest', id: row.id },
          payload: {},
        }),
      );
    }
  }
}
