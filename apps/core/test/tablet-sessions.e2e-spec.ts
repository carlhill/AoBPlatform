import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { SERVICE_DESCRIPTIONS, TABLET_SESSION_IDLE_MS } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DevicesService } from '../src/devices/devices.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';

/**
 * PUSH-TO-DEVICE CAPTURE — reception hands the patient a locked screen
 * (TODO.md "Push-to-device capture" and "Two front doors", Carl 4 Sep 2026).
 *
 * WHAT THIS SUITE PINS, and every one of them is a rule rather than a
 * behaviour somebody liked:
 *
 *  - THE PUSH IS ONE ACT. The particulars are validated and locked, a
 *    staff-verified verification event is recorded with the staff member's
 *    identity, the capture request is opened and the session is created — all
 *    in one transaction, with their vault events (hard rule 11). A tablet
 *    holding an agreement with no record of who verified the patient is
 *    structurally impossible.
 *  - A DRAFT NEVER REACHES A DEVICE (REQ-REG-06). The push refuses everything
 *    the lock would refuse, before any device sees anything.
 *  - ENDING A SESSION CHANGES NOTHING ON THE AGREEMENT. Walking away and
 *    recall are asserted field by field, because "nothing blocks care" is only
 *    true if nothing actually moves (hard rule 8, REQ-REC-04).
 *  - NO IDENTIFIER VALUE LEAVES THE TYPES. The ticks record which details were
 *    confirmed and never what they said (REQ-VER-04), and the tablet's payload
 *    has no Medicare-shaped key anywhere in it (hard rule 1).
 *  - TENANCY FAILS CLOSED, both ways round: another practice's agreement and
 *    another practice's tablet.
 *
 * THE RULES ENGINE IS STUBBED, AND IT EVALUATES C6 THE WAY THE DRAFT SET DOES.
 * A stub that waved everything through would make "the push refused a draft
 * with no D6a" unfalsifiable, which is the one thing half this file is about.
 */

/** The receptionist doing the work. `null` = nobody signed in. */
const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-00000007ab01',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

/**
 * `@PracticeScoped` on the console acts means the caller must CARRY a practice
 * claim, not merely send a header — a platform operator reaches these only by
 * acting as the practice, which leaves a record of on whose behalf. So the
 * receptionist is signed in AT a practice, and the tenancy tests below sign in
 * at the one whose act they are attempting.
 */
function signedInAt(practiceId: string): void {
  currentPrincipal = { ...RECEPTIONIST, practiceId };
}

const D6A = SERVICE_DESCRIPTIONS[0];

const c6EvaluatingRules = {
  validate: async ({ payload }: { payload: unknown }): Promise<ValidationResponse> => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const isPre = p.agreementType === 'episodic_pre' || p.agreementType === 'treatment_plan';
    const ok = !isPre || (SERVICE_DESCRIPTIONS as readonly string[]).includes(p.basicServiceDescription as string);
    return {
      valid: ok,
      results: [
        {
          rule: 'C6',
          outcome: ok ? 'pass' : 'fail',
          message: 'D6a: a pre-agreement requires a basic service description drawn from the current mapping.',
          citation: 's 65C(4); REQ-REG-03',
        },
      ],
      ruleSetVersion: 'test-rules-1',
      mappingVersion: 'test-mapping-1',
    };
  },
};

