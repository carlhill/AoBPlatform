import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
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
      const practice = await tx.practice.findFirst({});
      const expiryHours = practice?.linkExpiryHours ?? DEFAULT_LINK_EXPIRY_HOURS;
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
          expiresAt: remote ? new Date(Date.now() + expiryHours * 3600 * 1000) : null,
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
   * THE IN-PRACTICE CHANNEL, OPENED INSIDE A CALLER'S TRANSACTION — for the
   * push to a paired tablet (TODO.md "Push-to-device capture").
   *
   * WHY NOT `open` ABOVE. Two differences, and both matter. `open` owns its own
   * transaction, and the push must commit the capture request, the lock, the
   * staff-verified verification event and the session together or not at all
   * (hard rule 11). And `open` refuses an agreement that is not `draft` or
   * `verification_pending` — a sensible guard for a channel being opened
   * speculatively, and the wrong one here: the push has just verified the
   * patient across the desk and is moving the agreement to
   * `awaiting_signature` in the same breath. The push's own preconditions,
   * which are stricter, decide whether this may happen at all.
   *
   * IDEMPOTENT ON PURPOSE. An agreement that already has an open `in_practice`
   * request — a patient who was on the walk-up list and has now come to the
   * desk — gets that one back rather than a second. Two open requests on one
   * channel is exactly what FR-2.7's duplicate guard exists to prevent.
   *
   * IT NEVER MINTS A TOKEN. `in_practice` is not a remote channel: there is no
   * link, so there is nothing to hash and nothing that could be forwarded.
   */
  async openInPractice(
    tx: Prisma.TransactionClient,
    practiceId: string,
    agreementId: string,
  ): Promise<{ id: string; reused: boolean }> {
    const existing = await tx.captureRequest.findFirst({
      where: { agreementId, channel: 'in_practice', status: 'open' },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return { id: existing.id, reused: true };

    const created = await tx.captureRequest.create({
      data: { practiceId, agreementId, channel: 'in_practice', tokenHash: null, expiresAt: null },
    });
    await enqueueVaultEvent(tx, {
      type: 'capture.requested',
      actor: SYSTEM_ACTOR,
      subject: { type: 'CaptureRequest', id: created.id },
      payload: { channel: 'in_practice', agreementId },
    });
    return { id: created.id, reused: false };
  }

  /**
   * CLOSE EVERY OPEN CHANNEL ON AN AGREEMENT THAT HAS BEEN SUPERSEDED, inside
   * the caller's transaction (HARD-02: a correction supersedes, it never
   * edits).
   *
   * WHY THIS AND NOT A STATUS CHANGE ON THE AGREEMENT. The superseded
   * agreement is a real thing that really happened — it was validated, locked,
   * rendered and hashed, and its evidence stays exactly as it is. What must
   * stop is somebody being asked to SIGN it, on any channel, now that a
   * corrected version exists. Closing its capture requests is precisely that,
   * and it is the codebase's own idiom: `pushable` already treats an agreement
   * with no open capture request as one that has nowhere left to go.
   *
   * IT IS THE SAME SHAPE AS `complete`'s sibling cancellation, with a
   * different reason on the event — a reader asking "why did that link stop
   * working" gets an answer either way.
   */
  async cancelOpenFor(
    tx: Prisma.TransactionClient,
    agreementId: string,
    reason: string,
  ): Promise<string[]> {
    const open = await tx.captureRequest.findMany({ where: { agreementId, status: 'open' } });
    for (const request of open) {
      await tx.captureRequest.update({ where: { id: request.id }, data: { status: 'cancelled' } });
      await enqueueVaultEvent(tx, {
        type: 'capture.cancelled',
        actor: SYSTEM_ACTOR,
        subject: { type: 'CaptureRequest', id: request.id },
        payload: { reason, agreementId, channel: request.channel },
      });
    }
    return open.map((request) => request.id);
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

      const practice = await tx.practice.findFirst({});
      const challengeTypes = practice?.identifierTypes?.length ? practice.identifierTypes : DEFAULT_CHALLENGE_TYPES;

      let challengeId = request.verificationChallengeId;
      if (!challengeId) {
        const agreement = await tx.agreement.findFirst({ where: { id: request.agreementId } });
        if (!agreement) throw new NotFoundException('This link is not valid.');
        const challenge = await tx.verificationChallenge.create({
          data: {
            practiceId: parsed.practiceId,
            patientId: agreement.patientId,
            channel: request.channel,
            identifierTypes: challengeTypes,
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
      return { captureRequestId: request.id, challengeId, identifierTypes: challengeTypes };
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
