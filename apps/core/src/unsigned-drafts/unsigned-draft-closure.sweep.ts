import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  UNSIGNED_DRAFT_CLOSURE_MIN_DAYS,
  UNSIGNED_DRAFT_CLOSURE_TYPES,
  UNSIGNED_OPEN_STATUSES,
  addCalendarDays,
  effectiveClosureDays,
  isClosureDue,
  practiceDayWindow,
  practiceToday,
  visitDayOf,
  type UnsignedDraftClosureReason,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { servicesMatchingDraft } from '../agreements/pre-agreement-association';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;
const REASON: UnsignedDraftClosureReason = 'no_service_recorded';
/** Practices per page of the discovery function. */
const PRACTICE_PAGE = 500;
/** Drafts read per page; each is then decided in a transaction of its own. */
const DRAFT_PAGE = 100;
/** Drafts examined per practice per run, so one practice's backlog cannot hold the sweep. */
const MAX_DRAFTS_PER_PRACTICE_RUN = 2_000;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Why a due draft was left open. Counted, never logged with a patient in it. */
export type ClosureSkip =
  | 'not_open'
  | 'legal_hold'
  | 'not_due'
  | 'linked'
  | 'associated'
  | 'superseded'
  | 'on_tablet'
  | 'live_remote_link'
  | 'service_matches_visit';

/** What was found about one draft, under its row lock. */
export interface ClosureFacts {
  open: boolean;
  legalHold: boolean;
  due: boolean;
  linked: boolean;
  associated: boolean;
  superseded: boolean;
  onTablet: boolean;
  liveRemoteLink: boolean;
  serviceMatchesVisit: boolean;
}

/**
 * THE ONE RULE FOR "MAY THIS DRAFT BE CLOSED", pure so it is unit-tested on
 * its own: the first reason it may not, or `null` when it may. The order is
 * the order a reader would check, cheapest first, and "a service matches the
 * visit" last because it is the one that needs a query of its own.
 */
export function closureSkipFor(facts: ClosureFacts): ClosureSkip | null {
  if (!facts.open) return 'not_open';
  if (facts.legalHold) return 'legal_hold';
  if (!facts.due) return 'not_due';
  if (facts.linked) return 'linked';
  if (facts.associated) return 'associated';
  if (facts.superseded) return 'superseded';
  if (facts.onTablet) return 'on_tablet';
  if (facts.liveRemoteLink) return 'live_remote_link';
  if (facts.serviceMatchesVisit) return 'service_matches_visit';
  return null;
}

/**
 * THE CREATION-TIME CUT-OFF THAT CAN HOLD A DUE DRAFT: anything created on or
 * after the practice-local day `today - N + 1` is younger than N by its own
 * creation day. A booked draft whose appointment is LATER than its creation is
 * still read and judged on the appointment's day; one whose appointment was
 * EARLIER than its creation is closed by its creation day instead, which is
 * later and never earlier (the safe side).
 */
export function creationCutoff(today: string, days: number): Date {
  return practiceDayWindow(addCalendarDays(today, 1 - days)).from;
}

