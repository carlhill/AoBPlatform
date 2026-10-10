import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  UNSIGNED_DRAFT_CLOSURE_TYPES,
  UNSIGNED_OPEN_STATUSES,
  effectiveClosureDays,
  isClosureDue,
  practiceToday,
  visitDayOf,
  type UnsignedDraftClosureReason,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { servicesMatchingDraft } from '../agreements/pre-agreement-association';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;
const PRACTICE_BATCH = 500;
const REASON: UnsignedDraftClosureReason = 'no_service_recorded';

/** Why a due draft was left open. Counted, never logged with a patient in it. */
export type ClosureSkip =
  | 'linked'
  | 'associated'
  | 'service_matches_visit'
  | 'superseded'
  | 'on_tablet'
  | 'live_remote_link'
  | 'changed_under_us';

export interface ClosureResult {
  closed: number;
  skipped: Partial<Record<ClosureSkip, number>>;
}

/**
 * CLOSE UNSIGNED AGREEMENTS NOBODY NEEDED (D-2026-10-10-09, option 3; Carl:
 * "N is 7 days - make N a configurable setting").
 *
 * WHAT IS CLOSED. An agreement of a type drafted for one visit
 * (`UNSIGNED_DRAFT_CLOSURE_TYPES`), unsigned and still open
 * (`UNSIGNED_OPEN_STATUSES`), not on legal hold, whose visit day
 * (`visitDayOf`, practice-local) is at least N days ago, where N is the
 * practice's own `unsignedDraftClosureDays` or the versioned default
 * (`effectiveClosureDays`). It moves to `expired` with the reason
 * `no_service_recorded`, the time, the content version and the N applied,
 * and two vault events in the same transaction (hard rule 11). Never a delete.
 *
 * WHAT IS NEVER CLOSED, because "no service recorded" would be false of it or
 * something could still claim it (wow.md §13):
 *  - a service record links it (`agreementId`);
 *  - it is associated with a service (option (b)): it waits for the three-way
 *    reconciliation on the TODO;
 *  - ANY service record matches its visit (same patient, servicing provider
 *    and day), even one nothing is associated with yet -- a service WAS
 *    recorded, so the reason would be untrue;
 *  - something has superseded it: its story is "replaced", not "not needed";
 *  - it is on a tablet right now (an active session);
 *  - a remote capture link for it is open and has not expired;
 *  - it is younger than N.
 *
 * Cross-practice discovery goes through a SECURITY DEFINER function that
 * returns practice ids only; every read and write after that is scoped.
 * Nothing here can block care (hard rule 8): it only closes what nobody signed.
 */
@Injectable()
export class UnsignedDraftClosureSweep {
  private readonly logger = new Logger(UnsignedDraftClosureSweep.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    try {
      const closed = await this.run();
      if (closed > 0) this.logger.log(`Closed ${closed} unsigned agreement(s) with no service recorded after N days.`);
    } catch (err) {
      // A sweep failure must never take the process down, and never pass silently.
      this.logger.error(`Unsigned draft closure sweep failed: ${(err as Error).message}`);
    }
  }