describe('push to a paired tablet (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();

  let providerA: string;
  let patientA: string;
  let assignorA: string;
  let tabletA: string;
  let tabletACredential: string;
  let secondTabletA: string;

  let providerB: string;
  let patientB: string;
  let assignorB: string;
  let tabletB: string;

  const http = () => request(app.getHttpServer());

  /** A registered, paired tablet — the service path, as the other suites use. */
  async function pairTablet(practiceId: string, label: string) {
    const devices = app.get(DevicesService);
    const { deviceId, code } = await devices.registerForDev(practiceId, label);
    const { credential } = await devices.pair(code, `tablet-sessions-${label}`);
    return { deviceId, credential };
  }

  /**
   * A pre-agreement draft with D6a already set — the ordinary state of a row
   * on reception's list, because the appointment sweep applies the practice
   * default and the reconciliation screen fills the rest.
   */
  async function draft(
    opts: {
      practiceId?: string;
      description?: string | null;
      type?: string;
      assignorIsPatient?: boolean;
      assignorId?: string;
    } = {},
  ): Promise<string> {
    const practiceId = opts.practiceId ?? practiceA;
    const isB = practiceId === practiceB;
    return prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.create({
        data: {
          practiceId,
          type: opts.type ?? 'episodic_pre',
          anchorKind: 'provider',
          providerId: isB ? providerB : providerA,
          patientId: isB ? patientB : patientA,
          assignorId: opts.assignorId ?? (isB ? assignorB : assignorA),
          assignorIsPatient: opts.assignorIsPatient ?? true,
          enduringPathway: (opts.type ?? 'episodic_pre') === 'enduring' ? 'mymedicare' : null,
          status: 'draft',
          serviceDescription: opts.description === null ? null : (opts.description ?? D6A),
        },
      });
      return agreement.id;
    });
  }

  const pushTo = (deviceId: string, agreementId: string, practiceId = practiceA) =>
    http().post(`/devices/${deviceId}/push`).set('x-practice-id', practiceId).send({ agreementId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(c6EvaluatingRules)
      .compile();
    app = moduleRef.createNestApplication();
    // Middleware runs before the guards and cannot be forged by a client —
    // the same seam the device-pairing and service-description suites use.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.practice.create({ data: { id: practiceA, name: 'Push Test Practice A' } });
      providerA = (
        await tx.provider.create({
          data: { practiceId: practiceA, name: 'Dr Example Provider', providerType: 'general_practitioner' },
        })
      ).id;
      patientA = (
        await tx.patient.create({
          data: {
            practiceId: practiceA,
            familyName: 'Sampleton',
            givenNames: 'Jamie',
            // Obviously fake. Some of it reaches the tablet — see the payload
            // test — and some of it must never.
            dateOfBirth: new Date('1957-03-14'),
            genderAsIdentified: 'female',
            address: '12 Example Street, Sydney NSW 2000',
            patientRecordNumber: 'PRN-0001',
            ihi: '8003600000000000',
            mobile: '+61400000001',
            email: 'jamie.sampleton@example.invalid',
          },
        })
      ).id;
      assignorA = (
        await tx.assignor.create({
          data: { practiceId: practiceA, name: 'Jamie Sampleton', authorityBasis: 'self' },
        })
      ).id;
    });

    await prisma.withPractice(practiceB, async (tx) => {
      await tx.practice.create({ data: { id: practiceB, name: 'Push Test Practice B' } });
      providerB = (
        await tx.provider.create({
          data: { practiceId: practiceB, name: 'Dr Other Provider', providerType: 'general_practitioner' },
        })
      ).id;
      patientB = (
        await tx.patient.create({
          data: {
            practiceId: practiceB,
            familyName: 'Elsewhere',
            givenNames: 'Alex',
            dateOfBirth: new Date('1988-02-02'),
            address: '9 Other Road, Melbourne VIC 3000',
          },
        })
      ).id;
      assignorB = (
        await tx.assignor.create({
          data: { practiceId: practiceB, name: 'Alex Elsewhere', authorityBasis: 'self' },
        })
      ).id;
    });

    const first = await pairTablet(practiceA, 'Reception tablet 1');
    tabletA = first.deviceId;
    tabletACredential = first.credential;
    secondTabletA = (await pairTablet(practiceA, 'Reception tablet 2')).deviceId;
    tabletB = (await pairTablet(practiceB, 'Other practice tablet')).deviceId;
  });

  beforeEach(() => {
    signedInAt(practiceA);
  });

  afterEach(async () => {
    // Every test starts with both tablets free. Ending sessions directly is
    // the test harness's business, not an endpoint — nothing in the product
    // deletes a session.
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, (tx) =>
        tx.tabletSession.updateMany({
          where: { endedAt: null },
          data: { state: 'recalled', endedAt: new Date() },
        }),
      );
    }
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.tabletSession.deleteMany({});
        await tx.devicePairingCode.deleteMany({ where: { practiceId } });
        await tx.device.deleteMany({});
        await tx.captureRequest.deleteMany({});
        /*
         * THE VERIFICATION EVENTS ARE DELIBERATELY NOT CLEANED UP, and the
         * database says why: a DELETE raises "verification events are
         * append-only evidence (REQ-VER-04)". Evidence outliving its subject is
         * the design (hard rule 11), and a test that could delete it would be a
         * test proving the opposite of what the table promises — the same
         * reasoning `signature.e2e-spec.ts` gives about signature artefacts.
         * The challenges go with them, for the same reason: an event whose
         * challenge had been deleted would say which types were checked and
         * nothing about when they were asked.
         */
        await tx.appointment.deleteMany({});
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

  // -------------------------------------------------------------------------

  describe('the push', () => {
    it('push_locks_particulars_and_records_staff_verification_in_one_transaction', async () => {
      const agreementId = await draft();

      const res = await pushTo(tabletA, agreementId).expect(201);
      expect(res.body).toMatchObject({
        deviceId: tabletA,
        deviceLabel: 'Reception tablet 1',
        agreementId,
        state: 'pushed',
        patientName: 'Jamie Sampleton',
        providerName: 'Dr Example Provider',
        pushedBy: expect.any(String),
      });

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      // REQ-REG-06: complete and locked BEFORE any device sees it, and ready
      // to sign rather than merely locked.
      expect(after!.particularsLockedAt).not.toBeNull();
      expect(after!.status).toBe('awaiting_signature');
      expect(after!.ruleSetVersion).toBe('test-rules-1');
      // Rule 13/14: the artefact was rendered and hashed at lock, and both
      // versions that validated it are on the record.
      expect(after!.renderedArtefactHash).toEqual(expect.any(String));
      expect(after!.mappingVersion).toBe('test-mapping-1');

      // THE PUSH IS THE VERIFICATION RECORD (REQ-VER-03/-04).
      const event = await prisma.withPractice(practiceA, (tx) =>
        tx.verificationEvent.findFirst({ where: { id: after!.verificationEventId! } }),
      );
      expect(event).toMatchObject({
        outcome: 'passed',
        channel: 'in_practice',
        verifiedByStaffId: RECEPTIONIST.sub,
        patientId: patientA,
      });
      // TYPES, and only from the approved set. `mobile` and `email` are
      // contact details and are NOT identifiers (REQ-VER-02) — reception asked
      // for them, and they are not counted toward the three.
      expect(event!.identifierTypes.sort()).toEqual(['address', 'date_of_birth', 'name']);
      expect(JSON.stringify(event)).not.toContain('1957-03-14');
      expect(JSON.stringify(event)).not.toContain('12 Example Street');
      expect(JSON.stringify(event)).not.toContain('Jamie');

      // The capture request the tablet signs against, opened by the push.
      const captureRequest = await prisma.withPractice(practiceA, (tx) =>
        tx.captureRequest.findFirst({ where: { agreementId, channel: 'in_practice' } }),
      );
      expect(captureRequest!.status).toBe('open');

      // Hard rule 11: every one of them evidenced, through the outbox.
      const events = await prisma.vaultOutbox.findMany({
        where: { subjectId: { in: [agreementId, res.body.id, after!.verificationEventId!] } },
      });
      const types = events.map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining([
        'agreement.particulars_locked',
        'agreement.rendered',
        'agreement.status_changed',
        'verification.staff_verified',
        'tablet.session_pushed',
      ]));
      // The evidence names the staff member, and nothing about the patient.
      const pushed = events.find((e) => e.type === 'tablet.session_pushed')!;
      expect((pushed.actor as { principalType: string; id: string })).toMatchObject({
        principalType: 'staff',
        id: RECEPTIONIST.sub,
      });
      expect(JSON.stringify(pushed.payload)).not.toContain('Jamie');
      expect(JSON.stringify(pushed.payload)).not.toMatch(/\$\s?\d/);
    });

    it('the push refuses an unattributed caller — a verification recorded as nobody is worse than a refusal', async () => {
      const agreementId = await draft();
      currentPrincipal = null;
      await pushTo(tabletA, agreementId).expect(403);

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(after!.particularsLockedAt).toBeNull();
      expect(after!.status).toBe('draft');
    });

    it('push_refuses_a_draft_without_d6a — and the draft is untouched', async () => {
      const agreementId = await draft({ description: null });

      const res = await pushTo(tabletA, agreementId).expect(409);
      expect(res.body.reason).toBe('service_description_missing');
      // A rule, never the patient's data.
      expect(JSON.stringify(res.body)).not.toContain('Jamie');

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(after!.particularsLockedAt).toBeNull();
      expect(after!.status).toBe('draft');
      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { agreementId } }),
      );
      expect(session).toBeNull();
    });

    it('push_refuses_when_who_signs_is_unset — D7 is explicit, never inferred', async () => {
      /*
       * `assignorIsPatient: false` with an assignor row that names nobody is
       * exactly the state a half-finished "someone else is signing" leaves
       * behind. The contract would print a blank where it names its
       * counterparty, so the tablet never sees it.
       */
      const nameless = await prisma.withPractice(practiceA, (tx) =>
        tx.assignor.create({ data: { practiceId: practiceA, name: '   ', authorityBasis: 'parent' } }),
      );
      const agreementId = await draft({ assignorIsPatient: false, assignorId: nameless.id });

      const res = await pushTo(tabletA, agreementId).expect(409);
      expect(res.body.reason).toBe('who_is_signing_unset');

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(after!.particularsLockedAt).toBeNull();
    });

    it('refuses an enduring agreement, and says why — the s 65C rule set has no enduring path', async () => {
      const agreementId = await draft({ type: 'enduring' });

      const res = await pushTo(tabletA, agreementId).expect(409);
      expect(res.body.reason).toBe('enduring_not_supported');

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(after!.particularsLockedAt).toBeNull();
      expect(after!.status).toBe('draft');
    });

    it('refuses a revoked tablet — a revoked device would show nothing', async () => {
      const doomed = await pairTablet(practiceA, 'Tablet lost in a taxi');
      await app.get(DevicesService).revokeForDev(practiceA, doomed.deviceId);
      const agreementId = await draft();

      const res = await pushTo(doomed.deviceId, agreementId).expect(409);
      expect(res.body.reason).toBe('device_revoked');
    });

    it('one_session_per_device — and the refusal carries the session so the console can recall it', async () => {
      const first = await draft();
      const second = await draft();

      const opened = await pushTo(tabletA, first).expect(201);
      const refused = await pushTo(tabletA, second).expect(409);

      expect(refused.body.reason).toBe('device_busy');
      expect(refused.body.sessionId).toBe(opened.body.id);
      expect(refused.body.sessionState).toBe('pushed');

      // The second agreement was not touched at all — the refusal happens
      // before anything is locked.
      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: second } }),
      );
      expect(after!.particularsLockedAt).toBeNull();

      // ...and it goes to the OTHER tablet without complaint.
      await pushTo(secondTabletA, second).expect(201);
    });

    it('the same patient can be handed the tablet again after a recall, without locking twice', async () => {
      const agreementId = await draft();
      const first = await pushTo(tabletA, agreementId).expect(201);
      const lockedAt = (await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      ))!.particularsLockedAt;

      await http()
        .post(`/tablet-sessions/${first.body.id}/recall`)
        .set('x-practice-id', practiceA)
        .expect(201);

      const again = await pushTo(tabletA, agreementId).expect(201);
      expect(again.body.id).not.toBe(first.body.id);

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      // HARD-02: a locked agreement is corrected by superseding, never edited.
      // The re-push locks nothing and re-renders nothing.
      expect(after!.particularsLockedAt?.toISOString()).toBe(lockedAt?.toISOString());
      // It DOES record a fresh staff-verified event — reception has the person
      // in front of them again — and the agreement points at the newest.
      const events = await prisma.withPractice(practiceA, (tx) =>
        tx.verificationEvent.findMany({ where: { patientId: patientA, channel: 'in_practice' } }),
      );
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(after!.verificationEventId).toBe(
        events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].id,
      );
    });
  });

  // -------------------------------------------------------------------------

  describe('what the tablet receives', () => {
    it('session_payload_never_carries_a_medicare_number', async () => {
      const agreementId = await draft();
      await pushTo(tabletA, agreementId).expect(201);

      const res = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);

      const serialised = JSON.stringify(res.body);
      // Not a key, not a value, not a nested anything.
      const keys = new Set<string>();
      (function walk(value: unknown) {
        if (value === null || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          keys.add(key);
          walk(child);
        }
      })(res.body);
      for (const key of keys) expect(key).not.toMatch(/medicare/i);
      expect(serialised).not.toMatch(/medicare/i);

      // And none of the things a tablet has no business holding.
      expect(serialised).not.toContain('8003600000000000'); // IHI
      expect(serialised).not.toContain('PRN-0001'); // patient record number
      expect(serialised).not.toContain('female'); // gender
      // Nor a benefit or a dollar amount, on any agreement artefact (rule 4).
      expect(serialised).not.toMatch(/\$\s?\d/);
    });

    it('carries the particulars the patient is being asked to check, and the party signing', async () => {
      const agreementId = await draft();
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      const res = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);

      expect(res.body.session).toMatchObject({
        id: pushed.body.id,
        state: 'pushed',
        agreementType: 'episodic_pre',
        agreementId,
        captureRequestId: expect.any(String),
        assignor: { isPatient: true },
      });
      // The six permitted patient fields, and exactly those.
      expect(Object.keys(res.body.session.patient).sort()).toEqual([
        'address',
        'dateOfBirth',
        'email',
        'familyName',
        'givenNames',
        'mobile',
      ]);
      expect(res.body.session.patient).toMatchObject({
        givenNames: 'Jamie',
        familyName: 'Sampleton',
        dateOfBirth: '1957-03-14',
        address: '12 Example Street, Sydney NSW 2000',
        mobile: '+61400000001',
        email: 'jamie.sampleton@example.invalid',
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('answers { session: null } when nothing has been pushed, and 401 with no credential', async () => {
      const idle = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(idle.body).toEqual({ session: null });

      await http().get('/kiosk/session').expect(401);
      // A practice id in a header buys nothing at all — the guard deletes it.
      await http().get('/kiosk/session').set('x-practice-id', practiceA).expect(401);
    });

    it('the walk-up kiosk still answers — the push is a second use case, not a replacement', async () => {
      const res = await http()
        .get('/kiosk/waiting-list')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(res.body.practiceId).toBe(practiceA);
      expect(Array.isArray(res.body.waiting)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------

  describe('the ceremony', () => {
    it('confirm_details_records_types_not_values', async () => {
      const agreementId = await draft();
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      const res = await http()
        .post(`/kiosk/session/${pushed.body.id}/confirm-details`)
        .set('x-device-credential', tabletACredential)
        .send({ confirmed: ['name', 'date_of_birth', 'address', 'mobile', 'email'] })
        .expect(201);
      expect(res.body.state).toBe('details_confirmed');

      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.detailsConfirmedTypes.sort()).toEqual([
        'address',
        'date_of_birth',
        'email',
        'mobile',
        'name',
      ]);
      expect(session!.detailsConfirmedAt).not.toBeNull();

      const event = await prisma.vaultOutbox.findFirst({
        where: { subjectId: pushed.body.id, type: 'tablet.details_confirmed' },
      });
      expect(event).not.toBeNull();
      const payload = event!.payload as Record<string, unknown>;
      // The TYPES, and it says in the record that it is NOT a verification.
      expect(payload.confirmedTypes).toBe('address,date_of_birth,email,mobile,name');
      expect(payload.isVerification).toBe(false);
      // No value of any kind, anywhere near it.
      const serialised = JSON.stringify(event);
      expect(serialised).not.toContain('1957-03-14');
      expect(serialised).not.toContain('12 Example Street');
      expect(serialised).not.toContain('+61400000001');
      expect(serialised).not.toContain('jamie.sampleton@example.invalid');
      expect(serialised).not.toContain('Jamie');
    });

    it('refuses a detail type that is not on the list — there is no field for a value', async () => {
      const agreementId = await draft();
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      await http()
        .post(`/kiosk/session/${pushed.body.id}/confirm-details`)
        .set('x-device-credential', tabletACredential)
        .send({ confirmed: ['name', 'ihi'] })
        .expect(400);
    });

    it('walked_away_changes_nothing_on_the_agreement', async () => {
      const agreementId = await draft();
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );

      const res = await http()
        .post(`/kiosk/session/${pushed.body.id}/state`)
        .set('x-device-credential', tabletACredential)
        .send({ state: 'walked_away' })
        .expect(201);
      expect(res.body.state).toBe('walked_away');

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      // FIELD BY FIELD, because "nothing blocks care" is only true if nothing
      // moved (hard rule 8, REQ-REC-04).
      expect(after).toEqual(before);
      // The capture request stays open: the patient may still sign by another
      // channel, or be handed the tablet again.
      const captureRequest = await prisma.withPractice(practiceA, (tx) =>
        tx.captureRequest.findFirst({ where: { agreementId, channel: 'in_practice' } }),
      );
      expect(captureRequest!.status).toBe('open');
      // And the device is free again immediately.
      const idle = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(idle.body).toEqual({ session: null });
    });

    it('recall_changes_nothing_on_the_agreement', async () => {
      const agreementId = await draft();
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );

      const res = await http()
        .post(`/tablet-sessions/${pushed.body.id}/recall`)
        .set('x-practice-id', practiceA)
        .expect(201);
      expect(res.body.state).toBe('recalled');

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(after).toEqual(before);

      // The tablet's next poll sees nothing at all.
      const idle = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(idle.body).toEqual({ session: null });
    });

    it('a session left untouched for thirty minutes expires, and changes nothing either', async () => {
      const agreementId = await draft();
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );

      // Wind the clock back on the row rather than waiting half an hour.
      await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.update({
          where: { id: pushed.body.id },
          data: { lastStateAt: new Date(Date.now() - TABLET_SESSION_IDLE_MS - 1000) },
        }),
      );

      const idle = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(idle.body).toEqual({ session: null });

      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.state).toBe('expired');
      expect(session!.endedAt).not.toBeNull();

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(after).toEqual(before);
    });

    it('a device may not act on another device’s session', async () => {
      const agreementId = await draft();
      const pushed = await pushTo(secondTabletA, agreementId).expect(201);

      // Same practice, wrong tablet: not found, rather than refused.
      await http()
        .post(`/kiosk/session/${pushed.body.id}/state`)
        .set('x-device-credential', tabletACredential)
        .send({ state: 'reading' })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------

  describe("reception's view", () => {
    it('lists what is on the practice’s tablets — states, never a mirror', async () => {
      const agreementId = await draft();
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      await http()
        .post(`/kiosk/session/${pushed.body.id}/state`)
        .set('x-device-credential', tabletACredential)
        .send({ state: 'reading' })
        .expect(201);

      const res = await http()
        .get('/tablet-sessions?active=true')
        .set('x-practice-id', practiceA)
        .expect(200);

      const row = (res.body as Array<Record<string, unknown>>).find((r) => r.id === pushed.body.id);
      expect(row).toMatchObject({
        deviceId: tabletA,
        deviceLabel: 'Reception tablet 1',
        state: 'reading',
        patientName: 'Jamie Sampleton',
        providerName: 'Dr Example Provider',
      });
      // A staff surface may show a name. It shows nothing else about the
      // person: reception is watching a state, not mirroring a screen.
      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain('1957-03-14');
      expect(serialised).not.toContain('12 Example Street');
      expect(serialised).not.toContain('+61400000001');
    });

    it('the pushable list says which drafts can go, and why the others cannot', async () => {
      const ready = await draft();
      const noDescription = await draft({ description: null });
      const enduring = await draft({ type: 'enduring' });

      const res = await http()
        .get('/tablet-sessions/pushable')
        .set('x-practice-id', practiceA)
        .expect(200);

      const rows = res.body as Array<Record<string, unknown>>;
      const find = (id: string) => rows.find((r) => r.agreementId === id);

      expect(find(ready)).toMatchObject({ pushable: true, blockedReason: null, assignorIsPatient: true });
      expect(find(noDescription)).toMatchObject({
        pushable: false,
        blockedReason: 'service_description_missing',
      });
      expect(find(enduring)).toMatchObject({ pushable: false, blockedReason: 'enduring_not_supported' });
      // Blocked rows are LISTED rather than hidden — reception must be able to
      // see who needs fixing (TODO.md, 4 Sep 2026).
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------

  describe('tenancy', () => {
    it('cross_practice_push_fails_closed — practice A cannot push practice B’s agreement', async () => {
      const theirs = await draft({ practiceId: practiceB });

      const res = await pushTo(tabletA, theirs, practiceA).expect(404);
      expect(res.body.reason).toBe('agreement_not_found');
      // And it says nothing about the other practice at all.
      expect(JSON.stringify(res.body)).not.toContain('Alex');

      const after = await prisma.withPractice(practiceB, (tx) =>
        tx.agreement.findFirst({ where: { id: theirs } }),
      );
      expect(after!.particularsLockedAt).toBeNull();
      expect(after!.status).toBe('draft');
    });

    it('a device belonging to another practice fails closed', async () => {
      const mine = await draft();

      const res = await pushTo(tabletB, mine, practiceA).expect(404);
      expect(res.body.reason).toBe('device_unknown');
      // Nothing about the other practice's tablet leaks, not even its label.
      expect(JSON.stringify(res.body)).not.toContain('Other practice tablet');

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: mine } }),
      );
      expect(after!.particularsLockedAt).toBeNull();
    });

    it('practice B’s tablet never sees practice A’s pushed session', async () => {
      const mine = await draft();
      await pushTo(tabletA, mine).expect(201);

      /*
       * SIGNED IN AT B, not merely asserting B in a header. The auth guard
       * overwrites `x-practice-id` from the token's own claim, which is the
       * whole point of the claim — so a test that only sent a header would be
       * testing nothing at all.
       */
      signedInAt(practiceB);
      const theirs = await http()
        .get('/tablet-sessions?active=true')
        .set('x-practice-id', practiceB)
        .expect(200);
      expect(JSON.stringify(theirs.body)).not.toContain('Jamie');
      expect((theirs.body as unknown[]).length).toBe(0);
    });

    it('recall across a practice boundary finds nothing', async () => {
      const mine = await draft();
      const pushed = await pushTo(tabletA, mine).expect(201);

      signedInAt(practiceB);
      await http()
        .post(`/tablet-sessions/${pushed.body.id}/recall`)
        .set('x-practice-id', practiceB)
        .expect(404);

      // Still live, and still practice A's.
      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.endedAt).toBeNull();
    });
  });
});
