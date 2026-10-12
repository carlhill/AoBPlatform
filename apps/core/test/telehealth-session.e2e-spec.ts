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
import { TelehealthEvidence, outboxSink, type TelehealthEvidenceEntry } from '../src/telehealth/telehealth-evidence';
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
    // Capture each entry AND call through to the real outbox, on the write's own tx.
    app.get(TelehealthEvidence).sink = async (tx, entry) => {
      await outboxSink(tx, entry);
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
      // The link carries a random token, so it is taken out before looking for the code in the words.
      const words = JSON.stringify(item.payload).replace(/https?:\/\/[^\s"\\]+/g, '<link>');
      expect(words.split(/[^0-9]+/)).not.toContain(sent.code);
      expect(words.replace(/<link>/g, '')).not.toMatch(TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN);
    }

    // telehealth_code_stored_hashed and telehealth_identifier_types_never_values, at rest.
    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.telehealthSession.findFirstOrThrow({ where: { id: sent.session.id } }),
    );
    expect(row.codeHash).toMatch(/^scrypt\$[0-9]+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    // Equality, never substring: no column holds the code or the contact.
    expect(Object.values(row)).not.toContain(sent.code);
    expect(Object.values(row)).not.toContain('0400 000 412');
    expect(Object.values(row)).not.toContain('testy@example.invalid');
    expect(row.identifierTypes.sort()).toEqual([...checked].sort());
    expect(row.affiliationId).toBe(gp.affiliationId);

    // The check on the call is the approved staff-verified event, channel telehealth.
    const verification = await prisma.withPractice(practiceId, (tx) =>
      tx.verificationEvent.findFirstOrThrow({ where: { id: row.verificationEventId! } }),
    );
    expect(verification.channel).toBe('telehealth');
    expect(verification.verifiedByStaffId).toBe(`keycloak-${gp.practitionerId}`);
    // The vault event names the real principal: a practitioner, not staff.
    const verificationEvent = await prisma.vaultOutbox.findFirstOrThrow({
      where: { type: 'verification.staff_verified', subjectId: row.verificationEventId! },
    });
    expect((verificationEvent.actor as { principalType: string }).principalType).toBe('practitioner');

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

    // Every write handed its event over, types and ids only.
    expect(recorded.map((e) => e.event.type)).toEqual([
      'telehealth.session_opened',
      'telehealth.link_sent',
      'telehealth.code_checked',
      'telehealth.consent_recorded',
    ]);
    for (const entry of recorded) expect(Object.values(entry.event.payload)).not.toContain(sent.code);

    // And they reached the vault outbox, committed with their writes (hard rule 11): one row each, and
    // exactly one consent although agree was pressed twice. (Sorted: two rows in one transaction can share
    // an occurredAt, and the table has no sequence.)
    const outbox = await prisma.vaultOutbox.findMany({
      where: { subjectType: 'TelehealthSession', subjectId: sent.session.id },
    });
    expect(outbox.map((r) => r.type).sort()).toEqual(
      ['telehealth.session_opened', 'telehealth.link_sent', 'telehealth.code_checked', 'telehealth.consent_recorded'].sort(),
    );
    const consent = outbox.filter((r) => r.type === 'telehealth.consent_recorded');
    expect(consent).toHaveLength(1);
    const consentPayload = consent[0]!.payload as Record<string, unknown>;
    expect(Object.keys(consentPayload).sort()).toEqual(['consentKey', 'consenterIsPatient', 'contentVersion']);
    // No value keys and no values on any row (hard rule 9): not the code, not the contact, not a name.
    const valueKey = /^(code|note|mobile|email|phone|contact|destination|name|givenNames|familyName|dateOfBirth|address|ihi|medicare.*|token|pageKey)$/i;
    for (const row of outbox) {
      const payload = row.payload as Record<string, unknown>;
      expect(Object.keys(payload).filter((k) => valueKey.test(k))).toEqual([]);
      for (const value of [sent.code, '0400 000 412', 'testy@example.invalid', 'Telehealthson', 'Testy', pageKey]) {
        expect(Object.values(payload)).not.toContain(value);
      }
    }
  });

  it('telehealth_identifier_types_never_values', async () => {
    recorded.length = 0;
    const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'sms',
      consenterIsPatient: true,
    });
    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.telehealthSession.findFirstOrThrow({ where: { id: sent.session.id } }),
    );
    // The session holds kinds of identifier, and has no column a value could sit in.
    expect(row.identifierTypes.sort()).toEqual(['address', 'date_of_birth', 'name']);
    const columns = Object.keys(row);
    for (const valueColumn of ['familyName', 'givenNames', 'dateOfBirth', 'address', 'mobile', 'email', 'ihi', 'code']) {
      expect(columns).not.toContain(valueColumn);
    }
    // The patient's own values appear in no column (equality, not substring).
    for (const value of ['Telehealthson', 'Testy', '1980-01-01', '0400 000 412', 'testy@example.invalid']) {
      expect(Object.values(row)).not.toContain(value);
    }
    // The verification evidence carries the types joined, never a value.
    const outbox = await prisma.vaultOutbox.findFirstOrThrow({
      where: { type: 'verification.staff_verified', subjectId: row.verificationEventId! },
    });
    expect((outbox.payload as { identifierTypes: string }).identifierTypes).toBe('address,date_of_birth,name');
    // And the proposed events carry a count, not the list and not the values.
    const opened = recorded.find((e) => e.event.type === 'telehealth.session_opened')!;
    expect(opened.event.payload).toMatchObject({ identifierTypeCount: 3 });
    expect(Object.keys(opened.event.payload)).not.toContain('identifierTypes');
  });

  it('carer_must_attest_18_before_send', async () => {
    await expect(
      telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
        patientId,
        identifierTypes: checked,
        channel: 'sms',
        consenterIsPatient: false,
        consenterRelationship: 'mother',
      }),
    ).rejects.toThrow(/18 or over/);
    await expect(
      telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
        patientId,
        identifierTypes: checked,
        channel: 'sms',
        consenterIsPatient: false,
        consenterAttested18: true,
      }),
    ).rejects.toThrow(/related to the patient/);
    // And the database refuses a carer with no attestation even if a caller got past the service.
    await expect(
      prisma.withPractice(practiceId, (tx) =>
        tx.telehealthSession.create({
          data: {
            practiceId,
            patientId,
            practitionerId: gp.practitionerId,
            affiliationId: gp.affiliationId,
            consenterIsPatient: false,
            consenterRelationship: 'mother',
            contentVersion: 'test',
            createdById: 'test',
          },
        }),
      ),
    ).rejects.toThrow(/telehealth_sessions_carer_attested/);
  });

  it('parallel wrong guesses never exceed the attempt limit', async () => {
    const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'sms',
      consenterIsPatient: true,
    });
    const token = await tokenFrom(sent.session.id);
    const wrong = sent.code === '000000' ? '111111' : '000000';
    const limit = TELEHEALTH_CONTENT.code.wrongAttemptsBeforeLock;
    const replies = await Promise.all(
      Array.from({ length: limit + 3 }, () =>
        request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: wrong }),
      ),
    );
    expect(replies.filter((r) => r.status === 400)).toHaveLength(limit - 1);
    expect(replies.filter((r) => r.status === 423)).toHaveLength(4);
    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.telehealthSession.findFirstOrThrow({ where: { id: sent.session.id } }),
    );
    expect(row.codeAttempts).toBe(limit);
    const tasks = await prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findMany({ where: { subjectId: sent.session.id, kind: 'telehealth_code_locked' } }),
    );
    expect(tasks).toHaveLength(1);
  });

  it('a page replaced by a fresh link says so, by code', async () => {
    const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'sms',
      consenterIsPatient: true,
    });
    const token = await tokenFrom(sent.session.id);
    const ok = await request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: sent.code }).expect(201);
    await telehealth.sendAgain(asPractitioner(gp.practitionerId), practiceId, sent.session.id, {});
    const old = await request(app.getHttpServer()).get('/telehealth/page').set('x-telehealth-page-key', ok.body.pageKey).expect(410);
    expect(old.body.code).toBe('page_replaced');
    // Every refusal on the code carries a code the page maps, not only a status.
    const fresh = await tokenFrom(sent.session.id);
    const wrong = await request(app.getHttpServer()).post(`/telehealth/link/${fresh}/code`).send({ code: '999999' === sent.code ? '888888' : '999999' });
    expect(wrong.body.code).toBe('wrong_code');
    const unknown = await request(app.getHttpServer()).get('/telehealth/page').set('x-telehealth-page-key', 'nonsense').expect(404);
    expect(unknown.body.code).toBe('page_not_open');
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
    // Spaces and dashes do not hide a number.
    for (const note of ['Card 2123 45670 1 would not scan', 'Ref 212-345-6701']) {
      await expect(
        telehealth.recordNotDone(asPractitioner(gp.practitionerId), practiceId, {
          patientId: noMobilePatientId,
          reason: 'other',
          note,
        }),
      ).rejects.toThrow(/without any identifiers/);
    }
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
    ).rejects.toThrow(/approved identifier types/);
    await expect(
      telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
        patientId,
        identifierTypes: ['name', 'date_of_birth', 'medicare_number'],
        channel: 'sms',
        consenterIsPatient: true,
      }),
    ).rejects.not.toThrow(/medicare_number/);
    // Two approved types are not a check (the floor of three, REQ-VER-03).
    await expect(
      telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
        patientId,
        identifierTypes: ['name', 'date_of_birth'],
        channel: 'sms',
        consenterIsPatient: true,
      }),
    ).rejects.toThrow(/at least three/);
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

  /** A session with the code entered, ready for the button: the page key is returned. */
  const atTheButton = async () => {
    const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
      patientId,
      identifierTypes: checked,
      channel: 'sms',
      consenterIsPatient: true,
    });
    const token = await tokenFrom(sent.session.id);
    const entered = await request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: sent.code }).expect(201);
    return { sessionId: sent.session.id, pageKey: entered.body.pageKey as string };
  };
  const agreeOver = (pageKey: string) =>
    request(app.getHttpServer())
      .post('/telehealth/page/agree')
      .set('x-telehealth-page-key', pageKey)
      .send({ consentKey: TELEHEALTH_CONTENT.consent.key });

  it('not done racing agree never leaves not_done with an agreement, and never a 500', async () => {
    for (let round = 0; round < 6; round += 1) {
      recorded.length = 0;
      const { sessionId, pageKey } = await atTheButton();
      const [agreed, marked] = await Promise.all([
        agreeOver(pageKey),
        telehealth
          .markNotDone(asPractitioner(gp.practitionerId), practiceId, sessionId, { reason: 'emergency' })
          .then(() => 'marked', (err: Error) => err.message),
      ]);
      expect([201, 409]).toContain(agreed.status);
      if (agreed.status === 409) expect(agreed.body.code).toBe('session_not_done');
      const row = await prisma.withPractice(practiceId, (tx) =>
        tx.telehealthSession.findFirstOrThrow({ where: { id: sessionId } }),
      );
      const consents = recorded.filter((e) => e.subject.id === sessionId && e.event.type === 'telehealth.consent_recorded');
      // The committed outbox follows the committed state: whichever write lost left no vault event behind.
      const outboxTypes = (
        await prisma.vaultOutbox.findMany({ where: { subjectType: 'TelehealthSession', subjectId: sessionId } })
      ).map((r) => r.type);
      const count = (type: string) => outboxTypes.filter((t) => t === type).length;
      if (row.state === 'not_done') {
        expect({ round, agreedAt: row.agreedAt, consents: consents.length }).toEqual({ round, agreedAt: null, consents: 0 });
        expect({ round, consent: count('telehealth.consent_recorded'), notDone: count('telehealth.not_done') }).toEqual({
          round,
          consent: 0,
          notDone: 1,
        });
      } else {
        expect(row.state).toBe('agreed');
        expect(consents).toHaveLength(1);
        expect(marked).toMatch(/already agreed/);
        expect({ round, consent: count('telehealth.consent_recorded'), notDone: count('telehealth.not_done') }).toEqual({
          round,
          consent: 1,
          notDone: 0,
        });
      }
    }
  });

  it('a double press of agree records exactly one consent', async () => {
    recorded.length = 0;
    const { sessionId, pageKey } = await atTheButton();
    const replies = await Promise.all([agreeOver(pageKey), agreeOver(pageKey), agreeOver(pageKey)]);
    for (const reply of replies) expect(reply.status).toBe(201);
    const consents = recorded.filter((e) => e.subject.id === sessionId && e.event.type === 'telehealth.consent_recorded');
    expect(consents).toHaveLength(1);
  });

  it('send again racing a code entry retires the page the code opened', async () => {
    for (let round = 0; round < 6; round += 1) {
      const sent = await telehealth.send(asPractitioner(gp.practitionerId), practiceId, {
        patientId,
        identifierTypes: checked,
        channel: 'sms',
        consenterIsPatient: true,
      });
      const token = await tokenFrom(sent.session.id);
      const [entered] = await Promise.all([
        request(app.getHttpServer()).post(`/telehealth/link/${token}/code`).send({ code: sent.code }),
        telehealth.sendAgain(asPractitioner(gp.practitionerId), practiceId, sent.session.id, {}),
      ]);
      expect(entered.status).toBeLessThan(500);
      if (entered.status === 201) {
        // The code won the race, then the fresh link replaced its page: the page must say so.
        const page = await request(app.getHttpServer()).get('/telehealth/page').set('x-telehealth-page-key', entered.body.pageKey);
        expect({ round, status: page.status, code: page.body.code }).toEqual({ round, status: 410, code: 'page_replaced' });
      } else {
        expect(entered.body.code).toBe('link_invalid');
      }
    }
  });

  it('with the vault events approved, TELEHEALTH_ENABLED alone gates it, whatever NODE_ENV says', async () => {
    // Requirement change, not a weakening: the NODE_ENV restriction existed only while the events had no
    // vault type. Carl approved them on 12 Oct 2026 (D-2026-10-12-02), and every write now enqueues its event.
    const was = process.env.NODE_ENV;
    try {
      for (const env of ['production', 'staging', '', 'development', 'test']) {
        process.env.NODE_ENV = env;
        expect({ env, enabled: telehealth.enabled() }).toEqual({ env, enabled: true });
      }
    } finally {
      process.env.NODE_ENV = was;
    }
  });

  it('is off unless the flag is on', async () => {
    process.env.TELEHEALTH_ENABLED = 'false';
    try {
      const off = await request(app.getHttpServer()).get('/telehealth/link/not-a-token').expect(404);
      expect(off.body.code).toBe('telehealth_not_enabled');
      expect(telehealth.enabled()).toBe(false);
      await expect(telehealth.list(asPractitioner(gp.practitionerId), practiceId)).rejects.toThrow(/not switched on/);
    } finally {
      process.env.TELEHEALTH_ENABLED = 'true';
    }
  });
});
