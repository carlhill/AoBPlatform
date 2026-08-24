import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACTING_AS_MAX_MINUTES,
  ACTING_AS_REASON_KEYS,
  ActingAsError,
  actingAsReason,
  assertMayApproveAfterActingAs,
  describeVaultEventType,
  forcesReapproval,
  isSessionLive,
  noticeToPractice,
  noticeToPracticeOnEnd,
  sessionExpiresAt,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundService } from '../outbound/outbound.service';
import { EmailComposer } from '../messaging/composer.service';
import type { EmailBlock } from '../messaging/template';
import type { Actor } from '../auth/actor.decorator';

/**
 * Acting as a practice.
 *
 * Read packages/domain/src/acting-as.ts for the rules and why they are what
 * they are. This is the machinery.
 *
 * WHAT MAKES IT SAFE IS NOT THIS CLASS. It is that the session id rides on
 * every vault event automatically (vault-client/ambient.ts), that the
 * separation-of-duties check runs at the point of approval, and that the
 * database refuses to let an impersonation record be deleted or rewritten.
 * This class would be the wrong place for any of those, because it is the
 * place somebody would edit.
 */
@Injectable()
export class ActingAsService {
  private readonly logger = new Logger(ActingAsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: OutboundService,
    private readonly composer: EmailComposer,
    private readonly config: ConfigService,
  ) {}

  /**
   * Lines plus a session id into blocks, with the id SET APART rather than
   * folded into a sentence — Carl's ask: "put in email in bold the
   * acting-as-id". Placed right after the opening line, because it is the
   * thing a practice quotes back to us and needs to be found at a glance, not
   * hunted for at the bottom of the message.
   */
  private blocksFor(notice: { lines: string[]; sessionId: string }): EmailBlock[] {
    const [first, ...rest] = notice.lines;
    return [
      { text: first },
      { emphasised: { before: 'Session reference: ', bold: notice.sessionId } },
      ...rest.map((text) => ({ text })),
    ];
  }

