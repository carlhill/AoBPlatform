import { Test } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Prisma } from '@prisma/client';
import type { AobPrinterHeartbeatReply, AobPrinterHostsView, ValidationResponse } from '@aobplatform/contracts';
import { SERVICE_DESCRIPTIONS, laneFor } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { AobPrinterHostsSweep } from '../src/aobprinter-hosts/aobprinter-hosts.sweep';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

/**
 * THE AOBPRINTER HEARTBEAT, THE PLATFORM SIDE (PRINTER-HEARTBEAT.md §3 and §5,
 * D-2026-10-10-02 and its amendment).
 *
 * Every minute the host at a practice posts counts, versions and the head of
 * its local audit chain to `POST /inbound/print-jobs/heartbeat`. The platform
 * records the host, judges the chain with the domain verdict inside one
 * `withPractice` transaction that holds the row `FOR UPDATE`, writes any vault
 * event the verdict implies through the outbox in that same transaction (hard
 * rule 11), and answers what it knows of the prints and returns the host asked
 * about.
 *
 * WHAT THIS SUITE PINS:
 *  - the door: the URL answers, above `:id`, with a whitelisted body and
 *    `Cache-Control: no-store`, and a practice that has not bought `db4` is
 *    refused it;
 *  - the chain: one vault event on the transition into `regressed`, a flag
 *    that stays, an anchor in the vault at most hourly, and a second chain
 *    that is ALWAYS `chain_replaced` (Carl, 10 Oct) and raises the two-hosts
 *    notice as well;
 *  - the reply: the platform's outcome for every print asked about, and the
 *    written-back state of every return;
 *  - tenancy fails closed, the overview and the re-baseline are the
 *    platform's alone, and no identifier value reaches a vault event (hard
 *    rule 9);
 *  - silence: the five-minute sweep says ALERT once when a host goes quiet
 *    and once when it comes back, and writes no vault event (decision 3).
 */

