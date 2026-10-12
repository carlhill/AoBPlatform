/**
 * THE TELEHEALTH SESSION, END TO END (TELEHEALTH-PLAN.md §8 step 2), against
 * real Postgres with RLS.
 *
 * The provider's half is called through the service with the actor a
 * practitioner's token produces, as the practitioner-queue spec does; the
 * patient's half goes over HTTP, because it is public and the URL is the
 * surface (wow.md §2 item 2).
 *
 * Fixtures are obviously fake people with obviously fake contacts.
 */
process.env.TELEHEALTH_ENABLED = 'true';

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { TELEHEALTH_CONTENT, TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelehealthService } from '../src/telehealth/telehealth.service';
import { TelehealthEvidence, type TelehealthEvidenceEntry } from '../src/telehealth/telehealth-evidence';
import type { Actor } from '../src/auth/actor.decorator';
import { parseCaptureToken } from '../src/capture/capture-token';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

describe('telehealth sessions (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let telehealth: TelehealthService;
  const recorded: TelehealthEvidenceEntry[] = [];

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();
  let gp: Awaited<ReturnType<typeof createServicingProvider>>;
  let otherGp: Awaited<ReturnType<typeof createServicingProvider>>;
  let patientId: string;
  let noMobilePatientId: string;

  const asPractitioner = (practitionerId: string): Actor => ({
    id: `keycloak-${practitionerId}`,
    name: 'A practitioner',
    principalType: 'user',
    roles: ['provider'],
    authMethod: 'passkey',
    practitionerId,
  });

  const checked = ['name', 'date_of_birth', 'address'];
  const tokenFrom = async (sessionId: string): Promise<string> => {
    // The token is only ever in the message. Read it back out of the queued SMS, as a phone would,
    // and take the one whose hash the session holds now (a resend replaces it).
    const { items, session } = await prisma.withPractice(practiceId, async (tx) => ({
      items: await tx.outboundItem.findMany({ where: { subjectId: sessionId, channel: 'sms' } }),
      session: await tx.telehealthSession.findFirstOrThrow({ where: { id: sessionId } }),
    }));
    for (const item of items) {
      const body = String((item.payload as { body: string }).body);
      const match = /\/patient\/telehealth\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(body);
      if (match && parseCaptureToken(match[1]!)?.tokenHash === session.linkTokenHash) return match[1]!;
    }
    throw new Error('no queued SMS carries the current link');
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    telehealth = app.get(TelehealthService);
    app.get(TelehealthEvidence).sink = async (_tx, entry) => {
      recorded.push(entry);
    };

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Telehealth Test Practice' } });
      gp = await createServicingProvider(tx, practiceId, { name: 'Dr Sample Chen' });
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Telehealthson',
            givenNames: 'Testy',
            dateOfBirth: new Date('1980-01-01'),
            mobile: '0400 000 412',
            email: 'testy@example.invalid',
          },
        })
      ).id;
      noMobilePatientId = (
        await tx.patient.create({
          data: { practiceId, familyName: 'Nomobile', givenNames: 'Fixture', dateOfBirth: new Date('1990-02-02') },
        })
      ).id;
    });
    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Other Telehealth Practice' } });
      otherGp = await createServicingProvider(tx, otherPracticeId, { name: 'Dr Other Sampleton' });
    });
  });

  afterAll(async () => {
    for (const id of [practiceId, otherPracticeId]) {
      await prisma.withPractice(id, async (tx) => {
        await tx.telehealthSession.deleteMany({});
        await tx.reviewTask.deleteMany({});
        await tx.outboundItem.deleteMany({});
        await tx.verificationChallenge.deleteMany({});
        await tx.patient.deleteMany({});
        await deleteSeededAnchors(tx);
      });
    }
    await app.close();
  });

  it('send, code, agree: the lifecycle, with the code only ever on the provider’s screen', async () => {
    recorded.length = 0;
    const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'both',
      consenterIsPatient: true,
    });
    expect(sent.code).toMatch(/^[0-9]{6}$/);
    expect(sent.queued).toEqual(['sms', 'email']);
    expect(sent.session.state).toBe('opened');

    // telehealth_code_never_in_the_message: neither message carries it, and both stay neutral (G10).
    const items = await prisma.withPractice(practiceId, (tx) =>
      tx.outboundItem.findMany({ where: { subjectId: sent.session.id } }),
    );
    expect(items).toHaveLength(2);
    for (const item of items) {
      const text = JSON.stringify(item.payload);
      expect(text).not.toContain(sent.code);
      expect(text.replace(/https?:\/\/\S+/g, '')).not.toMatch(TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN);
    }

    // telehealth_code_stored_hashed and telehealth_identifier_types_never_values, at rest.
    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.telehealthSession.findFirstOrThrow({ where: { id: sent.session.id } }),
    );
    expect(row.codeHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(row)).not.toContain(sent.code);
    expect(JSON.stringify(row)).not.toContain('0400 000 412');
    expect(row.identifierTypes.sort()).toEqual([...checked].sort());
    expect(row.affiliationId).toBe(gp.affiliationId);

    // The check on the call is the approved staff-verified event, channel telehealth.
    const verification = await prisma.withPractice(practiceId, (tx) =>
      tx.verificationEvent.findFirstOrThrow({ where: { id: row.verificationEventId! } }),
    );
    expect(verification.channel).toBe('telehealth');
    expect(verification.verifiedByStaffId).toBe(`keycloak-${gp.practitionerId}`);

    // The patient: landing (practice only), code, page, agree.
    const token = await tokenFrom(sent.session.id);
    const landing = await request(app.getHttpServer()).get(`/telehealth/link/${token}`).expect(200);
    expect(landing.body).toEqual({ state: 'open', practiceName: 'Telehealth Test Practice' });

    const entered = await request(app.getHttpServer())
      .post(`/telehealth/link/${token}/code`)
      .send({ code: sent.code })
      .expect(201);
    const pageKey = entered.body.pageKey as string;

    // Single use: the link is spent.
    await request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: sent.code }).expect(410);

    const page = await request(app.getHttpServer()).get('/telehealth/page').set('x-telehealth-page-key', pageKey).expect(200);
    expect(page.body.state).toBe('code_checked');
    expect(page.body.providerName).toBe('Dr Sample Chen');
    expect(page.body.statement).toBe('Yes, start my telehealth consultation with Dr Sample Chen');
    expect(page.body.statement).not.toMatch(TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN);

    const listed = await telehealth.list(asPractitioner(gp.practitionerId), practiceId);
    expect(listed.find((s) => s.id === sent.session.id)?.state).toBe('code_checked');

    const agreed = await request(app.getHttpServer())
      .post('/telehealth/page/agree')
      .set('x-telehealth-page-key', pageKey)
      .send({ consentKey: TELEHEALTH_CONTENT.consent.key })
      .expect(201);
    expect(agreed.body.state).toBe('agreed');
    // Pressing twice is the same answer, not a second record.
    await request(app.getHttpServer())
      .post('/telehealth/page/agree')
      .set('x-telehealth-page-key', pageKey)
      .send({ consentKey: TELEHEALTH_CONTENT.consent.key })
      .expect(201);

    const after = await telehealth.list(asPractitioner(gp.practitionerId), practiceId);
    expect(after.find((s) => s.id === sent.session.id)?.state).toBe('agreed');

    // Every write handed its proposed event over, types and ids only.
    expect(recorded.map((e) => e.event.type)).toEqual([
      'telehealth.session_opened',
      'telehealth.link_sent',
      'telehealth.code_checked',
      'telehealth.consent_recorded',
    ]);
    expect(JSON.stringify(recorded)).not.toContain(sent.code);
  });

  it('a wrong code locks after the limit, tells the practice, and a fresh link reuses the session', async () => {
    const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'sms',
      consenterIsPatient: false,
      consenterRelationship: 'mother',
      consenterAttested18: true,
    });
    const token = await tokenFrom(sent.session.id);
    const wrong = sent.code === '000000' ? '111111' : '000000';
    const limit = TELEHEALTH_CONTENT.code.wrongAttemptsBeforeLock;

    for (let i = 1; i < limit; i += 1) {
      const res = await request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: wrong }).expect(400);
      expect(res.body.attemptsLeft).toBe(limit - i);
    }
    await request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: wrong }).expect(423);
    // Locked means locked, even for the right code.
    await request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: sent.code }).expect(423);

    const task = await prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findFirstOrThrow({ where: { subjectId: sent.session.id, kind: 'telehealth_code_locked' } }),
    );
    expect(task.summary).not.toContain(sent.code);

    const view = (await telehealth.list(asPractitioner(gp.practitionerId), practiceId)).find((s) => s.id === sent.session.id);
    expect(view?.codeLocked).toBe(true);

    const again = await telehealth.sendAgain(asPractitioner(gp.practitionerId), practiceId, sent.session.id, {});
    expect(again.session.id).toBe(sent.session.id);
    expect(again.session.linkSentCount).toBe(2);
    expect(again.session.codeLocked).toBe(false);
    const fresh = await tokenFrom(sent.session.id);
    expect(fresh).not.toBe(token);
    // The old link is dead; the new one opens with the new code.
    await request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: again.code }).expect(404);
    const ok = await request(app.getHttpServer()).post(`/telehealth/link/${fresh}/code`).send({ code: again.code }).expect(201);
    const page = await request(app.getHttpServer()).get('/telehealth/page').set('x-telehealth-page-key', ok.body.pageKey).expect(200);
    expect(page.body.statement).toContain('for Testy with Dr Sample Chen');
  });

  it('not done, with a reason: from a session, and with no session at all; the consultation is never blocked', async () => {
    const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'email',
      consenterIsPatient: true,
    });
    const token = await tokenFrom(sent.session.id).catch(() => null);
    expect(token).toBeNull(); // email only: no SMS was queued

    const marked = await telehealth.markNotDone(asPractitioner(gp.practitionerId), practiceId, sent.session.id, {
      reason: 'emergency',
      consultationAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(marked.state).toBe('not_done');
    expect(marked.notDoneReason).toBe('emergency');
    expect(marked.outcomeRecordedAt).not.toBeNull();
    expect(marked.consultationAt).not.toBeNull();
    await expect(
      telehealth.markNotDone(asPractitioner(gp.practitionerId), practiceId, sent.session.id, { reason: 'emergency' }),
    ).rejects.toThrow(/already not done/);

    // No contact on file: Send is refused with the transport named, and "not done" is the way past.
    await expect(
      telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
        patientId: noMobilePatientId,
        identifierTypes: checked,
        channel: 'sms',
        consenterIsPatient: true,
      }),
    ).rejects.toThrow(/no mobile number/);
    const direct = await telehealth.recordNotDone(asPractitioner(gp.practitionerId), practiceId, {
      patientId: noMobilePatientId,
      reason: 'other',
      note: 'Patient was driving',
    });
    expect(direct.state).toBe('not_done');
    expect(direct.linkSentCount).toBe(0);
    expect(direct.identifierTypes).toEqual([]);

    await expect(
      telehealth.recordNotDone(asPractitioner(gp.practitionerId), practiceId, {
        patientId: noMobilePatientId,
        reason: 'other',
        note: 'Card 2123456701 would not scan',
      }),
    ).rejects.toThrow(/without any identifiers/);
    await expect(
      telehealth.recordNotDone(asPractitioner(gp.practitionerId), practiceId, {
        patientId: noMobilePatientId,
        reason: 'emergency',
        note: 'notes are only for other',
      }),
    ).rejects.toThrow(/only the reason/i);

    const proceeded = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'sms',
      consenterIsPatient: true,
    });
    const dnp = await telehealth.markDidNotProceed(asPractitioner(gp.practitionerId), practiceId, proceeded.session.id, {});
    expect(dnp.state).toBe('did_not_proceed');
  });

  it('medicare_number_not_on_the_telehealth_checklist', async () => {
    await expect(
      telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
        patientId,
        identifierTypes: ['name', 'date_of_birth', 'medicare_number'],
        channel: 'sms',
        consenterIsPatient: true,
      }),
    ).rejects.toThrow(/not an approved patient identifier/);
    // Two approved types are not a check (the floor of three, REQ-VER-03).
    await expect(
      telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
        patientId,
        identifierTypes: ['name', 'date_of_birth'],
        channel: 'sms',
        consenterIsPatient: true,
      }),
    ).rejects.toThrow(/At least 3/);
    // And the database refuses the type even if a caller got past the service.
    await expect(
      prisma.withPractice(practiceId, (tx) =>
        tx.telehealthSession.create({
          data: {
            practiceId,
            patientId,
            practitionerId: gp.practitionerId,
            affiliationId: gp.affiliationId,
            identifierTypes: ['medicare_number'],
            contentVersion: 'test',
            createdById: 'test',
          },
        }),
      ),
    ).rejects.toThrow(/identifier_types_approved/);
  });

  it('telehealth_sessions_cross_practice_access_fails_closed', async () => {
    const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'sms',
      consenterIsPatient: true,
    });
    // RLS: another practice's scope sees nothing.
    const seen = await prisma.withPractice(otherPracticeId, (tx) =>
      tx.telehealthSession.findFirst({ where: { id: sent.session.id } }),
    );
    expect(seen).toBeNull();
    // A practitioner at another practice cannot open this practice's scope at all…
    await expect(telehealth.list(asPractitioner(otherGp.practitionerId), practiceId)).rejects.toThrow(/do not work/);
    // …and in their own practice, the session is not there to act on.
    await expect(
      telehealth.markNotDone(asPractitioner(otherGp.practitionerId), otherPracticeId, sent.session.id, { reason: 'emergency' }),
    ).rejects.toThrow(/no telehealth session of yours/);
    // A token for practice B naming practice A's hash opens nothing: the practice segment is the scope.
    const token = await tokenFrom(sent.session.id);
    const [, secret] = token.split('.');
    const forged = `${Buffer.from(otherPracticeId, 'utf8').toString('base64url')}.${secret}`;
    await request(app.getHttpServer()).get(`/telehealth/link/${forged}`).expect(404);
  });

  it('is off unless the flag is on', async () => {
    process.env.TELEHEALTH_ENABLED = 'false';
    try {
      await request(app.getHttpServer()).get('/telehealth/link/not-a-token').expect(404);
      expect(telehealth.enabled()).toBe(false);
      await expect(telehealth.list(asPractitioner(gp.practitionerId), practiceId)).rejects.toThrow(/not switched on/);
    } finally {
      process.env.TELEHEALTH_ENABLED = 'true';
    }
  });
});
