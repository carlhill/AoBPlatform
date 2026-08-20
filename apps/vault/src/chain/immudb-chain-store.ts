import { randomUUID } from 'node:crypto';
import ImmudbClient from 'immudb-node';
import type { VaultEventInput, VaultEventRecord } from '@aobplatform/contracts';
import type { IsoTimestamp, VaultEventId } from '@aobplatform/domain';
import type { ChainStore } from './chain-store';
import { computeEntryHash, GENESIS_HASH } from './hash';
import type { VaultPrismaService } from '../prisma/prisma.service';

/**
 * immudb-backed chain store — AGENT-AUTHORED AT CARL'S EXPLICIT INSTRUCTION
 * (21 Aug 2026) in what the build plan designates a human-authored zone;
 * pending his review before production reliance. It passes the same
 * chainStoreContractTests() as the reference store, against a real immudb.
 *
 * ARCHITECTURE — index in Postgres, evidence in immudb (the pattern proven
 * in ReferralPlatform's audit-log): every chain entry is verifiedSet into
 * immudb (client-side Merkle proof on write), and a locator row lands in the
 * vault Postgres schema. All reads resolve KEYS via the index first and only
 * then verifiedGet from immudb. This is not an optimisation — probing
 * immudb-node@1.1.1 (2026-08-21) showed any missing-key lookup (verifiedGet,
 * get, even scan-adjacent paths) permanently poisons the client's local
 * verification state, after which every read resolves undefined. With the
 * index, the store NEVER looks up a key that might not exist. The index is
 * not the evidence: deleting index rows is truncation, which the hash chain
 * plus external anchoring are designed to catch.
 *
 * Still TODO(HUMAN) — key management, explicitly out of scope here:
 * per-entry signing with a segregated HSM key (REQ-LOG-02), hourly Merkle
 * root + RFC 3161 anchoring (REQ-LOG-03/REQ-VAULT-03), S3 Object Lock
 * artefact buckets.
 *
 * Client quirks inherited from ReferralPlatform's integration:
 *  - autoLogin/autoDatabase disabled (the convenience path reads different
 *    env names and can silently retarget the wrong database on warm restart);
 *  - verifiedGet resolves value as decoded UTF-8 — never base64-decode it.
 *
 * Single-writer assumption: appends serialise in-process; a multi-instance
 * vault needs a distributed claim (TODO, documented).
 */
export interface ImmudbChainStoreConfig {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  /** Chain namespace — one logical chain per namespace. Production: 'aobvault'. */
  namespace: string;
  /**
   * Where immudb-node persists its local Merkle root state. The library
   * default is a file literally named `root` in the process CWD — stale or
   * corrupt state there silently breaks every verified operation (found by
   * probe). Always set explicitly; gitignored.
   */
  statePath: string;
}

export class ImmudbChainStore implements ChainStore {
  private client!: InstanceType<typeof ImmudbClient>;
  private appending: Promise<unknown> = Promise.resolve();
  private initialised = false;

  constructor(
    private readonly config: ImmudbChainStoreConfig,
    private readonly prisma: VaultPrismaService,
  ) {}

  async init(): Promise<void> {
    this.client = await ImmudbClient.getInstance({
      host: this.config.host,
      port: this.config.port,
      rootPath: this.config.statePath,
      autoLogin: false,
      autoDatabase: false,
    });
    await this.client.login({ user: this.config.username, password: this.config.password });
    const dbList = await this.client.listDatabases();
    const exists = dbList?.databasesList?.some(
      (db: { databasename: string }) => db.databasename === this.config.database,
    );
    if (!exists) {
      await this.client.createDatabase({ databasename: this.config.database });
    }
    await this.client.useDatabase({ databasename: this.config.database });
    this.initialised = true;
  }

  private assertInitialised(): void {
    if (!this.initialised) throw new Error('ImmudbChainStore.init() has not completed.');
  }