const STAFF = {
  sub: '00000000-0000-4000-8000-0000000a0b01',
  principalType: 'staff',
  roles: ['practice_admin'],
  preferredUsername: 'pat.admin',
  raw: {},
};
const OPERATOR = {
  sub: '00000000-0000-4000-8000-0000000a0b02',
  principalType: 'platform',
  roles: ['platform_admin'],
  preferredUsername: 'ops.example',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

/** A platform operator on a passkey, signed in `ageSeconds` ago. */
function operator(ageSeconds = 0): void {
  currentPrincipal = { ...OPERATOR, amr: ['hwk'], authTime: Math.floor(Date.now() / 1000) - ageSeconds };
}

const D6A = SERVICE_DESCRIPTIONS[0];

const permissiveRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** The hash a host would hold at `seq` on chain `chain`. */
const at = (chain: string, seq: number) => sha(`${chain}:${seq}`);

describe('the AOBPRINTER heartbeat, platform side (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();
  const practiceStandard = randomUUID();
  const CHAIN_A = sha(`chain-a-${practiceA}`);
  const CHAIN_B = sha(`chain-b-${practiceA}`);
  const CHAIN_C = sha(`chain-c-${practiceA}`);

  let providerA: string;
  let patientA: string;
  let assignorA: string;

  const http = () => request(app.getHttpServer());

  /** A full, valid heartbeat for `practiceA`'s first chain, with overrides. */
  function body(over: Record<string, unknown> = {}): Record<string, unknown> {
    const now = new Date().toISOString();
    return {
      chainId: CHAIN_A,
      head: { seq: 10, hash: at(CHAIN_A, 10) },
      localCheck: { ok: true, verifiedThroughSeq: 10 },
      counts: {
        prints: { received: 0, parse_exception: 0, queued: 2, sent: 3, send_exception: 1 },
        returns: { received: 0, received_exception: 0, filed: 1, filing_exception: 0, confirmed: 4 },
        openExceptions: { parse: 0, send: 1, received: 0, filing: 0 },
        oldestQueuedAt: now,
        oldestFiledUnconfirmedAt: null,
        staleQueued: 0,
        gapsLast24h: 0,
      },
      openExceptions: [],
      printerVersion: '1.4.0',
      templateVersion: 'db4-2026-09-1',
      schemaVersion: 3,
      runtimeVersion: 'v22.11.0',
      startedAt: now,
      sentAt: now,
      intervalMs: 60_000,
      queueCount: 2,
      collecting: true,
      retentionEnabled: false,
      awaitingOutcome: [],
      filedUnconfirmed: [],
      ...over,
    };
  }

  const beat = (practiceId: string, over: Record<string, unknown> = {}) =>
    http()
      .post('/inbound/print-jobs/heartbeat')
      .set('x-practice-id', practiceId)
      .set('x-aobprinter-version', '1.4.0')
      .set('x-read-by', 'aobprinter')
      .send(body(over));

  async function hostsOf(practiceId: string) {
    return prisma.withPractice(practiceId, (tx) => tx.aobPrinterHost.findMany({ orderBy: { lastSeenAt: 'asc' } }));
  }

  async function aobprinterEvents(type?: string) {
    const rows = await prisma.vaultOutbox.findMany({ where: { subjectType: 'AobPrinterHost' } });
    return rows.filter((r) => (type ? r.type === type : r.type.startsWith('aobprinter.')));
  }

  /** Beat seq 10, then seq 12 answering the anchor at 10: a consistent chain. */
  async function consistentChain(): Promise<void> {
    expect((await beat(practiceA)).status).toBe(200);
    const res = await beat(practiceA, {
      head: { seq: 12, hash: at(CHAIN_A, 12) },
      atAnchor: { seq: 10, hash: at(CHAIN_A, 10) },
    });
    expect((res.body as AobPrinterHeartbeatReply).chain).toEqual({ status: 'consistent', anchorSeq: 12 });
  }

  /** A consistent chain, then a head that goes backwards. */
  async function regressedChain(): Promise<string> {
    await consistentChain();
    const res = await beat(practiceA, { head: { seq: 11, hash: at(CHAIN_A, 11) } });
    expect((res.body as AobPrinterHeartbeatReply).chain.status).toBe('regressed');
    const [row] = await hostsOf(practiceA);
    return row.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(permissiveRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.practice.create({
        data: { id: practiceA, name: 'Heartbeat Host Practice A', surfaceProfile: 'db4' },
      });
      providerA = (
        await createServicingProvider(tx, practiceA, { name: 'Dr Example Provider', providerType: 'general_practitioner' })
      ).id;
      patientA = (
        await tx.patient.create({
          data: {
            practiceId: practiceA,
            familyName: 'Fictitious',
            givenNames: 'Robin',
            dateOfBirth: new Date('1961-07-02'),
            address: '1 Nowhere Lane, Sydney NSW 2000',
          },
        })
      ).id;
      assignorA = (
        await tx.assignor.create({ data: { practiceId: practiceA, name: 'Robin Fictitious', authorityBasis: 'self' } })
      ).id;
    });
    await prisma.withPractice(practiceB, (tx) =>
      tx.practice.create({ data: { id: practiceB, name: 'Heartbeat Host Practice B', surfaceProfile: 'db4' } }),
    );
    await prisma.withPractice(practiceStandard, (tx) =>
      tx.practice.create({
        data: { id: practiceStandard, name: 'Heartbeat Host Practice Standard', surfaceProfile: 'standard' },
      }),
    );
  });

  beforeEach(async () => {
    currentPrincipal = null;
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.aobPrinterHost.deleteMany({});
        await tx.inboundPrintJob.deleteMany({});
        await tx.agreement.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({ where: { subjectType: 'AobPrinterHost' } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB, practiceStandard]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.aobPrinterHost.deleteMany({});
        await tx.inboundPrintJob.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({ where: { subjectType: 'AobPrinterHost' } });
    await app.close();
  });

  it('the_heartbeat_answers_at_inbound_print_jobs_heartbeat', async () => {
    const res = await beat(practiceA);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const reply = res.body as AobPrinterHeartbeatReply;
    expect(Number.isNaN(Date.parse(reply.receivedAt))).toBe(false);
    // A first beat is unverified, and names the seq to answer at next time.
    expect(reply.chain).toEqual({ status: 'unverified', anchorSeq: 10 });
    expect(reply.jobs).toEqual([]);
    expect(reply.returns).toEqual([]);
  });

  it('aobprinter_heartbeat_strips_anything_not_declared', async () => {
    const res = await beat(practiceA, {
      patientName: 'Robin Fictitious',
      notes: 'free text the host should never send',
      openExceptions: [
        {
          direction: 'out',
          stage: 'send_exception',
          reason: 'platform_refused',
          since: new Date().toISOString(),
          sourceSha256: sha('a print'),
          formReference: 'FORM-REF-0001',
          path: 'C:\\prints\\one.prn',
        },
      ],
    });
    expect(res.status).toBe(200);
    const [row] = await hostsOf(practiceA);
    const stored = JSON.stringify(row);
    for (const value of ['Robin Fictitious', 'free text the host', 'FORM-REF-0001', 'one.prn']) {
      expect(stored).not.toContain(value);
    }
    expect(row.openExceptions).toEqual([
      expect.objectContaining({ direction: 'out', stage: 'send_exception', reason: 'platform_refused' }),
    ]);

    // And what the DTO declares, it checks: a reason that is not a code, a
    // hash that is not a hash, and a version with a space are each refused.
    const badReason = await beat(practiceA, {
      openExceptions: [
        { direction: 'out', stage: 'send_exception', reason: 'Not A Code', since: new Date().toISOString() },
      ],
    });
    expect(badReason.status).toBe(400);
    expect((await beat(practiceA, { chainId: 'not-a-hash' })).status).toBe(400);
    expect((await beat(practiceA, { printerVersion: '1.4 beta' })).status).toBe(400);
    expect((await beat(practiceA, { awaitingOutcome: Array.from({ length: 101 }, (_, i) => sha(`p${i}`)) })).status).toBe(
      400,
    );
  });

  it('a_local_check_carrying_extra_text_is_stored_without_it', async () => {
    // A passing check that also carries the failing shape's fields: only what `ok: true` declares is kept.
    const passing = await beat(practiceA, {
      localCheck: { ok: true, verifiedThroughSeq: 10, brokenAtSeq: 4, why: 'link' },
    });
    expect(passing.status).toBe(200);
    expect((await hostsOf(practiceA))[0].localCheck).toEqual({ ok: true, verifiedThroughSeq: 10 });

    // And a failing one: no `verifiedThroughSeq` rides along.
    const failing = await beat(practiceA, {
      localCheck: { ok: false, brokenAtSeq: 4, why: 'content', verifiedThroughSeq: 3 },
    });
    expect(failing.status).toBe(200);
    expect((await hostsOf(practiceA))[0].localCheck).toEqual({ ok: false, brokenAtSeq: 4, why: 'content' });

    // Free text in `why`, or a seq that is not an integer, is refused whatever `ok` says.
    for (const localCheck of [
      { ok: true, verifiedThroughSeq: 1, why: 'the operator typed something here' },
      { ok: false, brokenAtSeq: 4, why: 'the operator typed something here' },
      { ok: true, verifiedThroughSeq: 1, brokenAtSeq: 2.5 },
      { ok: false, brokenAtSeq: 4, why: 'link', verifiedThroughSeq: 'ten' },
      { ok: true },
      { ok: false, brokenAtSeq: 4 },
    ]) {
      expect((await beat(practiceA, { localCheck })).status).toBe(400);
    }
    expect(JSON.stringify((await hostsOf(practiceA))[0])).not.toContain('the operator typed');
  });

  it('a_chain_point_without_its_hash_is_refused_and_an_explicit_null_is_written', async () => {
    // Omitting the hash is refused: undefined would leave the stored hash behind a new seq.
    expect((await beat(practiceA, { head: { seq: 10 } })).status).toBe(400);
    expect((await beat(practiceA, { atAnchor: { seq: 10 } })).status).toBe(400);
    expect(await hostsOf(practiceA)).toEqual([]);

    expect((await beat(practiceA)).status).toBe(200);
    // An explicit null is a value: the head and the anchor move together, hash and all.
    const res = await beat(practiceA, { head: { seq: 11, hash: null } });
    expect(res.status).toBe(200);
    const [row] = await hostsOf(practiceA);
    expect(row.headSeq).toBe(11);
    expect(row.headHash).toBeNull();
    expect(row.anchorSeq).toBe(10);
    expect(row.anchorHash).toBe(at(CHAIN_A, 10));
  });

  it('a_heartbeat_records_last_seen_versions_and_stage_counts', async () => {
    const hostClock = new Date(Date.now() + 7 * 60 * 1000).toISOString();
    expect((await beat(practiceA, { sentAt: hostClock })).status).toBe(200);

    currentPrincipal = { ...STAFF, practiceId: practiceA };
    const res = await http().get('/aobprinter-hosts').set('x-practice-id', practiceA);
    expect(res.status).toBe(200);
    const view = res.body as AobPrinterHostsView;
    expect(view.secondHostReporting).toBe(false);
    expect(view.hosts).toHaveLength(1);
    const host = view.hosts[0];
    expect(host.practiceId).toBe(practiceA);
    expect(host.chainId).toBe(CHAIN_A);
    expect(host.printerVersion).toBe('1.4.0');
    expect(host.templateVersion).toBe('db4-2026-09-1');
    expect(host.schemaVersion).toBe(3);
    expect(host.runtimeVersion).toBe('v22.11.0');
    expect(host.intervalMs).toBe(60_000);
    expect(host.queueCount).toBe(2);
    expect(host.collecting).toBe(true);
    expect(host.counts.prints).toEqual({ received: 0, parse_exception: 0, queued: 2, sent: 3, send_exception: 1 });
    expect(host.counts.returns.confirmed).toBe(4);
    expect(host.liveness).toBe('live');
    expect(host.head).toEqual({ seq: 10, hash: at(CHAIN_A, 10) });
    expect(host.chain).toEqual({ status: 'unverified', regression: null, anchorSeq: 10, anchorVerifiedAt: null });
    // The host's clock is seven minutes ahead; the server says so.
    expect(host.clockSkewMs).toBeGreaterThan(6 * 60 * 1000);
    expect(host.clockSkewMs).toBeLessThan(8 * 60 * 1000);
  });

  it('a_chain_regression_writes_one_vault_event_and_stays_flagged', async () => {
    const alerts = jest.spyOn(Logger.prototype, 'error');
    await regressedChain();
    // A second bad beat, and a good-looking one: still regressed, no second event.
    expect((await beat(practiceA, { head: { seq: 9, hash: at(CHAIN_A, 9) } })).body.chain.status).toBe('regressed');
    expect(
      (
        await beat(practiceA, {
          head: { seq: 13, hash: at(CHAIN_A, 13) },
          atAnchor: { seq: 12, hash: at(CHAIN_A, 12) },
        })
      ).body.chain.status,
    ).toBe('regressed');

    const events = await aobprinterEvents('aobprinter.chain_regressed');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      practiceId: practiceA,
      chainId: CHAIN_A,
      kind: 'went_backwards',
      expectedSeq: 12,
      expectedHash: at(CHAIN_A, 12),
      receivedSeq: 11,
      receivedHash: at(CHAIN_A, 11),
    });
    const regressionAlerts = alerts.mock.calls.filter((c) => String(c[0]).includes('ALERT') && String(c[0]).includes('regressed'));
    expect(regressionAlerts).toHaveLength(1);

    currentPrincipal = { ...STAFF, practiceId: practiceA };
    const view = (await http().get('/aobprinter-hosts').set('x-practice-id', practiceA)).body as AobPrinterHostsView;
    expect(view.hosts[0].chain.status).toBe('regressed');
    expect(view.hosts[0].chain.regression).toMatchObject({
      kind: 'went_backwards',
      expected: { seq: 12, hash: at(CHAIN_A, 12) },
      received: { seq: 11, hash: at(CHAIN_A, 11) },
    });
    // The head is updated even on a regressed row; the anchor is not moved.
    expect(view.hosts[0].head.seq).toBe(13);
    expect(view.hosts[0].chain.anchorSeq).toBe(12);
  });

  it('the_chain_anchor_reaches_the_vault_at_most_hourly', async () => {
    await consistentChain();
    expect(await aobprinterEvents('aobprinter.chain_anchored')).toHaveLength(1);

    // Advanced and consistent again a minute later: not another anchor.
    const again = await beat(practiceA, {
      head: { seq: 14, hash: at(CHAIN_A, 14) },
      atAnchor: { seq: 12, hash: at(CHAIN_A, 12) },
    });
    expect(again.body.chain).toEqual({ status: 'consistent', anchorSeq: 14 });
    expect(await aobprinterEvents('aobprinter.chain_anchored')).toHaveLength(1);

    // An hour on, the next consistent, advanced beat anchors again.
    await prisma.withPractice(practiceA, (tx) =>
      tx.aobPrinterHost.updateMany({ data: { vaultAnchoredAt: new Date(Date.now() - 61 * 60 * 1000) } }),
    );
    await beat(practiceA, { head: { seq: 16, hash: at(CHAIN_A, 16) }, atAnchor: { seq: 14, hash: at(CHAIN_A, 14) } });
    const anchors = await aobprinterEvents('aobprinter.chain_anchored');
    expect(anchors).toHaveLength(2);
    expect(anchors.map((e) => (e.payload as { seq: number }).seq).sort((a, b) => a - b)).toEqual([12, 16]);

    // An hour on but the head has not moved: nothing new to anchor. (Both
    // times move back together, as an hour passing would move them.)
    await prisma.withPractice(practiceA, (tx) =>
      tx.aobPrinterHost.updateMany({
        data: {
          vaultAnchoredAt: new Date(Date.now() - 61 * 60 * 1000),
          headAdvancedAt: new Date(Date.now() - 61 * 60 * 1000),
        },
      }),
    );
    await beat(practiceA, { head: { seq: 16, hash: at(CHAIN_A, 16) }, atAnchor: { seq: 16, hash: at(CHAIN_A, 16) } });
    expect(await aobprinterEvents('aobprinter.chain_anchored')).toHaveLength(2);
  });

  it('the_reply_carries_processed_by_aob_for_each_job_asked_about', async () => {
    const agreementId = randomUUID();
    const job = (sourceSha256: string, state: string, outcome: Record<string, unknown> | null) =>
      prisma.withPractice(practiceA, (tx) =>
        tx.inboundPrintJob.create({
          data: {
            practiceId: practiceA,
            documentType: 'db4_assignment',
            lane: laneFor('db4_assignment'),
            pms: 'pracsoft',
            parserTemplateVersion: 'test',
            sourceSha256,
            payload: {},
            state,
            ...(state === 'done' ? { processedAt: new Date() } : {}),
            ...(outcome ? { outcome: outcome as Prisma.InputJsonValue } : {}),
          },
        }),
      );
    await job(sha('placed'), 'done', { db4: { placed: true, reason: null, agreementId } });
    await job(sha('refused'), 'done', { db4: { placed: false, reason: 'no_chart_number', agreementId: null } });
    await job(sha('pending'), 'pending', null);
    await job(sha('failed'), 'failed', null);
    await job(sha('dead'), 'dead', null);

    const asked = ['placed', 'refused', 'pending', 'failed', 'dead', 'never-sent'].map(sha);
    const res = await beat(practiceA, { awaitingOutcome: asked });
    expect(res.status).toBe(200);
    expect((res.body as AobPrinterHeartbeatReply).jobs).toEqual([
      { sourceSha256: sha('placed'), state: 'done', placed: true, reason: null, agreementId },
      { sourceSha256: sha('refused'), state: 'done', placed: false, reason: 'no_chart_number', agreementId: null },
      { sourceSha256: sha('pending'), state: 'waiting', placed: null, reason: null, agreementId: null },
      { sourceSha256: sha('failed'), state: 'waiting', placed: null, reason: null, agreementId: null },
      { sourceSha256: sha('dead'), state: 'dead', placed: null, reason: null, agreementId: null },
      { sourceSha256: sha('never-sent'), state: 'unknown', placed: null, reason: null, agreementId: null },
    ]);
  });

  it('the_reply_says_written_back_for_a_return_the_platform_recorded', async () => {
    const signed = sha('the signed db4');
    const agreementId = await prisma.withPractice(practiceA, async (tx) => {
      const agreement = await tx.agreement.create({
        data: {
          practiceId: practiceA,
          type: 'episodic_pre',
          anchorKind: 'provider',
          affiliationId: providerA,
          patientId: patientA,
          assignorId: assignorA,
          assignorIsPatient: true,
          assignorConfirmedAt: new Date(),
          status: 'draft',
          serviceDescription: D6A,
          signedDb4Sha256: signed,
          writtenBackAt: new Date(),
        },
      });
      return agreement.id;
    });
    const unknownAgreement = randomUUID();

    const res = await beat(practiceA, {
      filedUnconfirmed: [
        { agreementId, sha256: signed },
        { agreementId: unknownAgreement, sha256: sha('something else') },
        // The same agreement, filed on the host as a DIFFERENT file from the one the platform wrote back.
        { agreementId, sha256: sha('a different file') },
      ],
    });
    expect(res.status).toBe(200);
    expect((res.body as AobPrinterHeartbeatReply).returns).toEqual([
      { agreementId, writtenBack: true, sha256Matches: true, listed: false },
      { agreementId: unknownAgreement, writtenBack: false, sha256Matches: false, listed: false },
      { agreementId, writtenBack: true, sha256Matches: false, listed: false },
    ]);

    // The console reads the same answer, with the patient resolved on the server. A
    // different file is its own verdict: the host keeps it filed, so it never confirms.
    currentPrincipal = { ...STAFF, practiceId: practiceA };
    const view = (await http().get('/aobprinter-hosts').set('x-practice-id', practiceA)).body as AobPrinterHostsView;
    expect(view.hosts[0].filedUnconfirmed).toEqual([
      { agreementId, sha256: signed, verdict: 'written_back', patientId: patientA },
      { agreementId: unknownAgreement, sha256: sha('something else'), verdict: 'not_offered', patientId: null },
      { agreementId, sha256: sha('a different file'), verdict: 'written_back_different_file', patientId: patientA },
    ]);
  });

  it('aobprinter_hosts_are_practice_scoped_and_a_cross_practice_read_fails_closed', async () => {
    expect((await beat(practiceA)).status).toBe(200);

    currentPrincipal = { ...STAFF, practiceId: practiceB };
    const res = await http().get('/aobprinter-hosts').set('x-practice-id', practiceB);
    expect(res.status).toBe(200);
    expect((res.body as AobPrinterHostsView).hosts).toEqual([]);

    // RLS, beneath the service: practice B's scope sees none of A's rows, and
    // cannot write one with A's practice id.
    expect(await hostsOf(practiceB)).toEqual([]);
    const [rowA] = await hostsOf(practiceA);
    await expect(
      prisma.withPractice(practiceB, (tx) =>
        tx.aobPrinterHost.create({
          data: { ...rowA, id: randomUUID(), chainId: sha('forged'), counts: {}, openExceptions: [], filedUnconfirmed: [], localCheck: {}, regressionDetail: undefined },
        }),
      ),
    ).rejects.toThrow();
    // And outside any scope, nothing at all.
    expect(await prisma.aobPrinterHost.findMany({})).toEqual([]);
  });

  it('a_practice_on_the_standard_profile_is_refused_the_heartbeat', async () => {
    const res = await beat(practiceStandard);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('practice_surface_not_in_use');
    expect(await hostsOf(practiceStandard)).toEqual([]);
  });

  it('no_identifier_value_reaches_a_heartbeat_vault_event', async () => {
    const hostId = await regressedChain();
    operator();
    expect((await http().post(`/aobprinter-hosts/${hostId}/rebaseline`).send({ reasonCode: 'investigated' })).status).toBe(
      200,
    );
    const events = await aobprinterEvents();
    expect(events.map((e) => e.type).sort()).toEqual([
      'aobprinter.chain_anchored',
      'aobprinter.chain_rebaselined',
      'aobprinter.chain_regressed',
    ]);
    const allowed = new Set([
      'practiceId',
      'chainId',
      'seq',
      'hash',
      'kind',
      'expectedSeq',
      'expectedHash',
      'receivedSeq',
      'receivedHash',
      'reasonCode',
      'reasonsVersion',
      'previousKind',
      'anchorSeq',
      'anchorHash',
      'retiredChains',
    ]);
    for (const event of events) {
      for (const key of Object.keys(event.payload as Record<string, unknown>)) expect(allowed.has(key)).toBe(true);
      const text = JSON.stringify(event);
      for (const value of ['Fictitious', 'Robin', '1961-07-02', 'Nowhere Lane', patientA, assignorA]) {
        expect(text).not.toContain(value);
      }
    }
  });

  it('the_platform_overview_needs_platform_admin', async () => {
    expect((await beat(practiceA)).status).toBe(200);

    currentPrincipal = { ...STAFF, practiceId: practiceA };
    expect((await http().get('/platform/aobprinter-hosts')).status).toBe(403);

    operator();
    const res = await http().get('/platform/aobprinter-hosts');
    expect(res.status).toBe(200);
    const rows = (res.body as { hosts: Record<string, unknown>[] }).hosts.filter((r) => r.practiceId === practiceA);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        'practiceId',
        'practiceName',
        'liveness',
        'chainStatus',
        'regressionKind',
        'localCheckOk',
        'secondHostReporting',
        'lastSeenAt',
        'printerVersion',
        'openExceptions',
        'filedUnconfirmed',
        'staleQueued',
        'clockSkewMs',
      ].sort(),
    );
    expect(rows[0]).toMatchObject({
      practiceName: 'Heartbeat Host Practice A',
      liveness: 'live',
      chainStatus: 'unverified',
      regressionKind: null,
      localCheckOk: true,
      secondHostReporting: false,
      printerVersion: '1.4.0',
      openExceptions: 1,
      filedUnconfirmed: 1,
      staleQueued: 0,
    });
  });

  it('rebaseline_is_the_platform_s_act_and_is_recorded', async () => {
    const hostId = await regressedChain();
    const rebaseline = () => http().post(`/aobprinter-hosts/${hostId}/rebaseline`).send({ reasonCode: 'reinstalled' });

    // The practice may not verify its own evidence.
    currentPrincipal = { ...STAFF, practiceId: practiceA };
    expect((await rebaseline()).status).toBe(403);

    // An operator whose sign-in is an hour old is asked to confirm it is them.
    operator(3600);
    const stale = await rebaseline();
    expect(stale.status).toBe(403);
    expect(stale.body.reasonCode).toBe('reauthentication_required');

    operator();
    const res = await rebaseline();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: hostId, chain: { status: 'unverified', regression: null } });

    const [row] = await hostsOf(practiceA);
    expect(row.chainStatus).toBe('unverified');
    expect(row.regressionKind).toBeNull();
    expect(row.rebaselinedBy).toBe(OPERATOR.sub);
    expect(row.rebaselinedAt).not.toBeNull();
    // The anchor restarts at the head the platform last saw.
    expect(row.anchorSeq).toBe(row.headSeq);

    const events = await aobprinterEvents('aobprinter.chain_rebaselined');
    expect(events).toHaveLength(1);
    expect(events[0].actor).toMatchObject({ id: OPERATOR.sub });
    expect(events[0].payload).toMatchObject({
      practiceId: practiceA,
      chainId: CHAIN_A,
      reasonCode: 'reinstalled',
      previousKind: 'went_backwards',
    });

    // The next good beats verify it afresh. (The host carries no session.)
    currentPrincipal = null;
    const next = await beat(practiceA, { head: { seq: 13, hash: at(CHAIN_A, 13) }, atAnchor: { seq: 11, hash: at(CHAIN_A, 11) } });
    expect(next.body.chain.status).toBe('consistent');

    // A host that is not regressed has nothing to re-baseline; an unknown host is not found.
    operator();
    expect((await rebaseline()).status).toBe(409);
    expect((await http().post(`/aobprinter-hosts/${randomUUID()}/rebaseline`).send({ reasonCode: 'reinstalled' })).status).toBe(404);
  });

  it('rebaseline_refuses_an_unknown_reason_code', async () => {
    const hostId = await regressedChain();
    operator();
    for (const reasonCode of ['because', '', 'Reinstalled']) {
      const res = await http().post(`/aobprinter-hosts/${hostId}/rebaseline`).send({ reasonCode });
      expect(res.status).toBe(400);
    }
    expect((await http().post(`/aobprinter-hosts/${hostId}/rebaseline`).send({})).status).toBe(400);
    const [row] = await hostsOf(practiceA);
    expect(row.chainStatus).toBe('regressed');
    expect(await aobprinterEvents('aobprinter.chain_rebaselined')).toHaveLength(0);
  });

  it('a_second_live_chain_is_chain_replaced_and_raises_second_host_reporting', async () => {
    const alerts = jest.spyOn(Logger.prototype, 'error');
    expect((await beat(practiceA)).status).toBe(200);

    // A chain the platform has never seen, minutes after the first reported.
    const second = await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    expect((second.body as AobPrinterHeartbeatReply).chain.status).toBe('regressed');
    // Both keep reporting: still one event, and the ALERT said once.
    await beat(practiceA);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 4, hash: at(CHAIN_B, 4) } });

    const events = await aobprinterEvents('aobprinter.chain_regressed');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      kind: 'chain_replaced',
      chainId: CHAIN_B,
      expectedSeq: 1,
      expectedHash: CHAIN_A,
      receivedSeq: 1,
      receivedHash: CHAIN_B,
    });
    const twoHostAlerts = alerts.mock.calls.filter((c) => String(c[0]).includes('ALERT') && String(c[0]).includes('two'));
    expect(twoHostAlerts).toHaveLength(1);

    currentPrincipal = { ...STAFF, practiceId: practiceA };
    const view = (await http().get('/aobprinter-hosts').set('x-practice-id', practiceA)).body as AobPrinterHostsView;
    expect(view.secondHostReporting).toBe(true);
    expect(view.hosts).toHaveLength(2);
    const replaced = view.hosts.find((h) => h.chainId === CHAIN_B);
    expect(replaced?.chain.regression?.kind).toBe('chain_replaced');

    operator();
    const overview = (await http().get('/platform/aobprinter-hosts')).body as { hosts: Record<string, unknown>[] };
    const rows = overview.hosts.filter((r) => r.practiceId === practiceA);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.secondHostReporting === true)).toBe(true);
  });

  it('a_same_host_reinstall_raises_no_two_hosts_alert_and_two_chains_both_reporting_raise_one', async () => {
    const alerts = jest.spyOn(Logger.prototype, 'error');
    const twoHostAlerts = () =>
      alerts.mock.calls.filter((c) => String(c[0]).includes('ALERT') && String(c[0]).includes('two audit chains'));

    // A reinstall: the old chain stops, the new one reports minute after minute.
    expect((await beat(practiceA)).status).toBe(200);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 4, hash: at(CHAIN_B, 4) } });
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 5, hash: at(CHAIN_B, 5) } });
    expect(twoHostAlerts()).toHaveLength(0);

    // The old chain reports again: both are running at once. Said once for the episode.
    await beat(practiceA);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 6, hash: at(CHAIN_B, 6) } });
    await beat(practiceA);
    expect(twoHostAlerts()).toHaveLength(1);
  });

  /** The practice view's `secondHostReporting`, and every overview row's for practice A. */
  async function twoHostsNotice(): Promise<{ practice: boolean; overview: unknown[] }> {
    currentPrincipal = { ...STAFF, practiceId: practiceA };
    const view = (await http().get('/aobprinter-hosts').set('x-practice-id', practiceA)).body as AobPrinterHostsView;
    operator();
    const overview = (await http().get('/platform/aobprinter-hosts')).body as { hosts: Record<string, unknown>[] };
    currentPrincipal = null;
    return {
      practice: view.secondHostReporting,
      overview: overview.hosts.filter((r) => r.practiceId === practiceA).map((r) => r.secondHostReporting),
    };
  }

  it('a_same_host_reinstall_shows_no_two_hosts_notice_on_the_console', async () => {
    // The old chain stops; the new one starts and keeps reporting. Both are inside the 15-minute window.
    expect((await beat(practiceA)).status).toBe(200);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 4, hash: at(CHAIN_B, 4) } });

    const notice = await twoHostsNotice();
    expect(notice.practice).toBe(false);
    expect(notice.overview).toEqual([false, false]);
  });

  it('two_chains_both_reporting_show_the_two_hosts_notice', async () => {
    expect((await beat(practiceA)).status).toBe(200);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    // The old chain reports again after the new one appeared: both are running at once.
    await beat(practiceA);

    const notice = await twoHostsNotice();
    expect(notice.practice).toBe(true);
    expect(notice.overview).toEqual([true, true]);
  });

  it('two_concurrent_first_beats_serialise_on_the_practice', async () => {
    // Two chains the platform has never seen, at the same moment: the second to commit is chain_replaced.
    const [one, two] = await Promise.all([
      beat(practiceA),
      beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    const statuses = [one, two].map((r) => (r.body as AobPrinterHeartbeatReply).chain.status).sort();
    expect(statuses).toEqual(['regressed', 'unverified']);
    const replaced = await aobprinterEvents('aobprinter.chain_regressed');
    expect(replaced).toHaveLength(1);
    expect(replaced[0].payload).toMatchObject({ kind: 'chain_replaced' });

    // The same chain's first beat twice at once: one row, and neither is a 500.
    await prisma.withPractice(practiceA, (tx) => tx.aobPrinterHost.deleteMany({}));
    const twice = await Promise.all([beat(practiceA), beat(practiceA), beat(practiceA)]);
    expect(twice.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await hostsOf(practiceA)).toHaveLength(1);
  });

  it('rebaselining_a_replacement_retires_the_old_chain', async () => {
    expect((await beat(practiceA)).status).toBe(200);
    const replaced = await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    expect((replaced.body as AobPrinterHeartbeatReply).chain.status).toBe('regressed');
    // CHAIN_A also regresses on its own account: its head goes backwards.
    const backwards = await beat(practiceA, { head: { seq: 9, hash: at(CHAIN_A, 9) } });
    expect((backwards.body as AobPrinterHeartbeatReply).chain.status).toBe('regressed');
    const idOf = async (chainId: string) => (await hostsOf(practiceA)).find((r) => r.chainId === chainId)!.id;
    const hostA = await idOf(CHAIN_A);
    const hostB = await idOf(CHAIN_B);

    operator();
    // Re-baselining a regression that is NOT a replacement accepts that head and retires nothing.
    expect((await http().post(`/aobprinter-hosts/${hostA}/rebaseline`).send({ reasonCode: 'investigated' })).status).toBe(200);
    let rows = await hostsOf(practiceA);
    expect(rows.every((r) => r.retiredAt === null && r.retiredBy === null)).toBe(true);

    // Re-baselining the replacement accepts CHAIN_B as the practice's chain: CHAIN_A is retired, in the same act.
    const res = await http().post(`/aobprinter-hosts/${hostB}/rebaseline`).send({ reasonCode: 'reinstalled' });
    expect(res.status).toBe(200);
    rows = await hostsOf(practiceA);
    const a = rows.find((r) => r.chainId === CHAIN_A)!;
    const b = rows.find((r) => r.chainId === CHAIN_B)!;
    expect(a.retiredAt).not.toBeNull();
    expect(a.retiredBy).toBe(OPERATOR.sub);
    expect(b.retiredAt).toBeNull();
    expect(b.chainStatus).toBe('unverified');

    const events = await aobprinterEvents('aobprinter.chain_rebaselined');
    expect(events.map((e) => (e.payload as Record<string, unknown>).retiredChains).sort()).toEqual([0, 1]);
    const ofB = events.find((e) => (e.payload as Record<string, unknown>).chainId === CHAIN_B)!;
    expect(ofB.payload).toMatchObject({ previousKind: 'chain_replaced', retiredChains: 1 });

    // The retired chain, silent since, is no second host, on the practice page or the overview.
    currentPrincipal = { ...STAFF, practiceId: practiceA };
    const view = (await http().get('/aobprinter-hosts').set('x-practice-id', practiceA)).body as AobPrinterHostsView;
    expect(view.secondHostReporting).toBe(false);
    operator();
    const overview = (await http().get('/platform/aobprinter-hosts')).body as { hosts: Record<string, unknown>[] };
    const mine = overview.hosts.filter((r) => r.practiceId === practiceA);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ chainStatus: 'unverified', secondHostReporting: false });
  });

  it('accepting_one_replacement_then_rebaselining_another_cannot_retire_every_chain', async () => {
    // One chain, then two replacements beside it.
    expect((await beat(practiceA)).status).toBe(200);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    await beat(practiceA, { chainId: CHAIN_C, head: { seq: 2, hash: at(CHAIN_C, 2) } });
    const idOf = async (chainId: string) => (await hostsOf(practiceA)).find((r) => r.chainId === chainId)!.id;
    const hostB = await idOf(CHAIN_B);
    const hostC = await idOf(CHAIN_C);

    // Accepting B retires A and C.
    operator();
    expect((await http().post(`/aobprinter-hosts/${hostB}/rebaseline`).send({ reasonCode: 'reinstalled' })).status).toBe(200);

    // C is still regressed, but it is retired and silent since: re-baselining it is refused, and says why.
    const refused = await http().post(`/aobprinter-hosts/${hostC}/rebaseline`).send({ reasonCode: 'reinstalled' });
    expect(refused.status).toBe(409);
    expect(refused.body.reasonCode).toBe('aobprinter_chain_retired');

    const rows = await hostsOf(practiceA);
    expect(rows.filter((r) => r.retiredAt === null).map((r) => r.chainId)).toEqual([CHAIN_B]);
    expect(rows.find((r) => r.chainId === CHAIN_C)!.chainStatus).toBe('regressed');
    expect(await aobprinterEvents('aobprinter.chain_rebaselined')).toHaveLength(1);

    // The console shows the retired chains as retired, with when.
    currentPrincipal = { ...STAFF, practiceId: practiceA };
    const view = (await http().get('/aobprinter-hosts').set('x-practice-id', practiceA)).body as AobPrinterHostsView;
    const retiredAt = (chainId: string) => view.hosts.find((h) => h.chainId === chainId)!.retiredAt;
    expect(retiredAt(CHAIN_A)).not.toBeNull();
    expect(retiredAt(CHAIN_C)).not.toBeNull();
    expect(retiredAt(CHAIN_B)).toBeNull();
  });

  it('a_retired_chain_that_reports_again_counts_for_rule_1', async () => {
    // A is retired when B is accepted as its replacement.
    expect((await beat(practiceA)).status).toBe(200);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    const hostB = (await hostsOf(practiceA)).find((r) => r.chainId === CHAIN_B)!.id;
    operator();
    expect((await http().post(`/aobprinter-hosts/${hostB}/rebaseline`).send({ reasonCode: 'reinstalled' })).status).toBe(200);
    // B is set aside too, by hand, so A is the only chain that could count.
    const retiredBefore = new Date(Date.now() - 1000);
    await prisma.withPractice(practiceA, (tx) =>
      tx.aobPrinterHost.updateMany({ where: { chainId: CHAIN_B }, data: { retiredAt: retiredBefore, retiredBy: OPERATOR.sub, lastSeenAt: retiredBefore } }),
    );

    // A reports AGAIN after its retirement: a host still running. It is live on the console...
    currentPrincipal = null;
    expect((await beat(practiceA, { head: { seq: 11, hash: at(CHAIN_A, 11) } })).status).toBe(200);
    currentPrincipal = { ...STAFF, practiceId: practiceA };
    const view = (await http().get('/aobprinter-hosts').set('x-practice-id', practiceA)).body as AobPrinterHostsView;
    expect(view.hosts.find((h) => h.chainId === CHAIN_A)!.retiredAt).toBeNull();

    // ...and for rule 1: a chain the platform has never seen beside it is chain_replaced, not unverified.
    currentPrincipal = null;
    const third = await beat(practiceA, { chainId: CHAIN_C, head: { seq: 2, hash: at(CHAIN_C, 2) } });
    expect((third.body as AobPrinterHeartbeatReply).chain.status).toBe('regressed');
    const replaced = (await aobprinterEvents('aobprinter.chain_regressed')).filter(
      (e) => (e.payload as Record<string, unknown>).chainId === CHAIN_C,
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0].payload).toMatchObject({ kind: 'chain_replaced', expectedHash: CHAIN_A });
  });

  it('rebaselining_a_retired_chain_that_reports_again_clears_its_own_retirement', async () => {
    expect((await beat(practiceA)).status).toBe(200);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    const hostB = (await hostsOf(practiceA)).find((r) => r.chainId === CHAIN_B)!.id;
    operator();
    expect((await http().post(`/aobprinter-hosts/${hostB}/rebaseline`).send({ reasonCode: 'reinstalled' })).status).toBe(200);

    // The retired chain A reports again, and its head has gone backwards: a regression on a live host.
    currentPrincipal = null;
    expect((await beat(practiceA, { head: { seq: 9, hash: at(CHAIN_A, 9) } })).body.chain.status).toBe('regressed');
    const hostA = (await hostsOf(practiceA)).find((r) => r.chainId === CHAIN_A)!.id;

    operator();
    expect((await http().post(`/aobprinter-hosts/${hostA}/rebaseline`).send({ reasonCode: 'investigated' })).status).toBe(200);
    const rows = await hostsOf(practiceA);
    const a = rows.find((r) => r.chainId === CHAIN_A)!;
    expect(a.retiredAt).toBeNull();
    expect(a.retiredBy).toBeNull();
    // Not a replacement: B stays the practice's accepted chain, unretired.
    expect(rows.find((r) => r.chainId === CHAIN_B)!.retiredAt).toBeNull();
  });

  it('the_silence_sweep_says_nothing_of_a_retired_chain', async () => {
    expect((await beat(practiceA)).status).toBe(200);
    await beat(practiceA, { chainId: CHAIN_B, head: { seq: 3, hash: at(CHAIN_B, 3) } });
    const rows = await hostsOf(practiceA);
    const hostA = rows.find((r) => r.chainId === CHAIN_A)!.id;
    const hostB = rows.find((r) => r.chainId === CHAIN_B)!.id;
    // A went quiet sixteen minutes ago; then B was accepted as its replacement.
    await prisma.withPractice(practiceA, (tx) =>
      tx.aobPrinterHost.updateMany({ where: { chainId: CHAIN_A }, data: { lastSeenAt: new Date(Date.now() - 16 * 60 * 1000) } }),
    );
    operator();
    expect((await http().post(`/aobprinter-hosts/${hostB}/rebaseline`).send({ reasonCode: 'reinstalled' })).status).toBe(200);

    const alerts = jest.spyOn(Logger.prototype, 'error');
    await app.get(AobPrinterHostsSweep).sweep();
    const about = (id: string) => alerts.mock.calls.filter((c) => String(c[0]).includes('ALERT') && String(c[0]).includes(id));
    expect(about(hostA)).toHaveLength(0);

    // A chain that is not retired, silent as long, is still said.
    await prisma.withPractice(practiceA, (tx) =>
      tx.aobPrinterHost.updateMany({ where: { chainId: CHAIN_B }, data: { lastSeenAt: new Date(Date.now() - 16 * 60 * 1000) } }),
    );
    await app.get(AobPrinterHostsSweep).sweep();
    expect(about(hostB).filter((c) => String(c[0]).includes('offline'))).toHaveLength(1);
  });

  it('a_rewrite_after_a_rebaseline_is_caught_as_chain_replaced', async () => {
    // The practice's only chain regresses and an operator re-baselines it.
    const hostId = await regressedChain();
    operator();
    expect((await http().post(`/aobprinter-hosts/${hostId}/rebaseline`).send({ reasonCode: 'investigated' })).status).toBe(200);
    const [rebaselined] = await aobprinterEvents('aobprinter.chain_rebaselined');
    expect(rebaselined.payload).toMatchObject({ chainId: CHAIN_A, retiredChains: 0 });

    // Later the log is rewritten (or the host reinstalled): a chain the platform has never seen.
    currentPrincipal = null;
    const rewrite = await beat(practiceA, { chainId: CHAIN_B, head: { seq: 2, hash: at(CHAIN_B, 2) } });
    expect((rewrite.body as AobPrinterHeartbeatReply).chain.status).toBe('regressed');

    const replaced = (await aobprinterEvents('aobprinter.chain_regressed')).filter(
      (e) => (e.payload as Record<string, unknown>).kind === 'chain_replaced',
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0].payload).toMatchObject({ chainId: CHAIN_B, expectedHash: CHAIN_A, receivedHash: CHAIN_B });
    const b = (await hostsOf(practiceA)).find((r) => r.chainId === CHAIN_B)!;
    expect(b.regressionKind).toBe('chain_replaced');
  });

  it('the_silence_sweep_alerts_once_when_a_host_goes_offline_and_once_when_it_returns', async () => {
    expect((await beat(practiceA)).status).toBe(200);
    const sweep = app.get(AobPrinterHostsSweep);
    const alerts = jest.spyOn(Logger.prototype, 'error');
    const mine = (word: string) =>
      alerts.mock.calls.filter(
        (c) => String(c[0]).includes('ALERT') && String(c[0]).includes(practiceA) && String(c[0]).includes(word),
      );

    await sweep.sweep();
    expect(mine('offline')).toHaveLength(0);

    // Silent for sixteen minutes.
    await prisma.withPractice(practiceA, (tx) =>
      tx.aobPrinterHost.updateMany({ data: { lastSeenAt: new Date(Date.now() - 16 * 60 * 1000) } }),
    );
    await sweep.sweep();
    await sweep.sweep();
    expect(mine('offline')).toHaveLength(1);

    // It comes back.
    await beat(practiceA);
    await sweep.sweep();
    await sweep.sweep();
    expect(mine('back')).toHaveLength(1);
    expect(mine('offline')).toHaveLength(1);

    // Log only: silence is never a vault event.
    expect(await aobprinterEvents()).toEqual([]);
  });
});