export interface ClosureResult {
  closed: number;
  examined: number;
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
 * practice's own `unsignedDraftClosureDays` or the versioned default. It moves
 * to `expired` with the reason, the time, the content version and the N
 * applied, and two vault events, in one transaction (hard rule 11).
 *
 * WHAT IS NEVER CLOSED (`closureSkipFor`): linked to a service, associated
 * with one, matched by any service for its visit, superseded, on a tablet, a
 * live remote link, legal hold, younger than N.
 *
 * ONE TRANSACTION PER DRAFT, UNDER A ROW LOCK (review, 11 Oct 2026). A single
 * transaction per practice hit Prisma's five-second limit once there was a
 * backlog and rolled back every hour. Now drafts are read in pages, oldest
 * first, with the permanent exclusions (linked, associated, superseded)
 * filtered out in the read so they are not re-examined every run; each draft
 * is then locked `FOR UPDATE` and every condition is re-read under the lock,
 * so a push or a signature racing the sweep either finishes first (and the
 * sweep sees it) or waits and finds the agreement closed.
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
      this.logger.error(`Unsigned draft closure sweep failed: ${(err as Error).constructor.name}`);
    }
  }

  /** Callable so a test proves the closure rather than waiting for a cron. */
  async run(now: Date = new Date()): Promise<number> {
    // The most permissive cut-off any practice could have: N is never below the content's minimum.
    const cutoff = creationCutoff(practiceToday(now), UNSIGNED_DRAFT_CLOSURE_MIN_DAYS);
    let after: string | null = null;
    let closed = 0;
    for (;;) {
      const page: Array<{ practiceId: string }> = await this.prisma.$queryRaw<Array<{ practiceId: string }>>`
        SELECT * FROM core.unsigned_draft_closure_practices(
          ${[...UNSIGNED_OPEN_STATUSES]}::text[], ${[...UNSIGNED_DRAFT_CLOSURE_TYPES]}::text[],
          ${cutoff}::timestamp, ${after}::uuid, ${PRACTICE_PAGE}::int)`;
      for (const { practiceId } of page) {
        try {
          closed += (await this.closeForPractice(practiceId, now)).closed;
        } catch (err) {
          // One practice's failure must not stop the next one's. Ids and a class only.
          this.logger.error(`Unsigned draft closure failed for practice ${practiceId}: ${(err as Error).constructor.name}`);
        }
      }
      if (page.length < PRACTICE_PAGE) return closed;
      after = page[page.length - 1]!.practiceId;
    }
  }

  /** One practice: drafts read in pages, oldest first, each decided in its own transaction. */
  async closeForPractice(practiceId: string, now: Date = new Date()): Promise<ClosureResult> {
    const result: ClosureResult = { closed: 0, examined: 0, skipped: {} };
    const practice = await this.prisma.withPractice(practiceId, (tx) =>
      tx.practice.findFirst({ select: { unsignedDraftClosureDays: true } }),
    );
    if (!practice) return result;
    const rule = effectiveClosureDays(practice.unsignedDraftClosureDays);
    const today = practiceToday(now);
    const cutoff = creationCutoff(today, rule.days);

    let cursor = { createdAt: new Date(0), id: NIL_UUID };
    while (result.examined < MAX_DRAFTS_PER_PRACTICE_RUN) {
      const page = await this.prisma.withPractice(practiceId, (tx) =>
        tx.$queryRaw<Array<{ id: string; createdAt: Date }>>`
          SELECT a."id", a."createdAt" FROM "agreements" a
          WHERE a."status" = ANY (${[...UNSIGNED_OPEN_STATUSES]}::text[])
            AND a."type" = ANY (${[...UNSIGNED_DRAFT_CLOSURE_TYPES]}::text[])
            AND a."signatureEventId" IS NULL
            AND NOT a."legalHold"
            AND a."createdAt" < ${cutoff}::timestamp
            AND (a."createdAt", a."id") > (${cursor.createdAt}::timestamp, ${cursor.id}::uuid)
            AND NOT EXISTS (SELECT 1 FROM "service_records" s WHERE s."agreementId" = a."id")
            AND NOT EXISTS (SELECT 1 FROM "pre_agreement_associations" p WHERE p."agreementId" = a."id")
            AND NOT EXISTS (SELECT 1 FROM "agreements" n WHERE n."supersedesAgreementId" = a."id")
          ORDER BY a."createdAt", a."id"
          LIMIT ${DRAFT_PAGE}::int`,
      );
      for (const row of page) {
        result.examined += 1;
        const outcome = await this.closeOne(practiceId, row.id, rule, today, now);
        if (outcome === 'closed') result.closed += 1;
        else result.skipped[outcome] = (result.skipped[outcome] ?? 0) + 1;
      }
      if (page.length < DRAFT_PAGE) break;
      cursor = page[page.length - 1]!;
    }
    return result;
  }

  /**
   * ONE DRAFT, LOCKED, RE-READ, DECIDED AND -- WHERE IT MAY BE -- CLOSED WITH
   * ITS EVENTS, all in one short transaction. The event's `from` is the status
   * read under the lock, and the update names that status, so nothing that
   * moved after the lock was taken can be overwritten.
   */
  private async closeOne(
    practiceId: string,
    agreementId: string,
    rule: ReturnType<typeof effectiveClosureDays>,
    today: string,
    now: Date,
  ): Promise<'closed' | ClosureSkip> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "agreements" WHERE "id" = ${agreementId}::uuid FOR UPDATE`;
      const draft = await tx.agreement.findFirst({
        where: { id: agreementId },
        select: {
          id: true,
          type: true,
          status: true,
          signatureEventId: true,
          legalHold: true,
          patientId: true,
          affiliationId: true,
          providerId: true,
          createdAt: true,
        },
      });
      if (!draft) return 'not_open' as const;
      const open =
        (UNSIGNED_OPEN_STATUSES as readonly string[]).includes(draft.status) &&
        (UNSIGNED_DRAFT_CLOSURE_TYPES as readonly string[]).includes(draft.type) &&
        draft.signatureEventId === null;
      const appointment = await tx.appointment.findFirst({ where: { agreementId }, select: { date: true } });
      const forDay = visitDayOf(draft, appointment?.date ?? null);
      const [linked, associated, superseded, onTablet, liveLink] = await Promise.all([
        tx.serviceRecord.count({ where: { agreementId } }),
        tx.preAgreementAssociation.count({ where: { agreementId } }),
        tx.agreement.count({ where: { supersedesAgreementId: agreementId } }),
        tx.tabletSession.count({ where: { agreementId, endedAt: null } }),
        tx.captureRequest.count({ where: { agreementId, status: 'open', expiresAt: { gt: now } } }),
      ]);
      const facts: ClosureFacts = {
        open,
        legalHold: draft.legalHold,
        due: isClosureDue(forDay, rule.days, today),
        linked: linked > 0,
        associated: associated > 0,
        superseded: superseded > 0,
        onTablet: onTablet > 0,
        liveRemoteLink: liveLink > 0,
        serviceMatchesVisit: false,
      };
      let skip = closureSkipFor(facts);
      if (skip === null) {
        facts.serviceMatchesVisit = (await servicesMatchingDraft(tx, { ...draft, forDay })).length > 0;
        skip = closureSkipFor(facts);
      }
      if (skip !== null) return skip;

      await tx.agreement.update({
        where: { id: agreementId, status: draft.status },
        data: {
          status: 'expired',
          closedReason: REASON,
          closedAt: now,
          closureRuleVersion: rule.ruleVersion,
          closureDays: rule.days,
          closureDaysSource: rule.source,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.status_changed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: { from: draft.status, to: 'expired' },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.closed_unsigned',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: {
          reason: REASON,
          ruleVersion: rule.ruleVersion,
          closureDays: rule.days,
          closureDaysSource: rule.source,
          forDay,
          closedOn: today,
        },
      });
      return 'closed' as const;
    });
  }
}