  private key(seq: number): string {
    return `${this.config.namespace}:evt:${String(seq).padStart(10, '0')}`;
  }

  /** Reads a KNOWN-PRESENT entry from immudb; unreadable evidence is an alarm, never a silent undefined. */
  private async readEntry(seq: number): Promise<VaultEventRecord> {
    const entry = await this.client.verifiedGet({ key: this.key(seq) });
    if (!entry || typeof entry.value !== 'string') {
      throw new Error(
        `Chain entry ${this.key(seq)} is indexed but unreadable from immudb — evidence integrity alarm.`,
      );
    }
    return JSON.parse(entry.value) as VaultEventRecord;
  }

  append(event: VaultEventInput): Promise<VaultEventRecord> {
    this.assertInitialised();
    const result = this.appending.then(async () => {
      const last = await this.prisma.chainEntryIndex.findFirst({
        where: { namespace: this.config.namespace },
        orderBy: { seq: 'desc' },
      });
      const seq = (last?.seq ?? 0) + 1;
      const base = {
        id: randomUUID() as string as VaultEventId,
        type: event.type,
        actor: event.actor,
        subject: event.subject,
        payload: event.payload ?? {},
        recordedAt: new Date().toISOString() as IsoTimestamp,
        previousHash: last?.hash ?? GENESIS_HASH,
      };
      const record: VaultEventRecord = { ...base, hash: computeEntryHash(base) };

      // Evidence first (immudb, proof-verified write), locator second. A
      // crash between the two orphans an immudb entry — recoverable and
      // harmless; the reverse order could index evidence that never landed.
      const meta = await this.client.verifiedSet({ key: this.key(seq), value: JSON.stringify(record) });
      if (!meta) throw new Error('immudb verifiedSet returned no transaction metadata — write not proven.');

      const artefactSha256 = (record.payload as Record<string, unknown>)?.artefactSha256;
      await this.prisma.chainEntryIndex.create({
        data: {
          namespace: this.config.namespace,
          seq,
          eventId: record.id,
          eventType: record.type,
          subjectType: record.subject.type,
          subjectId: record.subject.id,
          recordedAt: new Date(record.recordedAt),
          hash: record.hash,
          artefactSha256: typeof artefactSha256 === 'string' ? artefactSha256 : null,
          immudbTxId: String(meta.id),
        },
      });
      return record;
    });
    this.appending = result.catch(() => undefined);
    return result;
  }

  async all(): Promise<readonly VaultEventRecord[]> {
    this.assertInitialised();
    const rows = await this.prisma.chainEntryIndex.findMany({
      where: { namespace: this.config.namespace },
      orderBy: { seq: 'asc' },
    });
    return Promise.all(rows.map((row) => this.readEntry(row.seq)));
  }

  async list(query: {
    subjectId?: string;
    from?: IsoTimestamp;
    to?: IsoTimestamp;
  }): Promise<readonly VaultEventRecord[]> {
    this.assertInitialised();
    const rows = await this.prisma.chainEntryIndex.findMany({
      where: {
        namespace: this.config.namespace,
        subjectId: query.subjectId,
        recordedAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      },
      orderBy: { seq: 'asc' },
    });
    return Promise.all(rows.map((row) => this.readEntry(row.seq)));
  }

  async head(): Promise<VaultEventRecord | undefined> {
    this.assertInitialised();
    const last = await this.prisma.chainEntryIndex.findFirst({
      where: { namespace: this.config.namespace },
      orderBy: { seq: 'desc' },
    });
    return last ? this.readEntry(last.seq) : undefined;
  }

  async findByArtefactHash(sha256: string): Promise<VaultEventRecord | undefined> {
    this.assertInitialised();
    const row = await this.prisma.chainEntryIndex.findFirst({
      where: { namespace: this.config.namespace, artefactSha256: sha256 },
      orderBy: { seq: 'asc' },
    });
    return row ? this.readEntry(row.seq) : undefined;
  }
}
