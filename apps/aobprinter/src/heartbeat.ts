/**
 * THE HEARTBEAT, AOBPRINTER'S SIDE (PRINTER-HEARTBEAT.md §2, D-2026-10-10-02).
 *
 * Every minute this host tells the platform it is alive, what it holds at
 * each stage, where its audit chain has got to, and which prints and returns
 * it is still waiting to hear about. The platform answers with what it did
 * with each, and the seq it wants the hash of next time.
 *
 * COUNTS, HASHES, IDS, CODES AND VERSIONS — NOTHING ELSE. `buildHeartbeat`
 * names every field; nothing is spread from a record, which is how a name or
 * a chart number would ride along (hard rule 9).
 *
 * A HEARTBEAT NEVER WRITES AN AUDIT EVENT FOR ITSELF. Otherwise each beat
 * would move the head it reports, and a quiet host would look busy. What the
 * REPLY says — a print processed, a return confirmed — is written, once.
 *
 * IT NEVER BLOCKS CAPTURE (hard rule 8). `beat()` never throws; it says once
 * when beats start failing and once when they recover, never every minute;
 * and the chain is checked a bounded chunk at a time from a frontier held in
 * memory, so a long chain cannot hold the loop that claims prints.
 */
import type {
  AobPrinterChainPoint,
  AobPrinterFiledReturn,
  AobPrinterHeartbeat,
  AobPrinterHeartbeatReply,
  AobPrinterLocalCheck,
} from '@aobplatform/contracts';
import { AOBPRINTER_HEARTBEAT_LIMITS } from '@aobplatform/contracts';
import { redactError, type Logger } from './log';
import { GENESIS_HASH, SCHEMA_VERSION, type AobPrinterStore } from './store';

/** At most this many events are verified per beat (§2). */
export const HEARTBEAT_VERIFY_CHUNK = 2_000;

/** The frontier goes back to the start this often, so the whole chain is walked daily. */
export const HEARTBEAT_FRONTIER_RESET_MS = 24 * 60 * 60 * 1000;

/** The HTTP half, injected so a test does not stand up a platform (`heartbeat-client.ts`). */
export interface HeartbeatClient {
  beat(body: AobPrinterHeartbeat, signal: AbortSignal): Promise<AobPrinterHeartbeatReply>;
}

/** A non-2xx answer, carrying its status so a refusal can be told from an outage. */
export class HeartbeatHttpError extends Error {
  constructor(readonly status: number) {
    super(`The platform answered ${status} to a heartbeat.`);
    this.name = 'HeartbeatHttpError';
  }
}

/** The store methods a heartbeat reads and the reply writes. All synchronous. */
export type HeartbeatStore = Pick<
  AobPrinterStore,
  'heartbeatSnapshot' | 'chainId' | 'auditHead' | 'auditHashAt' | 'verifyAuditRange' | 'recordPlatformOutcome' | 'returnConfirmedByPlatform'
>;

/** What this install is, fixed for the life of the process. */
export interface HeartbeatFacts {
  readonly printerVersion: string;
  readonly templateVersion: string;
  readonly intervalMs: number;
  /** How many print queues this host watches. */
  readonly queueCount: number;
  readonly collecting: boolean;
  readonly retentionEnabled: boolean;
  readonly startedAt: string;
}

export interface HeartbeatOptions {
  readonly store: HeartbeatStore;
  readonly client: HeartbeatClient;
  readonly logger: Logger;
  readonly facts: HeartbeatFacts;
  readonly now?: () => Date;
  /** Events verified per beat. `HEARTBEAT_VERIFY_CHUNK` unless a test wants to see the chunks. */
  readonly verifyChunk?: number;
}

/** Where the link to the platform stands, so each change is said once. */
type LinkState = 'unknown' | 'ok' | 'unreachable' | 'refused' | 'not_built';

/**
 * A 4xx is the platform refusing this host — a practice it does not know, a
 * surface not in use — and is ours to fix. 408 and 429 are the network's,
 * the same split the poster makes.
 */
function refusalStatus(err: unknown): number | null {
  if (!(err instanceof HeartbeatHttpError)) return null;
  const { status } = err;
  return status >= 400 && status < 500 && status !== 408 && status !== 429 ? status : null;
}

export class Heartbeat {
  private readonly store: HeartbeatStore;
  private readonly client: HeartbeatClient;
  private readonly logger: Logger;
  private readonly facts: HeartbeatFacts;
  private readonly now: () => Date;
  private readonly verifyChunk: number;

