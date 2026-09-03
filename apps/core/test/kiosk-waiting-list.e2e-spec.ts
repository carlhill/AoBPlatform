import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { KIOSK_POLL_MS } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DevicesService } from '../src/devices/devices.service';

/**
 * The kiosk's list — CONSULTATION-CAPTURE-PLAN.md §2.2 step 1 and §9.4,
 * build-order item 7 (server half).
 *
 * WHAT THIS PINS. A tablet standing in a waiting room can ask who is here for
 * THIS practice with a pre-agreement waiting, can keep that list fresh by
 * polling at a cadence the server sets, and gets a list carrying names and
 * nothing else about anybody. The three failures it is written against:
 * another practice's patients appearing on the screen, a date of birth or an
 * IHI riding along in the payload, and a two-second poll costing a full
 * response every time when nothing has moved.
 *
 * THE SCOPE COMES FROM A PAIRED DEVICE NOW, not from a header (3 Sep 2026).
 * Every request below carries `x-device-credential` and none carries
 * `x-practice-id`, because the kiosk routes no longer accept one: a public URL
 * that took a practice id from whoever sent it is how anybody who reached
 * `/kiosk` could read a practice's waiting list. `device-pairing.e2e-spec.ts`
 * is where that refusal is asserted; this suite simply speaks the new
 * contract, which is the honest way to show it did not break the old
 * behaviour.
 */
