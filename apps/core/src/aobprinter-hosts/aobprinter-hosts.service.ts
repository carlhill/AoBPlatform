import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type AobPrinterHost } from '@prisma/client';
import type {
  AobPrinterChainPoint,
  AobPrinterChainRegressionView,
  AobPrinterChainStatus,
  AobPrinterFiledUnconfirmedRow,
  AobPrinterHeartbeat,
  AobPrinterHostException,
  AobPrinterHostOverviewRow,
  AobPrinterHostRow,
  AobPrinterHostsOverview,
  AobPrinterHostsView,
  AobPrinterLocalCheck,
  AobPrinterStageCounts,
} from '@aobplatform/contracts';
import {
  AOBPRINTER_OFFLINE_AFTER_MS,
  AOBPRINTER_REBASELINE_REASONS_VERSION,
  AOBPRINTER_VAULT_ANCHOR_MIN_INTERVAL_MS,
  aobPrinterChainVerdict,
  aobPrinterHostLiveness,
  isAobPrinterRebaselineReason,
  type AobPrinterChainRegression,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';

const SYSTEM_ACTOR = { principalType: 'system', id: 'aobprinter-heartbeat' } as const;
const SUBJECT_TYPE = 'AobPrinterHost';

/** What the heartbeat service hands over: the beat, with patients resolved on the server where a return names one. */
export interface AobPrinterHostRecordInput {
  readonly beat: AobPrinterHeartbeat;
  readonly exceptions: readonly AobPrinterHostException[];
  readonly filedUnconfirmed: readonly AobPrinterFiledUnconfirmedRow[];
}

/** The chain part of the reply: the status, and the seq the host answers at next time. */
export interface AobPrinterHostRecorded {
  readonly status: AobPrinterChainStatus;
  readonly anchorSeq: number;
}

interface RegressionDetail {
  expected: AobPrinterChainPoint;
  received: AobPrinterChainPoint;
}

/**
 * THE HOST'S OWN CHECK AS STORED: rebuilt from only the fields its `ok` value
 * declares (the contract's `AobPrinterLocalCheck` union), never the object the
 * request carried. The DTO has already refused a `why` outside `link|content`
 * and a seq that is not an integer; this makes the stored shape exact (hard
 * rule 9: no free text reaches storage).
 */
export function storedLocalCheck(check: AobPrinterLocalCheck): AobPrinterLocalCheck {
  return check.ok
    ? { ok: true, verifiedThroughSeq: check.verifiedThroughSeq }
    : { ok: false, brokenAtSeq: check.brokenAtSeq, why: check.why };
}

/**
 * ONE PRACTICE'S HOSTS, ONE WRITER AT A TIME. A transaction-scoped advisory
 * lock keyed on the practice, taken before the rows are read. `FOR UPDATE`
 * alone locks only rows that already exist, so two FIRST beats (no rows yet)
 * both read "no other chain" — two `unverified` chains where decision 6 says
 * the second is `chain_replaced` — and a duplicate first beat from one chain
 * hit the unique key and answered 500. Released at commit or rollback.
 */
async function lockPracticeHosts(tx: Prisma.TransactionClient, practiceId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`aobprinter_hosts:${practiceId}`}))`;
}

/**
 * RETIRED, AS EVERY READER OF THE ROW MEANS IT (PRINTER-HEARTBEAT.md §3): the
 * stamp, unless the chain has reported SINCE it was retired — then it is a
 * host still running beside the accepted one, and counts as live for rule 1,
 * for the two-hosts notice, for the sweep, for the console and for
 * re-baselining. Null when not retired. The same predicate as
 * `core.aobprinter_hosts_overview()` (migration 20261010020000).
 */
export function effectiveRetiredAt(r: Pick<AobPrinterHost, 'lastSeenAt' | 'retiredAt'>): Date | null {
  return r.retiredAt !== null && r.lastSeenAt.getTime() <= r.retiredAt.getTime() ? r.retiredAt : null;
}

const seenWithinOfflineWindow = (lastSeenAt: Date, now: Date) =>
  now.getTime() - lastSeenAt.getTime() <= AOBPRINTER_OFFLINE_AFTER_MS;

/**
 * STILL REPORTING, FOR THE TWO-HOSTS NOTICE (decision 6). Inside the offline
 * window, and not a retired chain that has been silent since it was retired:
 * the old chain of a replacement an operator has accepted is not a second
 * host. A retired chain that reports AFTER its retirement is a host still
 * running beside the accepted one, and counts — the same predicate as
 * `core.aobprinter_hosts_overview()` (migration 20261010020000).
 */
const reportingAsAHost = (r: Pick<AobPrinterHost, 'lastSeenAt' | 'retiredAt'>, now: Date) =>
  seenWithinOfflineWindow(r.lastSeenAt, now) && effectiveRetiredAt(r) === null;

/**
 * BOTH LIVE AT ONCE, FOR THE TWO-HOSTS ALERT AND NOTICE (decision 6). Both inside the
 * offline window, the other one reporting as a host, and the OLDER chain
 * (by first beat) has reported since the NEWER one first appeared. A new
 * chain beside one whose last beat came before it appeared is a replacement
 * still in the window, not a second host.
 */
function bothLiveAtOnce(
  self: { lastSeenAt: Date; createdAt: Date },
  other: Pick<AobPrinterHost, 'lastSeenAt' | 'createdAt' | 'retiredAt'>,
  now: Date,
): boolean {
  if (!seenWithinOfflineWindow(self.lastSeenAt, now) || !reportingAsAHost(other, now)) return false;
  const [olderLastSeen, newerAppeared] =
    self.createdAt.getTime() <= other.createdAt.getTime()
      ? [self.lastSeenAt, other.createdAt]
      : [other.lastSeenAt, self.createdAt];
  return olderLastSeen.getTime() > newerAppeared.getTime();
}

/**
 * TWO AUDIT LOGS REPORTING AT ONCE, FOR THE CONSOLE (decision 6). Some pair of
 * one practice's chains, both reporting as a host, is `bothLiveAtOnce` — the
 * ALERT's own predicate, so the notice and the ALERT cannot disagree. A
 * reinstall (the old chain stops, the new one starts) is not two at once,
 * however recently the old chain last reported.
 */
function twoChainsLiveAtOnce(
  rows: readonly Pick<AobPrinterHost, 'lastSeenAt' | 'createdAt' | 'retiredAt'>[],
  now: Date,
): boolean {
  return rows.some(
    (a, i) => reportingAsAHost(a, now) && rows.some((b, j) => j > i && bothLiveAtOnce(a, b, now)),
  );
}

/**
 * THE AOBPRINTER HOSTS (PRINTER-HEARTBEAT.md §3, D-2026-10-10-02). Owns
 * `aobprinter_hosts` and nothing else; the inbound heartbeat resolves what it
 * needs from print jobs and agreements through the services that own those,
 * and hands the result here.
 *
 * ONE TRANSACTION PER BEAT. The practice is locked (`lockPracticeHosts`), the
 * domain verdict is taken, the row is written and any vault event the verdict
 * implies goes through the outbox — all inside one `withPractice`, so a row
 * that says "regressed" with no `aobprinter.chain_regressed` behind it, or the
 * reverse, cannot be committed (hard rule 11). Locking the practice, not only
 * this chain's row, is what makes rule 1 ("another chain not retired") safe
 * against two chains beating at once — including two first beats, when there
 * is no row yet to lock.
 *
 * LOGS SAY CODES, SEQS AND IDS. A practice id, a host id, a regression kind, a
 * seq. Never a hash in full, never a patient (hard rule 9). Lines are emitted
 * after the commit, so a rolled-back beat says nothing.
 */
@Injectable()
export class AobPrinterHostsService {
  private readonly logger = new Logger(AobPrinterHostsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(practiceId: string, input: AobPrinterHostRecordInput, now: Date = new Date()): Promise<AobPrinterHostRecorded> {
    const { beat } = input;
    const after: Array<() => void> = [];

    const recorded = await this.prisma.withPractice(practiceId, async (tx) => {
      await lockPracticeHosts(tx, practiceId);
      await tx.$queryRaw`SELECT "id" FROM core.aobprinter_hosts WHERE "practiceId" = ${practiceId}::uuid FOR UPDATE`;
      const rows = await tx.aobPrinterHost.findMany({});
      const existing = rows.find((r) => r.chainId === beat.chainId) ?? null;

      const verdict = aobPrinterChainVerdict(
        existing
          ? {
              chainId: existing.chainId,
              headSeq: existing.headSeq,
              headHash: existing.headHash,
              anchorSeq: existing.anchorSeq,
              anchorHash: existing.anchorHash,
              chainStatus: existing.chainStatus as AobPrinterChainStatus,
            }
          : null,
        // Rule 1 reads the effective retirement: a retired chain that reports again counts.
        rows.map((r) => ({ chainId: r.chainId, rebaselinedAt: r.rebaselinedAt, retiredAt: effectiveRetiredAt(r) })),
        beat,
      );

      const advanced = !existing || beat.head.seq > existing.headSeq;
      const headAdvancedAt = advanced ? now : existing.headAdvancedAt;

      /*
       * THE HOURLY ANCHOR (decision 5): consistent, answered this beat, and the
       * head has moved since the vault last heard. A chain that sits still for
       * a day writes nothing; one that moves every minute writes once an hour.
       */
      const lastAnchored = existing?.vaultAnchoredAt ?? null;
      const anchorToVault =
        verdict.status === 'consistent' &&
        verdict.anchorVerified &&
        verdict.head.hash !== null &&
        (lastAnchored === null ||
          (now.getTime() - lastAnchored.getTime() >= AOBPRINTER_VAULT_ANCHOR_MIN_INTERVAL_MS &&
            headAdvancedAt !== null &&
            headAdvancedAt.getTime() > lastAnchored.getTime()));

      const regression = verdict.newRegression
        ? {
            regressionKind: verdict.newRegression.kind as string,
            regressionAt: now,
            regressionDetail: {
              expected: verdict.newRegression.expected,
              received: verdict.newRegression.received,
            } as unknown as Prisma.InputJsonValue,
          }
        : verdict.status === 'regressed' && existing
          ? {
              regressionKind: existing.regressionKind,
              regressionAt: existing.regressionAt,
              regressionDetail: (existing.regressionDetail ?? Prisma.DbNull) as Prisma.InputJsonValue,
            }
          : { regressionKind: null, regressionAt: null, regressionDetail: Prisma.DbNull };

      const data = {
        lastSeenAt: now,
        hostSentAt: new Date(beat.sentAt),
        intervalMs: beat.intervalMs,
        printerVersion: beat.printerVersion,
        templateVersion: beat.templateVersion,
        schemaVersion: beat.schemaVersion,
        runtimeVersion: beat.runtimeVersion,
        startedAt: new Date(beat.startedAt),
        collecting: beat.collecting,
        retentionEnabled: beat.retentionEnabled,
        queueCount: beat.queueCount,
        counts: beat.counts as unknown as Prisma.InputJsonValue,
        openExceptions: input.exceptions as unknown as Prisma.InputJsonValue,
        filedUnconfirmed: input.filedUnconfirmed as unknown as Prisma.InputJsonValue,
        localCheck: storedLocalCheck(beat.localCheck) as unknown as Prisma.InputJsonValue,
        // A seq and its hash are written together, always: `?? null` so an absent hash can never skip the column.
        headSeq: verdict.head.seq,
        headHash: verdict.head.hash ?? null,
        headAdvancedAt,
        anchorSeq: verdict.anchor.seq,
        anchorHash: verdict.anchor.hash ?? null,
        anchorVerifiedAt: verdict.anchorVerified ? now : (existing?.anchorVerifiedAt ?? null),
        vaultAnchoredAt: anchorToVault ? now : lastAnchored,
        chainStatus: verdict.status,
        ...regression,
      };
      const row = existing
        ? await tx.aobPrinterHost.update({ where: { id: existing.id }, data })
        : // `createdAt` by the same clock as `lastSeenAt`: the two-hosts test compares them.
          await tx.aobPrinterHost.create({ data: { practiceId, chainId: beat.chainId, createdAt: now, ...data } });

      if (verdict.newRegression) {
        // Decision 4: once, on the transition. A row already regressed has no `newRegression`.
        await enqueueVaultEvent(tx, {
          type: 'aobprinter.chain_regressed',
          actor: SYSTEM_ACTOR,
          subject: { type: SUBJECT_TYPE, id: row.id },
          /*
           * FLAT SCALARS, as every vault payload is: seqs, hashes and the kind.
           * A null hash (none held at that seq) is the empty string.
           */
          payload: {
            practiceId,
            chainId: row.chainId,
            kind: verdict.newRegression.kind,
            expectedSeq: verdict.newRegression.expected.seq,
            expectedHash: verdict.newRegression.expected.hash ?? '',
            receivedSeq: verdict.newRegression.received.seq,
            receivedHash: verdict.newRegression.received.hash ?? '',
          },
        });
        const kind = verdict.newRegression.kind;
        after.push(() =>
          this.logger.error(
            `ALERT: AOBPRINTER host ${row.id} at practice ${practiceId}: audit chain regressed (${kind}). ` +
              'Flagged until a platform operator re-baselines it.',
          ),
        );
      }
      if (anchorToVault) {
        await enqueueVaultEvent(tx, {
          type: 'aobprinter.chain_anchored',
          actor: SYSTEM_ACTOR,
          subject: { type: SUBJECT_TYPE, id: row.id },
          payload: { practiceId, chainId: row.chainId, seq: verdict.head.seq, hash: verdict.head.hash ?? '' },
        });
      }

      /*
       * TWO HOSTS (decision 6) is two chains KEEPING reporting — both live at
       * once — not a new chain appearing while the old one's last beat is
       * still inside the window: a reinstall on the same PC (the old chain
       * stops) is `chain_replaced`, and no second host. Said once per
       * episode: on the beat that makes it true, not on every beat while it
       * stays true. An episode ends when either chain leaves the window.
       */
      const thisCreatedAt = existing?.createdAt ?? now;
      const othersNowLive = rows.filter(
        (r) => r.chainId !== beat.chainId && bothLiveAtOnce({ lastSeenAt: now, createdAt: thisCreatedAt }, r, now),
      );
      const wasAlreadyTwo =
        existing !== null &&
        othersNowLive.some((r) => bothLiveAtOnce({ lastSeenAt: existing.lastSeenAt, createdAt: existing.createdAt }, r, now));
      if (othersNowLive.length > 0 && !wasAlreadyTwo) {
        after.push(() =>
          this.logger.error(
            `ALERT: AOBPRINTER practice ${practiceId} has two audit chains reporting at once ` +
              `(host ${row.id} beside ${othersNowLive.map((r) => r.id).join(', ')}). One AOBPRINTER per practice.`,
          ),
        );
      }

      // Decision 14: the host's own check failing is said once, when it starts failing.
      const wasFailing = (existing?.localCheck as AobPrinterLocalCheck | null | undefined)?.ok === false;
      if (!beat.localCheck.ok && !wasFailing) {
        const { brokenAtSeq, why } = beat.localCheck;
        after.push(() =>
          this.logger.error(
            `AOBPRINTER host ${row.id} at practice ${practiceId} reports its own audit chain broken at seq ${brokenAtSeq} (${why}).`,
          ),
        );
      }

      return { status: verdict.status, anchorSeq: verdict.anchor.seq };
    });

    for (const say of after) say();
    return recorded;
  }

  /** `GET /aobprinter-hosts`: this practice's hosts, newest first, with what the server decided. */
  async listForPractice(practiceId: string, now: Date = new Date()): Promise<AobPrinterHostsView> {
    const rows = await this.prisma.withPractice(practiceId, (tx) =>
      tx.aobPrinterHost.findMany({ orderBy: { lastSeenAt: 'desc' } }),
    );
    return {
      hosts: rows.map((r) => this.toView(r, now)),
      secondHostReporting: twoChainsLiveAtOnce(rows, now),
    };
  }

  /**
   * `GET /platform/aobprinter-hosts`: every host, worst first. Read through
   * `core.aobprinter_hosts_overview()` (SECURITY DEFINER), which returns
   * counts, versions, times and status — and the practice, so a row opens its
   * twin. Ordered here roughly; the console orders exactly, by its own states.
   * The function leaves out a retired chain silent since its retirement, so
   * every row here is reporting as a host (`reportingAsAHost`), and it carries
   * each row's first beat (`createdAt`, migration 20261010040000) so the
   * two-hosts notice is `twoChainsLiveAtOnce`, as on the practice page.
   */
  async overview(now: Date = new Date()): Promise<AobPrinterHostsOverview> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        practiceId: string;
        practiceName: string | null;
        lastSeenAt: Date;
        hostSentAt: Date;
        intervalMs: number;
        printerVersion: string;
        chainStatus: string;
        regressionKind: string | null;
        localCheckOk: boolean;
        openExceptions: number;
        filedUnconfirmed: number;
        staleQueued: number;
        createdAt: Date;
      }>
    >`SELECT * FROM core.aobprinter_hosts_overview()`;

    // Every row is already not retired in effect (the function's WHERE), so `retiredAt: null` is exact.
    const byPractice = new Map<string, Array<Pick<AobPrinterHost, 'lastSeenAt' | 'createdAt' | 'retiredAt'>>>();
    for (const r of rows) {
      const chains = byPractice.get(r.practiceId) ?? [];
      chains.push({ lastSeenAt: r.lastSeenAt, createdAt: r.createdAt, retiredAt: null });
      byPractice.set(r.practiceId, chains);
    }
    const twoAtOnce = new Set([...byPractice].filter(([, chains]) => twoChainsLiveAtOnce(chains, now)).map(([id]) => id));
    const hosts: AobPrinterHostOverviewRow[] = rows.map((r) => ({
      practiceId: r.practiceId,
      practiceName: r.practiceName,
      liveness: aobPrinterHostLiveness(r.lastSeenAt, r.intervalMs, now),
      chainStatus: r.chainStatus,
      regressionKind: r.regressionKind,
      localCheckOk: r.localCheckOk,
      secondHostReporting: twoAtOnce.has(r.practiceId),
      lastSeenAt: r.lastSeenAt.toISOString(),
      printerVersion: r.printerVersion,
      openExceptions: Number(r.openExceptions),
      filedUnconfirmed: Number(r.filedUnconfirmed),
      staleQueued: Number(r.staleQueued),
      clockSkewMs: r.hostSentAt.getTime() - r.lastSeenAt.getTime(),
    }));
    const rank = (h: AobPrinterHostOverviewRow) =>
      h.chainStatus === 'regressed'
        ? 0
        : h.secondHostReporting
          ? 1
          : !h.localCheckOk
            ? 2
            : h.liveness === 'offline'
              ? 3
              : h.liveness === 'stale'
                ? 4
                : 5;
    hosts.sort((a, b) => rank(a) - rank(b) || (a.practiceName ?? '').localeCompare(b.practiceName ?? ''));
    return { hosts };
  }

  /**
   * THE PLATFORM OPERATOR RE-BASELINES A REGRESSED CHAIN (decision 7).
   * PLATFORM_ADMIN and a fresh second factor are the controller's guards; the
   * reason is a code from the versioned list; the act is a vault event in the
   * same transaction as the row. The anchor restarts at the head the platform
   * last saw, so the next beats verify the chain afresh.
   *
   * RE-BASELINING ACCEPTS A HEAD; IT DOES NOT RETIRE A CHAIN. Only when the
   * regression being accepted is `chain_replaced` is the operator accepting
   * THIS chain as the practice's chain, so every other chain of the practice
   * is retired (`retiredAt`, `retiredBy`) in the same transaction, and the
   * count goes in the vault event. Any other kind retires nothing, and the
   * chain stays one a later rewrite would replace (rule 1, decision 6).
   *
   * NO PRACTICE HEADER. The host is named by its id; its practice is found by
   * `core.aobprinter_host_practice()` (host id → practice id, nothing else)
   * and the work is done inside that practice's scope.
   */
  async rebaseline(hostId: string, reasonCode: string, actor: Actor | undefined, now: Date = new Date()): Promise<AobPrinterHostRow> {
    if (!isAobPrinterRebaselineReason(reasonCode)) {
      throw new BadRequestException(`"${reasonCode}" is not a re-baseline reason.`);
    }
    if (!actor) {
      throw new ForbiddenException(
        'Re-baselining accepts a practice’s audit chain afresh, so it is recorded against the operator who did it. ' +
          'This request carries no signed-in user, so it is refused rather than recorded as nobody.',
      );
    }
    const [found] = await this.prisma.$queryRaw<Array<{ practiceId: string | null }>>`
      SELECT core.aobprinter_host_practice(${hostId}::uuid) AS "practiceId"`;
    const practiceId = found?.practiceId;
    if (!practiceId) throw new NotFoundException('No such AOBPRINTER host.');

    const row = await this.prisma.withPractice(practiceId, async (tx) => {
      await lockPracticeHosts(tx, practiceId);
      await tx.$queryRaw`SELECT "id" FROM core.aobprinter_hosts WHERE "id" = ${hostId}::uuid FOR UPDATE`;
      const host = await tx.aobPrinterHost.findFirst({ where: { id: hostId } });
      if (!host) throw new NotFoundException('No such AOBPRINTER host.');
      if (host.chainStatus !== 'regressed') {
        throw new ConflictException(`This host’s audit chain is ${host.chainStatus}, not regressed: there is nothing to re-baseline.`);
      }
      /*
       * A RETIRED CHAIN IS NOT RE-BASELINED. An operator accepted another
       * chain as the practice's, and this one has not reported since; accepting
       * it now would retire the accepted chain in turn and could leave the
       * practice with no chain at all. A retired chain that reports again is a
       * host still running, and may be re-baselined (`effectiveRetiredAt`).
       */
      const retiredAt = effectiveRetiredAt(host);
      if (retiredAt) {
        throw new ConflictException({
          statusCode: 409,
          message:
            `This audit chain was retired on ${retiredAt.toISOString()}, when another chain was accepted as the practice’s, ` +
            'and it has not reported since. A retired chain is not re-baselined.',
          reasonCode: 'aobprinter_chain_retired',
        });
      }
      /*
       * Accepting a replacement retires every other chain still counted —
       * including a retired one that has reported since (it is stamped
       * afresh). Two columns compared, so raw SQL, parameterised.
       */
      const retiredCount =
        host.regressionKind === 'chain_replaced'
          ? await tx.$executeRaw`
              UPDATE core.aobprinter_hosts SET "retiredAt" = ${now}, "retiredBy" = ${actor.id}
               WHERE "practiceId" = ${practiceId}::uuid AND "id" <> ${hostId}::uuid
                 AND ("retiredAt" IS NULL OR "lastSeenAt" > "retiredAt")`
          : 0;
      const updated = await tx.aobPrinterHost.update({
        where: { id: hostId },
        data: {
          // The accepted chain is the practice's: never left retired.
          retiredAt: null,
          retiredBy: null,
          chainStatus: 'unverified',
          regressionKind: null,
          regressionAt: null,
          regressionDetail: Prisma.DbNull,
          anchorSeq: host.headSeq,
          anchorHash: host.headHash,
          anchorVerifiedAt: null,
          rebaselinedAt: now,
          rebaselinedBy: actor.id,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'aobprinter.chain_rebaselined',
        actor: { principalType: actor.principalType, id: actor.id },
        subject: { type: SUBJECT_TYPE, id: hostId },
        payload: {
          practiceId,
          chainId: host.chainId,
          reasonCode,
          reasonsVersion: AOBPRINTER_REBASELINE_REASONS_VERSION,
          previousKind: host.regressionKind ?? '',
          anchorSeq: host.headSeq,
          anchorHash: host.headHash ?? '',
          retiredChains: retiredCount,
        },
      });
      return updated;
    });
    this.logger.log(`AOBPRINTER host ${hostId} at practice ${practiceId} re-baselined (${reasonCode}) by ${actor.id}.`);
    return this.toView(row, now);
  }

  private toView(r: AobPrinterHost, now: Date): AobPrinterHostRow {
    const detail = r.regressionDetail as unknown as RegressionDetail | null;
    const regression: AobPrinterChainRegressionView | null =
      r.regressionKind && r.regressionAt && detail
        ? {
            kind: r.regressionKind as AobPrinterChainRegression,
            at: r.regressionAt.toISOString(),
            expected: detail.expected,
            received: detail.received,
          }
        : null;
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      id: r.id,
      practiceId: r.practiceId,
      chainId: r.chainId,
      lastSeenAt: r.lastSeenAt.toISOString(),
      hostSentAt: r.hostSentAt.toISOString(),
      intervalMs: r.intervalMs,
      printerVersion: r.printerVersion,
      templateVersion: r.templateVersion,
      schemaVersion: r.schemaVersion,
      runtimeVersion: r.runtimeVersion,
      startedAt: r.startedAt.toISOString(),
      collecting: r.collecting,
      retentionEnabled: r.retentionEnabled,
      queueCount: r.queueCount,
      counts: r.counts as unknown as AobPrinterStageCounts,
      localCheck: r.localCheck as unknown as AobPrinterLocalCheck,
      head: { seq: r.headSeq, hash: r.headHash },
      headAdvancedAt: iso(r.headAdvancedAt),
      vaultAnchoredAt: iso(r.vaultAnchoredAt),
      rebaselinedAt: iso(r.rebaselinedAt),
      rebaselinedBy: r.rebaselinedBy,
      retiredAt: iso(effectiveRetiredAt(r)),
      liveness: aobPrinterHostLiveness(r.lastSeenAt, r.intervalMs, now),
      chain: {
        status: r.chainStatus as AobPrinterChainStatus,
        regression,
        anchorSeq: r.anchorSeq,
        anchorVerifiedAt: iso(r.anchorVerifiedAt),
      },
      clockSkewMs: r.hostSentAt.getTime() - r.lastSeenAt.getTime(),
      exceptions: r.openExceptions as unknown as AobPrinterHostException[],
      filedUnconfirmed: r.filedUnconfirmed as unknown as AobPrinterFiledUnconfirmedRow[],
    };
  }
}