  /** The seq the platform last asked about. Unknown until it names one, and after a restart. */
  private anchorSeq: number | undefined;
  /** How far the chain has been verified, and when the frontier last went back to the start. */
  private frontier: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH };
  private frontierResetAt: number;
  private loggedBrokenAt: number | undefined;
  private link: LinkState = 'unknown';
  /** Returns whose written-back hash differs, already said. */
  private readonly hashDiffersSaid = new Set<string>();

  constructor(options: HeartbeatOptions) {
    this.store = options.store;
    this.client = options.client;
    this.logger = options.logger;
    this.facts = options.facts;
    this.now = options.now ?? (() => new Date());
    this.verifyChunk = options.verifyChunk ?? HEARTBEAT_VERIFY_CHUNK;
    this.frontierResetAt = this.now().getTime();
  }

  /**
   * One beat. NEVER THROWS. Nothing is written before a reply arrives, so an
   * abort loses nothing; a reply that has already arrived is still applied.
   */
  async beat(signal: AbortSignal): Promise<void> {
    let body: AobPrinterHeartbeat | null;
    try {
      body = this.buildHeartbeat();
    } catch (err) {
      this.moveTo('not_built', () => this.logger.error('heartbeat.not_built', { error: redactError(err) }));
      return;
    }
    if (body === null) return;

    let reply: AobPrinterHeartbeatReply;
    try {
      reply = await this.client.beat(body, signal);
    } catch (err) {
      // A stop aborted it: not a failure of the link, and nothing to say.
      if (signal.aborted) return;
      const status = refusalStatus(err);
      if (status !== null) {
        this.moveTo('refused', () =>
          this.logger.error('heartbeat.refused', { status, note: 'the platform will not take this host’s heartbeat; it needs a human' }),
        );
      } else {
        this.moveTo('unreachable', () => this.logger.warn('heartbeat.unreachable', { error: redactError(err) }));
      }
      return;
    }

    if (this.link !== 'ok' && this.link !== 'unknown') this.logger.info('heartbeat.recovered', { was: this.link });
    this.link = 'ok';
    try {
      this.applyReply(body, reply);
    } catch (err) {
      this.logger.error('heartbeat.reply_not_applied', { error: redactError(err) });
    }
  }

  /** Say a change of state once; staying in it says nothing. */
  private moveTo(state: LinkState, say: () => void): void {
    if (this.link !== state) say();
    this.link = state;
  }

  /**
   * The body, every field named. Null only for a database with no events,
   * which a running host never has (`program.started` is always seq 1).
   */
  buildHeartbeat(): AobPrinterHeartbeat | null {
    const now = this.now();
    const chainId = this.store.chainId();
    if (chainId === null) return null;
    const head = this.store.auditHead();
    const atAnchor: AobPrinterChainPoint | undefined =
      this.anchorSeq === undefined ? undefined : { seq: this.anchorSeq, hash: this.store.auditHashAt(this.anchorSeq) };
    const localCheck = this.checkChain(now);
    const snapshot = this.store.heartbeatSnapshot(now, AOBPRINTER_HEARTBEAT_LIMITS.sentWindowDays, AOBPRINTER_HEARTBEAT_LIMITS);
    return {
      chainId,
      head: { seq: head.seq, hash: head.hash },
      atAnchor,
      localCheck,
      counts: snapshot.counts,
      openExceptions: snapshot.openExceptions,
      printerVersion: this.facts.printerVersion,
      templateVersion: this.facts.templateVersion,
      schemaVersion: SCHEMA_VERSION,
      runtimeVersion: process.version,
      startedAt: this.facts.startedAt,
      sentAt: now.toISOString(),
      intervalMs: this.facts.intervalMs,
      queueCount: this.facts.queueCount,
      collecting: this.facts.collecting,
      retentionEnabled: this.facts.retentionEnabled,
      awaitingOutcome: snapshot.awaitingOutcome,
      filedUnconfirmed: snapshot.filedUnconfirmed,
    };
  }

  /**
   * One chunk forward from the frontier. A break is reported every beat and
   * logged once at error level — never as a local audit event, because
   * appending to a chain already known to be broken muddies the forensics
   * (decision 14). The frontier stays where it was, so the break is found
   * again next beat.
   */
  private checkChain(now: Date): AobPrinterLocalCheck {
    if (now.getTime() - this.frontierResetAt >= HEARTBEAT_FRONTIER_RESET_MS) {
      this.frontier = { seq: 0, hash: GENESIS_HASH };
      this.frontierResetAt = now.getTime();
    }
    const step = this.store.verifyAuditRange(this.frontier.seq, this.frontier.hash, this.verifyChunk);
    if (!step.ok) {
      if (this.loggedBrokenAt !== step.brokenAtSeq) {
        this.loggedBrokenAt = step.brokenAtSeq;
        this.logger.error('heartbeat.local_check_failed', { brokenAtSeq: step.brokenAtSeq, why: step.why });
      }
      return { ok: false, brokenAtSeq: step.brokenAtSeq, why: step.why };
    }
    this.frontier = { seq: step.throughSeq, hash: step.hash };
    return { ok: true, verifiedThroughSeq: step.throughSeq };
  }

  /**
   * What the platform said, recorded. ONLY ABOUT WHAT THIS BEAT ASKED: a job
   * or a return the host did not name is not the host's to record.
   */
  applyReply(body: AobPrinterHeartbeat, reply: AobPrinterHeartbeatReply): void {
    const anchorSeq = reply?.chain?.anchorSeq;
    if (Number.isInteger(anchorSeq) && anchorSeq >= 0) this.anchorSeq = anchorSeq;

    const asked = new Set(body.awaitingOutcome);
    for (const job of Array.isArray(reply.jobs) ? reply.jobs : []) {
      if (!asked.has(job.sourceSha256)) continue;
      this.store.recordPlatformOutcome(job.sourceSha256, job);
    }

    const filed = new Map<string, AobPrinterFiledReturn>(body.filedUnconfirmed.map((r) => [r.agreementId, r]));
    for (const outcome of Array.isArray(reply.returns) ? reply.returns : []) {
      const ours = filed.get(outcome.agreementId);
      if (!ours || !outcome.writtenBack) continue;
      if (outcome.sha256Matches) {
        this.store.returnConfirmedByPlatform({ agreementId: ours.agreementId, sha256: ours.sha256 });
      } else if (!this.hashDiffersSaid.has(ours.agreementId)) {
        /*
         * The platform recorded a different file as written back. It stays
         * filed — confirming it would say the practice holds what it does not
         * — and it is said once, not every minute.
         */
        this.hashDiffersSaid.add(ours.agreementId);
        this.logger.warn('heartbeat.return_hash_differs', { agreementId: ours.agreementId });
      }
    }
  }
}