  /**
   * "The session has stopped, and here is what happened in it" — told to the
   * practice the same way the start of the session was, and for the same
   * reason (rule 3: told afterwards, because nobody was there to ask
   * beforehand). Best-effort: a notice that failed to compose or send must
   * not undo the ending itself, which is why every step here is caught and
   * logged rather than thrown.
   */
  private async notifyPracticeSessionEnded(open: {
    id: string;
    practiceId: string;
    operatorName: string;
    startedAt: Date;
  }, endedAt: Date): Promise<void> {
    try {
      const practice = await this.prisma.withPractice(open.practiceId, (tx) =>
        tx.practice.findFirst({ where: { id: open.practiceId } }),
      );
      const to = practice?.groupEmail ?? practice?.adminEmail;
      if (!to) {
        this.logger.error(`ALERT: session ${open.id} ended with no address to notify the practice on.`);
        return;
      }

      /*
       * READ THE LOCAL OUTBOX, NOT THE VAULT SERVICE. The vault only knows
       * about an event once the relay has shipped it — every five seconds,
       * by design (VaultRelayService). A session that ends moments after its
       * last change would routinely be reported as having changed nothing,
       * which is the wrong answer delivered confidently. `vault_outbox` is
       * written SYNCHRONOUSLY, in the same transaction as the domain write
       * (enqueueVaultEvent's whole contract) — so it is there immediately,
       * whether or not the relay has caught up yet.
       */
      const rows = await this.prisma.vaultOutbox.findMany({ where: { occurredAt: { gte: open.startedAt } } });
      const events = rows.filter(
        (r) => (r.payload as Record<string, unknown> | null)?.actingAsSessionId === open.id,
      );
      const changeSummaries = events
        // The session's OWN start/end events are not "changes" from the
        // practice's point of view — they are the session itself.
        .filter((e) => e.type !== 'acting_as.started' && e.type !== 'acting_as.ended')
        .map((e) => describeVaultEventType(e.type));
      // Deduplicated in the order first seen: three location edits in one
      // session should read as one line, not three identical ones.
      const summary = [...new Set(changeSummaries)];

      const notice = noticeToPracticeOnEnd({
        operatorName: open.operatorName,
        startedAt: open.startedAt,
        endedAt,
        changeSummaries: summary,
        consoleUrl: this.consoleUrl(),
        sessionId: open.id,
      });

      const composed = {
        subject: notice.subject,
        ...this.composer.compose(notice.subject, this.blocksFor(notice)),
      };

      await this.prisma.withPractice(open.practiceId, (tx) =>
        this.outbound.enqueue(tx, {
          practiceId: open.practiceId,
          channel: 'email',
          destination: to,
          subjectType: 'ActingAsSession',
          subjectId: open.id,
          /*
           * WITHOUT THIS, THE STOP NOTICE NEVER SENDS. The start notice for
           * this same session already queued under {practiceId, email,
           * ActingAsSession, session.id} — enqueue's idempotency key is built
           * from exactly those four fields, so a second call with the same
           * ones is treated as a RETRY of the first and the upsert returns
           * the original row untouched. `attemptGroup` is the field this
           * table already has for "distinguishes a deliberate re-send from a
           * retry of the same one" — this is a deliberate second, different
           * message about the same subject, not a retry of the first.
           */
          attemptGroup: 'session-ended',
          payload: composed as unknown as Record<string, unknown>,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Could not tell the practice that session ${open.id} ended: ${(err as Error).message}`,
      );
    }
  }

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /**
   * Start acting for a practice.
   *
   * NO OTP, and that is rule 3. Asking the practice for a code before helping
   * them assumes somebody is there to answer — and the entire reason for this
   * feature is that nobody is. The control is that they are told AFTERWARDS,
   * which works when the practice is absent. An OTP does not.
   */
  async start(input: { practiceId: string; reason: string; note?: string }, actor?: Actor) {
    if (!actor) {
      throw new BadRequestException(
        'Acting as a practice records who did it, so it needs a signed-in operator. This is the one ' +
          'feature where an unattributed act would be indistinguishable from the abuse it is designed to ' +
          'make visible.',
      );
    }
    if (!ACTING_AS_REASON_KEYS.includes(input.reason as never)) {
      throw new BadRequestException(
        `"${input.reason}" is not a reason for acting as a practice. One of: ${ACTING_AS_REASON_KEYS.join(', ')}.`,
      );
    }

    const practice = await this.prisma.withPractice(input.practiceId, (tx) =>
      tx.practice.findFirst({ where: { id: input.practiceId } }),
    );
    if (!practice) throw new NotFoundException('That practice does not exist.');

    /*
     * ONE AT A TIME. An operator with two open sessions has requests that
     * cannot be attributed to a practice without guessing, and guessing is not
     * a thing this system may do about impersonation.
     */
    const open = await this.openFor(actor.id);
    if (open) {
      throw new ConflictException(
        // NAMED, for the same reason the banner is. "another practice" leaves
        // somebody hunting for a session they cannot see; the name tells them
        // where to go and end it.
        `You are already acting as ${open.practiceName ?? open.practiceId}, since ` +
          `${open.startedAt.toISOString()}. End that one first — two open sessions would mean requests that ` +
          'cannot be attributed to a practice without guessing, and guessing is not a thing this system may ' +
          'do about impersonation.',
      );
    }

    const session = await this.prisma.$transaction(async (tx) =>
      tx.actingAsSession.create({
        data: {
          practiceId: input.practiceId,
          operatorSub: actor.id,
          operatorName: actor.name,
          reason: input.reason,
          note: input.note?.trim() || null,
          forcedReapproval: forcesReapproval(),
        },
      }),
    );

    await this.prisma.withPractice(input.practiceId, async (tx) => {
      await enqueueVaultEvent(tx, {
        type: 'acting_as.started',
        // The OPERATOR, emphatically. The whole point is that acts inside a
        // session are attributed to the person, not to the practice they wore.
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: 'Practice', id: input.practiceId },
        payload: {
          actingAsSessionId: session.id,
          operator: actor.name,
          reason: input.reason,
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
          forcesReapproval: true,
        },
      });

      /*
       * TOLD AFTERWARDS, NOT ASKED BEFOREHAND. Queued in the same transaction
       * as everything else, so a practice cannot be acted for without the
       * notice being on its way.
       */
      const to = practice.groupEmail ?? practice.adminEmail;
      if (to) {
        const notice = noticeToPractice({
          operatorName: actor.name,
          reasonKey: input.reason,
          startedAt: session.startedAt,
          note: input.note?.trim(),
          consoleUrl: this.consoleUrl(),
          sessionId: session.id,
        });
        const composed = {
          subject: notice.subject,
          ...this.composer.compose(notice.subject, this.blocksFor(notice)),
        };
        await this.outbound.enqueue(tx, {
          practiceId: input.practiceId,
          channel: 'email',
          destination: to,
          subjectType: 'ActingAsSession',
          subjectId: session.id,
          payload: composed as unknown as Record<string, unknown>,
        });
      } else {
        // Loud: a practice we cannot tell is a practice being acted for in
        // silence, which is the thing rule 3 exists to prevent.
        this.logger.error(
          `ALERT: acting as ${input.practiceId} with NO address to notify them on. Session ${session.id}.`,
        );
      }
    });

    this.logger.warn(
      `${actor.name} is now acting as practice ${input.practiceId} (${input.reason}). Session ${session.id}.`,
    );

    return {
      id: session.id,
      practiceId: session.practiceId,
      startedAt: session.startedAt,
      expiresAt: sessionExpiresAt(session),
      expiresInMinutes: ACTING_AS_MAX_MINUTES,
      reason: actingAsReason(input.reason)?.label ?? input.reason,
      practiceNotified: Boolean(practice.groupEmail ?? practice.adminEmail),
      consequence:
        'This practice now needs approving again, and it cannot be you who does it. That is the cost of ' +
        'acting for somebody, and it is deliberate.',
    };
  }

  /** The operator's currently live session, if any. */
  async openFor(operatorSub: string) {
    const candidate = await this.prisma.actingAsSession.findFirst({
      where: { operatorSub, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!candidate) return null;
    /*
     * EXPIRY IS COMPUTED. A row that says open and started two days ago is not
     * open — relying on a sweep to close it would make the sweep failing
     * indistinguishable from sessions that never end.
     */
    if (!isSessionLive(candidate, new Date())) return null;

    /*
     * WITH THE NAME, THE REASON AND THE DEADLINE.
     *
     * The banner said "You are acting as 821709fb-7f89-4fcf-95c0-27c5eb55cec8"
     * because this returned the raw row and the id was all it had. A UUID names
     * nothing to the person reading it, and the one thing this banner exists to
     * do is make it impossible to forget WHOSE console you are in.
     *
     * The reason belongs there too. It is stated at the start and then never
     * shown again, so a session opened for one purpose drifts into another
     * without anybody being reminded what they said they were doing.
     */
    const practice = await this.prisma.withPractice(candidate.practiceId, (tx) =>
      tx.practice.findFirst({ where: { id: candidate.practiceId } }),
    );

    return {
      ...candidate,
      practiceName: practice?.name ?? practice?.legalName ?? null,
      reasonLabel: actingAsReason(candidate.reason)?.label ?? candidate.reason,
      expiresAt: sessionExpiresAt(candidate),
      expiresInMinutes: ACTING_AS_MAX_MINUTES,
    };
  }

  /**
   * Stopping SOMEBODY ELSE'S session.
   *
   * WHY THIS IS NOT MERELY A CONVENIENCE. Every session already expires by
   * computation after ACTING_AS_MAX_MINUTES, so nothing can be left open
   * indefinitely and no sweep is load-bearing. What this adds is the ability to
   * end one EARLY — when somebody notices a session that should not be running,
   * the answer must not be "wait up to half an hour".
   *
   * Recorded as `ended_by_platform` and against the person who did it, because
   * ending another operator's session is itself an act worth being able to
   * question later.
   */
  async endOther(sessionId: string, actor?: Actor) {
    if (!actor) throw new BadRequestException('No signed-in operator.');

    const open = await this.prisma.actingAsSession.findFirst({ where: { id: sessionId } });
    if (!open) throw new BadRequestException('There is no such session.');
    if (open.endedAt) return { ended: false, detail: 'That session had already ended.' };

    await this.prisma.actingAsSession.update({
      where: { id: open.id },
      data: { endedAt: new Date(), endedHow: 'ended_by_platform' },
    });

    await this.prisma.withPractice(open.practiceId, (tx) =>
      enqueueVaultEvent(tx, {
        type: 'acting_as.ended',
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: 'Practice', id: open.practiceId },
        payload: {
          actingAsSessionId: open.id,
          operator: open.operatorName,
          endedBy: actor.name,
          endedHow: 'ended_by_platform',
        },
      }),
    );

    this.logger.warn(`${actor.name} stopped ${open.operatorName}'s session on practice ${open.practiceId}.`);
    await this.notifyPracticeSessionEnded(open, new Date());
    return {
      ended: true,
      detail: `${open.operatorName} is no longer acting as that practice. The reapproval it forced still stands.`,
    };
  }

  /** Stop. Ending is always allowed and never refused — the exit must be easy. */
  async end(actor?: Actor) {
    if (!actor) throw new BadRequestException('No signed-in operator.');
    const open = await this.openFor(actor.id);
    if (!open) return { ended: false, detail: 'You were not acting as anybody.' };

    await this.prisma.actingAsSession.update({
      where: { id: open.id },
      data: { endedAt: new Date(), endedHow: 'ended_by_operator' },
    });

    await this.prisma.withPractice(open.practiceId, (tx) =>
      enqueueVaultEvent(tx, {
        type: 'acting_as.ended',
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: 'Practice', id: open.practiceId },
        payload: { actingAsSessionId: open.id, operator: actor.name, endedHow: 'ended_by_operator' },
      }),
    );

    await this.notifyPracticeSessionEnded(open, new Date());
    return { ended: true, sessionId: open.id, practiceId: open.practiceId };
  }

  /**
   * Everyone who has acted as this practice since its last approval.
   *
   * The list rule 7 checks against. EVERY uncleared operator, not merely the
   * most recent — two operators taking turns would otherwise clear each other,
   * which is exactly the collusion the rule exists to make expensive.
   */
  async impersonatorsSinceApproval(practiceId: string): Promise<string[]> {
    const rows = await this.prisma.actingAsSession.findMany({
      where: { practiceId, clearedByApproval: null },
      select: { operatorSub: true },
    });
    return [...new Set(rows.map((r) => r.operatorSub))];
  }

  /**
   * Refuse an approval by somebody who acted as this practice.
   *
   * Called from the approval path. Throws, because a boolean invites a caller
   * to carry on — and the thing being carried on with is the single most
   * privileged act in the system.
   */
  async assertMayApprove(practiceId: string, approver?: Actor): Promise<void> {
    const impersonatorSubs = await this.impersonatorsSinceApproval(practiceId);
    if (impersonatorSubs.length === 0) return;
    if (!approver) {
      throw new BadRequestException(
        'This practice has been acted for since it was last approved, so the approval needs a signed-in ' +
          'reviewer — we have to know it is not the same person.',
      );
    }
    try {
      assertMayApproveAfterActingAs({ approverSub: approver.id, impersonatorSubs });
    } catch (err) {
      if (err instanceof ActingAsError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** Mark the sessions as answered once a different person has approved. */
  async clearAfterApproval(practiceId: string, approvalId: string) {
    return this.prisma.actingAsSession.updateMany({
      where: { practiceId, clearedByApproval: null },
      data: { clearedByApproval: approvalId },
    });
  }

  /** The log, for the platform screen. Never scoped away from an operator. */
  async list(practiceId?: string) {
    const sessions = await this.prisma.actingAsSession.findMany({
      where: practiceId ? { practiceId } : {},
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    const now = new Date();

    /*
     * NAMES, not ids. This is a register somebody READS -- a column of UUIDs is
     * a list nobody can act on, and acting on it is the entire point.
     */
    const names = new Map<string, string>();
    for (const id of new Set(sessions.map((x) => x.practiceId))) {
      const practice = await this.prisma.withPractice(id, (tx) =>
        tx.practice.findFirst({ where: { id }, select: { name: true, legalName: true } }),
      );
      if (practice) names.set(id, practice.name ?? practice.legalName ?? id);
    }

    return {
      sessions: sessions.map((s) => ({
        ...s,
        practiceName: names.get(s.practiceId) ?? null,
        live: isSessionLive(s, now),
        expiresAt: sessionExpiresAt(s),
        reasonLabel: actingAsReason(s.reason)?.label ?? s.reason,
      })),
      /** So the screen can say the rule rather than hard-coding the number. */
      maxMinutes: ACTING_AS_MAX_MINUTES,
    };
  }
}