describe('the kiosk waiting list (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();

  let bookedRequestId: string;
  let walkInRequestId: string;
  let bookedAgreementId: string;
  let bookedPatientId: string;

  /** One paired tablet per practice — the only way onto these routes. */
  let tabletA: string;
  let tabletB: string;

  /**
   * A registered, paired tablet, through the service rather than the console
   * endpoints: `POST /devices` refuses an unattributed request by design, and
   * this suite is about the waiting list rather than about who registered what.
   */
  async function pairTablet(practiceId: string, label: string): Promise<string> {
    const devices = app.get(DevicesService);
    const { code } = await devices.registerForDev(practiceId, label);
    const { credential } = await devices.pair(code, `kiosk-waiting-list-${practiceId}`);
    return credential;
  }

  const seedPractice = async (
    practiceId: string,
    names: { practice: string; provider: string; givenNames: string; familyName: string },
    opts: { time?: string; withAppointment?: boolean; confidential?: boolean } = {},
  ) =>
    prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: names.practice } });
      const provider = await tx.provider.create({
        data: { practiceId, name: names.provider, providerType: 'general_practitioner' },
      });
      const patient = await tx.patient.create({
        data: {
          practiceId,
          familyName: names.familyName,
          givenNames: names.givenNames,
          // Obviously fake, and none of it may reach the kiosk.
          dateOfBirth: new Date('1957-03-14'),
          genderAsIdentified: 'female',
          address: '12 Example Street, Sydney NSW 2000',
          patientRecordNumber: 'PRN-0001',
          ihi: '8003600000000000',
          mobile: '+61400000001',
          email: 'kiosk.fixture@example.invalid',
          confidentialityFlag: opts.confidential ?? false,
        },
      });
      const assignor = await tx.assignor.create({
        data: {
          practiceId,
          name: `${names.givenNames} ${names.familyName}`,
          authorityBasis: 'self',
          dateOfBirth: new Date('1957-03-14'),
        },
      });
      const agreement = await tx.agreement.create({
        data: {
          practiceId,
          type: 'episodic_pre',
          anchorKind: 'provider',
          providerId: provider.id,
          patientId: patient.id,
          assignorId: assignor.id,
          assignorIsPatient: true,
          status: 'verification_pending',
        },
      });
      if (opts.withAppointment) {
        await tx.appointment.create({
          data: {
            practiceId,
            pmsAppointmentKey: `kiosk-${agreement.id}`,
            patientId: patient.id,
            providerId: provider.id,
            date: new Date('2026-09-03'),
            time: opts.time ?? '09:00',
            agreementId: agreement.id,
          },
        });
      }
      const captureRequest = await tx.captureRequest.create({
        data: { practiceId, agreementId: agreement.id, channel: 'in_practice' },
      });
      return { patientId: patient.id, agreementId: agreement.id, captureRequestId: captureRequest.id };
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const booked = await seedPractice(
      practiceA,
      { practice: 'Kiosk Test Practice A', provider: 'Dr Example Provider', givenNames: 'Robin', familyName: 'Reachable' },
      { withAppointment: true, time: '09:00' },
    );
    bookedRequestId = booked.captureRequestId;
    bookedAgreementId = booked.agreementId;
    bookedPatientId = booked.patientId;

    // A walk-in: no appointment row at all. They must still be listed — the
    // platform never blocks care, and an unbooked patient at the desk is the
    // case the critical lane exists for.
    const walkIn = await prisma.withPractice(practiceA, async (tx) => {
      const provider = await tx.provider.findFirst({});
      const patient = await tx.patient.create({
        data: { practiceId: practiceA, familyName: 'Walkin', givenNames: 'Casey', dateOfBirth: new Date('1988-02-02') },
      });
      const assignor = await tx.assignor.create({
        data: { practiceId: practiceA, name: 'Casey Walkin', authorityBasis: 'self', dateOfBirth: new Date('1988-02-02') },
      });
      const agreement = await tx.agreement.create({
        data: {
          practiceId: practiceA,
          type: 'episodic_pre',
          anchorKind: 'provider',
          providerId: provider!.id,
          patientId: patient.id,
          assignorId: assignor.id,
          assignorIsPatient: true,
          status: 'draft',
        },
      });
      const captureRequest = await tx.captureRequest.create({
        data: { practiceId: practiceA, agreementId: agreement.id, channel: 'in_practice' },
      });
      return captureRequest.id;
    });
    walkInRequestId = walkIn;

    await seedPractice(
      practiceB,
      { practice: 'Kiosk Test Practice B', provider: 'Dr Other Provider', givenNames: 'Alex', familyName: 'Elsewhere' },
      { withAppointment: true, time: '10:00' },
    );

    tabletA = await pairTablet(practiceA, 'Waiting-list tablet A');
    tabletB = await pairTablet(practiceB, 'Waiting-list tablet B');
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.devicePairingCode.deleteMany({ where: { practiceId } });
        await tx.device.deleteMany({});
        await tx.outboundItem.deleteMany({});
        await tx.appointment.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.verificationChallenge.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  describe('the list', () => {
    it('lists this practice\'s episodic_pre drafts awaiting capture, by appointment time', async () => {
      const res = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);

      expect(res.body.practiceId).toBe(practiceA);
      expect(res.body.waiting).toHaveLength(2);
      // 09:00 before the walk-in, who has no time at all.
      expect(res.body.waiting.map((r: { captureRequestId: string }) => r.captureRequestId)).toEqual([
        bookedRequestId,
        walkInRequestId,
      ]);

      const booked = res.body.waiting[0];
      expect(booked).toMatchObject({
        captureRequestId: bookedRequestId,
        agreementId: bookedAgreementId,
        patientId: bookedPatientId,
        patientName: 'Robin Reachable',
        providerName: 'Dr Example Provider',
        appointmentDate: '2026-09-03',
        appointmentTime: '09:00',
        agreementStatus: 'verification_pending',
      });
      expect(typeof booked.waitingSince).toBe('string');
    });

    it('lists a walk-in with no appointment row — the platform never blocks care', async () => {
      const res = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);
      const walkIn = res.body.waiting.find((r: { captureRequestId: string }) => r.captureRequestId === walkInRequestId);
      expect(walkIn).toBeDefined();
      expect(walkIn.appointmentDate).toBeNull();
      expect(walkIn.appointmentTime).toBeNull();
      expect(walkIn.patientName).toBe('Casey Walkin');
    });

    it('kiosk_waiting_list_returns_no_identifier_values — types and names only, never values', async () => {
      const res = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);

      // The verify screen is told WHICH identifiers to ask for. Types only.
      expect(res.body.identifierTypes).toEqual(['name', 'date_of_birth', 'address']);

      const body = JSON.stringify(res.body);
      // The values seeded on the patient record, none of which may appear.
      expect(body).not.toContain('1957-03-14');
      expect(body).not.toContain('12 Example Street');
      expect(body).not.toContain('PRN-0001');
      expect(body).not.toContain('8003600000000000');
      expect(body).not.toContain('+61400000001');
      expect(body).not.toContain('kiosk.fixture@example.invalid');
      expect(body).not.toContain('female');
      for (const row of res.body.waiting as Record<string, unknown>[]) {
        expect(Object.keys(row).sort()).toEqual([
          'agreementId',
          'agreementStatus',
          'appointmentDate',
          'appointmentTime',
          'captureRequestId',
          'patientId',
          'patientName',
          'providerName',
          'waitingSince',
        ]);
      }
    });

    it('carries no benefit or dollar amount (hard rule 4)', async () => {
      const res = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/\$\s?\d/);
    });

    it('drops a signed agreement off the list, and one whose request was completed', async () => {
      const extra = await prisma.withPractice(practiceA, async (tx) => {
        const provider = await tx.provider.findFirst({});
        const patient = await tx.patient.create({
          data: { practiceId: practiceA, familyName: 'Done', givenNames: 'Dana', dateOfBirth: new Date('1975-05-05') },
        });
        const assignor = await tx.assignor.create({
          data: { practiceId: practiceA, name: 'Dana Done', authorityBasis: 'self', dateOfBirth: new Date('1975-05-05') },
        });
        const agreement = await tx.agreement.create({
          data: {
            practiceId: practiceA,
            type: 'episodic_pre',
            anchorKind: 'provider',
            providerId: provider!.id,
            patientId: patient.id,
            assignorId: assignor.id,
            assignorIsPatient: true,
            status: 'signed',
          },
        });
        return tx.captureRequest.create({
          data: { practiceId: practiceA, agreementId: agreement.id, channel: 'in_practice' },
        });
      });

      const res = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);
      expect(res.body.waiting.map((r: { captureRequestId: string }) => r.captureRequestId)).not.toContain(extra.id);

      await prisma.withPractice(practiceA, (tx) =>
        tx.captureRequest.deleteMany({ where: { id: extra.id } }),
      );
    });

    it('refuses a request from no device at all', async () => {
      // It used to be a 400 for a missing header. There is no header to miss
      // any more: an unpaired tablet is refused outright, which is what lets
      // this route be reachable from the internet at all.
      await request(app.getHttpServer()).get('/kiosk/waiting-list').expect(401);
    });
  });

  describe('freshness (§9.4 — the kiosk polls fast, but only while waiting)', () => {
    it('tells the device how fast to ask again: fast while somebody waits, slower when nobody does', async () => {
      const busy = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);
      expect(busy.body.pollMs).toBe(KIOSK_POLL_MS.waitingMs);

      // Practice B's own list, emptied: nothing expected, so ask slowly —
      // but still ask, because a walk-in is exactly what nobody booked.
      await prisma.withPractice(practiceB, (tx) =>
        tx.captureRequest.updateMany({ data: { status: 'cancelled' } }),
      );
      const quiet = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletB)
        .expect(200);
      expect(quiet.body.waiting).toEqual([]);
      expect(quiet.body.pollMs).toBe(KIOSK_POLL_MS.idleMs);
      expect(quiet.body.pollMs).toBeGreaterThan(0);

      await prisma.withPractice(practiceB, (tx) => tx.captureRequest.updateMany({ data: { status: 'open' } }));
    });

    it('answers 304 with no body while the list has not moved', async () => {
      const first = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);
      const etag = first.headers.etag;
      expect(etag).toBeTruthy();
      expect(first.headers['cache-control']).toBe('no-store');

      const again = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .set('If-None-Match', etag)
        .expect(304);
      expect(again.body).toEqual({});
    });

    it('changes the tag when a waiting patient moves on, so the tablet re-renders', async () => {
      const before = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);

      await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.update({ where: { id: bookedAgreementId }, data: { status: 'awaiting_signature' } }),
      );

      const after = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .set('If-None-Match', before.headers.etag)
        .expect(200);
      expect(after.headers.etag).not.toBe(before.headers.etag);
      expect(after.body.waiting[0].agreementStatus).toBe('awaiting_signature');

      await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.update({ where: { id: bookedAgreementId }, data: { status: 'verification_pending' } }),
      );
    });
  });

  describe('tenancy', () => {
    it('cross_practice_kiosk_read_fails_closed — practice B\'s tablet never sees practice A\'s waiting room', async () => {
      const res = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletB)
        .expect(200);

      const ids = res.body.waiting.map((r: { captureRequestId: string }) => r.captureRequestId);
      expect(ids).not.toContain(bookedRequestId);
      expect(ids).not.toContain(walkInRequestId);
      expect(JSON.stringify(res.body)).not.toContain('Robin Reachable');
      expect(JSON.stringify(res.body)).not.toContain('Casey Walkin');
      // And B sees exactly its own one.
      expect(res.body.waiting).toHaveLength(1);
      expect(res.body.waiting[0].patientName).toBe('Alex Elsewhere');
    });

    it('unscoped_kiosk_read_fails_closed — a practice id in a header buys nothing at all', async () => {
      /*
       * THE OLD HOLE, ASSERTED SHUT. This request — a practice id, no
       * credential — is precisely what anybody who found the URL could send,
       * and it used to return that practice's waiting room. It now returns
       * nothing, and it does not return an EMPTY LIST either: an empty list
       * would still be an answer about somebody else's practice ("nobody is
       * waiting there"), and the honest answer to a caller with no device is
       * that they are not being answered at all.
       */
      const res = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-practice-id', practiceA)
        .expect(401);
      expect(res.body.waiting).toBeUndefined();

      await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-practice-id', randomUUID())
        .expect(401);
    });
  });

  describe('a confidentiality flag keeps a name off a waiting-room screen', () => {
    it('omits a flagged patient even when a request was opened for them', async () => {
      await prisma.withPractice(practiceA, (tx) =>
        tx.patient.update({ where: { id: bookedPatientId }, data: { confidentialityFlag: true } }),
      );
      const res = await request(app.getHttpServer())
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletA)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain('Robin Reachable');
      expect(res.body.waiting.map((r: { captureRequestId: string }) => r.captureRequestId)).not.toContain(
        bookedRequestId,
      );

      await prisma.withPractice(practiceA, (tx) =>
        tx.patient.update({ where: { id: bookedPatientId }, data: { confidentialityFlag: false } }),
      );
    });
  });
});