  /** Callable so a test proves the closure rather than waiting for a cron. */
  async run(now: Date = new Date()): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ practiceId: string }>>`
      SELECT * FROM core.unsigned_draft_closure_practices(
        ${[...UNSIGNED_OPEN_STATUSES]}::text[], ${[...UNSIGNED_DRAFT_CLOSURE_TYPES]}::text[], ${PRACTICE_BATCH}::int)`;
    let closed = 0;
    for (const { practiceId } of rows) {
      try {
        closed += (await this.closeForPractice(practiceId, now)).closed;
      } catch (err) {
        // One practice's failure must not stop the next one's. No patient in the line.
        this.logger.error(`Unsigned draft closure failed for practice ${practiceId}: ${(err as Error).message}`);
      }
    }
    return closed;
  }

  /** One practice, in one transaction: every due draft decided, every closure evidenced. */
  async closeForPractice(practiceId: string, now: Date = new Date()): Promise<ClosureResult> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const result: ClosureResult = { closed: 0, skipped: {} };
      const skip = (why: ClosureSkip) => {
        result.skipped[why] = (result.skipped[why] ?? 0) + 1;
      };
      const practice = await tx.practice.findFirst({ select: { unsignedDraftClosureDays: true } });
      if (!practice) return result;
      const rule = effectiveClosureDays(practice.unsignedDraftClosureDays);
      const today = practiceToday(now);

      const open = await tx.agreement.findMany({
        where: {
          type: { in: [...UNSIGNED_DRAFT_CLOSURE_TYPES] },
          status: { in: [...UNSIGNED_OPEN_STATUSES] },
          signatureEventId: null,
          legalHold: false,
        },
        select: { id: true, status: true, patientId: true, affiliationId: true, providerId: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (open.length === 0) return result;
      const appointments = await tx.appointment.findMany({
        where: { agreementId: { in: open.map((a) => a.id) } },
        select: { agreementId: true, date: true },
      });
      const bookedOn = new Map(appointments.map((a) => [a.agreementId as string, a.date]));
      const due = open
        .map((a) => ({ ...a, forDay: visitDayOf(a, bookedOn.get(a.id) ?? null) }))
        .filter((a) => isClosureDue(a.forDay, rule.days, today));
      if (due.length === 0) return result;

      const ids = due.map((a) => a.id);
      const [linked, associated, successors, sessions, liveLinks] = await Promise.all([
        tx.serviceRecord.findMany({ where: { agreementId: { in: ids } }, select: { agreementId: true } }),
        tx.preAgreementAssociation.findMany({ where: { agreementId: { in: ids } }, select: { agreementId: true } }),
        tx.agreement.findMany({
          where: { supersedesAgreementId: { in: ids } },
          select: { supersedesAgreementId: true },
        }),
        tx.tabletSession.findMany({
          where: { agreementId: { in: ids }, endedAt: null },
          select: { agreementId: true },
        }),
        tx.captureRequest.findMany({
          where: { agreementId: { in: ids }, status: 'open', expiresAt: { gt: now } },
          select: { agreementId: true },
        }),
      ]);
      const set = (rows: { agreementId?: string | null; supersedesAgreementId?: string | null }[]) =>
        new Set(rows.map((r) => (r.agreementId ?? r.supersedesAgreementId) as string));
      const isLinked = set(linked);
      const isAssociated = set(associated);
      const isSuperseded = set(successors);
      const isOnTablet = set(sessions);
      const hasLiveLink = set(liveLinks);
      const anchorCache = new Map<string, string | null>();

      for (const draft of due) {
        if (isLinked.has(draft.id)) {
          skip('linked');
          continue;
        }
        if (isAssociated.has(draft.id)) {
          skip('associated');
          continue;
        }
        if (isSuperseded.has(draft.id)) {
          skip('superseded');
          continue;
        }
        if (isOnTablet.has(draft.id)) {
          skip('on_tablet');
          continue;
        }
        if (hasLiveLink.has(draft.id)) {
          skip('live_remote_link');
          continue;
        }
        if ((await servicesMatchingDraft(tx, draft, anchorCache)).length > 0) {
          skip('service_matches_visit');
          continue;
        }

        /* Re-checked AT WRITE TIME: only a row still unsigned and open moves. */
        const moved = await tx.agreement.updateMany({
          where: { id: draft.id, status: { in: [...UNSIGNED_OPEN_STATUSES] }, signatureEventId: null },
          data: {
            status: 'expired',
            closedReason: REASON,
            closedAt: now,
            closureRuleVersion: rule.ruleVersion,
            closureDays: rule.days,
            closureDaysSource: rule.source,
          },
        });
        if (moved.count !== 1) {
          skip('changed_under_us');
          continue;
        }

        await enqueueVaultEvent(tx, {
          type: 'agreement.status_changed',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: draft.id },
          payload: { from: draft.status, to: 'expired' },
        });
        await enqueueVaultEvent(tx, {
          type: 'agreement.closed_unsigned',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: draft.id },
          payload: {
            reason: REASON,
            ruleVersion: rule.ruleVersion,
            closureDays: rule.days,
            closureDaysSource: rule.source,
            forDay: draft.forDay,
            closedOn: today,
          },
        });
        result.closed += 1;
      }
      return result;
    });
  }
}
