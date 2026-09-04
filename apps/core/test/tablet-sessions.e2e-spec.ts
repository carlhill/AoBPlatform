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
 * ONE EVENT TYPE CAN BE MADE TO FAIL, so "the row and its event commit
 * together" can be asserted rather than assumed.
 *
 * A DATABASE TRIGGER WOULD HAVE BEEN NEATER AND IS NOT AVAILABLE: the
 * application's own role has no rights to create functions in `core` —
 * correctly, since it is the role the service runs as, and a service that can
 * define triggers can define anything. `jest.spyOn` cannot help either, because
 * the compiled module's exports are non-configurable getters. So the module is
 * mocked and delegates to the real implementation for everything except the one
 * type a test arms.
 *
 * The `mock` prefix is required: the factory is hoisted above the imports, and
 * only identifiers beginning with `mock` may be referenced from inside it.
 */
let mockFailVaultEventType: string | null = null;

jest.mock('@aobplatform/vault-client', () => {
  const actual = jest.requireActual('@aobplatform/vault-client');
  return {
    ...actual,
    enqueueVaultEvent: async (writer: unknown, event: { type: string }) => {
      if (mockFailVaultEventType && event.type === mockFailVaultEventType) {
        throw new Error('vault outbox refused for the test');
      }
      return actual.enqueueVaultEvent(writer, event);
    },
  };
});

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
  let secondTabletACredential: string;

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
      /** A patient of this practice other than the suite's shared one. */
      patientId?: string;
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
          patientId: opts.patientId ?? (isB ? patientB : patientA),
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
    const second = await pairTablet(practiceA, 'Reception tablet 2');
    secondTabletA = second.deviceId;
    // Its own credential, so a test needing TWO live sessions at once can drive
    // the second tablet's own ceremony as well as the first's.
    secondTabletACredential = second.credential;
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

    it('timed_out_ends_the_session_and_changes_nothing_on_the_agreement', async () => {
      // `timed_out` is what the tablet's own inactivity clock posts, never a
      // person's press — but the endpoint takes the caller's word for which
      // one happened, so the assertions are identical to `walked_away`'s
      // (Carl, 4 Sep 2026).
      const agreementId = await draft();
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );

      const res = await http()
        .post(`/kiosk/session/${pushed.body.id}/state`)
        .set('x-device-credential', tabletACredential)
        .send({ state: 'timed_out' })
        .expect(201);
      expect(res.body.state).toBe('timed_out');

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      // FIELD BY FIELD, exactly as `walked_away` is checked — hard rule 8,
      // REQ-REC-04.
      expect(after).toEqual(before);
      const captureRequest = await prisma.withPractice(practiceA, (tx) =>
        tx.captureRequest.findFirst({ where: { agreementId, channel: 'in_practice' } }),
      );
      expect(captureRequest!.status).toBe('open');
      // The device is free again immediately, exactly as after a walk-away.
      const idle = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(idle.body).toEqual({ session: null });

      const event = await prisma.vaultOutbox.findFirst({
        where: { subjectId: pushed.body.id, type: 'tablet.session_ended' },
      });
      expect(event).not.toBeNull();
      const payload = event!.payload as Record<string, unknown>;
      expect(payload.to).toBe('timed_out');
      expect(payload.agreementChanged).toBe(false);
    });

    it('timed_out_is_distinct_from_walked_away_and_expired', async () => {
      // Same effect on the record, different word — the one thing this whole
      // feature is (Carl's ruling, 4 Sep 2026). Three sessions, three ways of
      // ending, three different stored states, so reception can tell "asked
      // for help" from "left the screen running" from "the server gave up".
      // One device, used in sequence: each session is ended before the next
      // is pushed, so `device_busy` never gets in the way.
      const walkedAgreement = await draft();
      const walked = await pushTo(tabletA, walkedAgreement).expect(201);
      await http()
        .post(`/kiosk/session/${walked.body.id}/state`)
        .set('x-device-credential', tabletACredential)
        .send({ state: 'walked_away' })
        .expect(201);

      const timedOutAgreement = await draft();
      const timedOut = await pushTo(tabletA, timedOutAgreement).expect(201);
      await http()
        .post(`/kiosk/session/${timedOut.body.id}/state`)
        .set('x-device-credential', tabletACredential)
        .send({ state: 'timed_out' })
        .expect(201);

      const expiredAgreement = await draft();
      const expired = await pushTo(tabletA, expiredAgreement).expect(201);
      await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.update({
          where: { id: expired.body.id },
          data: { lastStateAt: new Date(Date.now() - TABLET_SESSION_IDLE_MS - 1000) },
        }),
      );
      // A poll settles the server-side expiry — the same mechanism as the
      // existing thirty-minute test above.
      await http().get('/kiosk/session').set('x-device-credential', tabletACredential).expect(200);

      const rows = await http()
        .get('/tablet-sessions?active=false')
        .set('x-practice-id', practiceA)
        .expect(200);
      const stateById = new Map((rows.body as Array<{ id: string; state: string }>).map((r) => [r.id, r.state]));
      expect(stateById.get(walked.body.id)).toBe('walked_away');
      expect(stateById.get(timedOut.body.id)).toBe('timed_out');
      expect(stateById.get(expired.body.id)).toBe('expired');
      // Three distinct words, none of them equal to another.
      expect(new Set([stateById.get(walked.body.id), stateById.get(timedOut.body.id), stateById.get(expired.body.id)]).size).toBe(3);
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

    it('pushable_reads_d6a_from_locked_particulars — the same read lockParticulars does', async () => {
      // The column is what a lock through the DTO does NOT have to fill: a
      // caller can supply `basicServiceDescription` straight to the lock, and
      // only the rendered snapshot in `particulars` ever carries it. Written
      // directly here rather than through `POST /agreements/:id/lock-particulars`
      // so the fixture is exactly that shape — locked, with D6a nowhere but
      // the particulars snapshot.
      const agreementId = await draft({ description: null });
      await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.update({
          where: { id: agreementId },
          data: {
            particulars: { basicServiceDescription: D6A },
            particularsLockedAt: new Date(),
          },
        }),
      );

      const res = await http().get('/tablet-sessions/pushable').set('x-practice-id', practiceA).expect(200);
      const rows = res.body as Array<Record<string, unknown>>;
      const row = rows.find((r) => r.agreementId === agreementId);

      // Neither "Not set" nor blocked for want of a description it already has.
      expect(row).toMatchObject({
        pushable: true,
        blockedReason: null,
        serviceDescription: D6A,
        serviceDescriptionValid: true,
      });
    });

    it('pushable_excludes_agreements_whose_capture_is_closed — a stale attempt does not shadow a fresh one', async () => {
      // The first attempt: opened, then closed without a signature — timed
      // out, walked away, or superseded. Nothing will reopen it.
      const stale = await draft();
      await prisma.withPractice(practiceA, (tx) =>
        tx.captureRequest.create({
          data: { practiceId: practiceA, agreementId: stale, channel: 'in_practice', status: 'expired' },
        }),
      );

      // A fresh draft for the same visit, never yet handed to a capture path.
      const fresh = await draft();

      // And one mid-flight, its in-practice capture request still open.
      const openOne = await draft();
      await prisma.withPractice(practiceA, (tx) =>
        tx.captureRequest.create({
          data: { practiceId: practiceA, agreementId: openOne, channel: 'in_practice', status: 'open' },
        }),
      );

      const res = await http().get('/tablet-sessions/pushable').set('x-practice-id', practiceA).expect(200);
      const ids = (res.body as Array<Record<string, unknown>>).map((r) => r.agreementId);

      // The closed attempt is gone — not merely outranked, absent — so
      // reception is never shown the same patient's visit twice.
      expect(ids).not.toContain(stale);
      expect(ids).toContain(fresh);
      expect(ids).toContain(openOne);
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

    it('a correction across a practice boundary finds nothing', async () => {
      /*
       * FAILS CLOSED, AND SAYS NOTHING. Practice A, signed in as itself, asks
       * to correct practice B's patient. RLS filters on the transaction-local
       * scope, so the row is NOT FOUND rather than refused — a refusal would
       * confirm that the id names somebody, somewhere.
       */
      const before = await prisma.withPractice(practiceB, (tx) =>
        tx.patient.findFirst({ where: { id: patientB } }),
      );

      const res = await http()
        .patch(`/patients/${patientB}/details`)
        .set('x-practice-id', practiceA)
        .send({ address: '99 Trespass Lane, Nowhere NSW 2000' })
        .expect(404);
      expect(JSON.stringify(res.body)).not.toContain('Alex');
      expect(JSON.stringify(res.body)).not.toContain('9 Other Road');

      const after = await prisma.withPractice(practiceB, (tx) =>
        tx.patient.findFirst({ where: { id: patientB } }),
      );
      expect(after!.address).toBe(before!.address);
      expect(after!.detailsCorrectedAt).toBeNull();
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

  // -------------------------------------------------------------------------

  /**
   * TICK OR CROSS PER ROW, AND RECEPTION SEES WHICH (Carl, 4 Sep 2026).
   *
   * The four things this describes, and each is a rule rather than a behaviour
   * somebody liked:
   *
   *  - A CROSS TRAVELS AS A TYPE. `address`, never "12 Example Street", and
   *    never the value the patient believes is right — they were not asked
   *    (REQ-VER-04, hard rule 9).
   *  - A DISPUTE CHANGES NOTHING ON THE AGREEMENT. It stops a ceremony, not a
   *    visit (hard rule 8, REQ-REC-04) — asserted field by field, because
   *    "nothing blocks care" is only true if nothing actually moves.
   *  - A CORRECTION NAMES THE FIELD AND THE PERSON AND NEVER THE VALUE, and
   *    refuses a Medicare field out loud rather than dropping it silently
   *    (hard rule 1, REQ-VER-02).
   *  - A RE-SEND SUPERSEDES A LOCKED AGREEMENT WHOSE PARTICULARS MOVED
   *    (HARD-02) and re-uses it when only a contact detail did.
   */
  describe('a detail the patient says is wrong', () => {
    /**
     * A PATIENT OF THIS PRACTICE THAT NO OTHER TEST SHARES. These tests
     * CHANGE the patient row, and the suite's own `patientA` is asserted
     * against by name and address in half the file above.
     */
    async function freshPatient(givenNames: string) {
      return prisma.withPractice(practiceA, async (tx) => {
        const patient = await tx.patient.create({
          data: {
            practiceId: practiceA,
            familyName: 'Crossfield',
            givenNames,
            // Obviously fake, and deliberately distinctive: every assertion
            // below is that these strings do NOT appear somewhere.
            dateOfBirth: new Date('1969-11-02'),
            genderAsIdentified: 'male',
            address: '404 Wrongway Parade, Sampletown NSW 2000',
            mobile: '+61400000404',
            email: 'wrong.address@example.invalid',
          },
        });
        const assignor = await tx.assignor.create({
          data: { practiceId: practiceA, name: `${givenNames} Crossfield`, authorityBasis: 'self' },
        });
        return { patientId: patient.id, assignorId: assignor.id };
      });
    }

    const answer = (sessionId: string, body: { confirmed: string[]; disputed?: string[] }) =>
      http()
        .post(`/kiosk/session/${sessionId}/confirm-details`)
        .set('x-device-credential', tabletACredential)
        .send(body);

    it('disputed_details_are_types_not_values', async () => {
      const { patientId, assignorId } = await freshPatient('Dana');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      const res = await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'email'],
        disputed: ['address', 'mobile'],
      }).expect(201);
      expect(res.body.state).toBe('details_disputed');
      expect([...res.body.disputed].sort()).toEqual(['address', 'mobile']);

      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.detailsDisputedTypes.sort()).toEqual(['address', 'mobile']);
      expect(session!.detailsConfirmedTypes.sort()).toEqual(['date_of_birth', 'email', 'name']);
      expect(session!.detailsDisputedAt).not.toBeNull();
      // A LIVE STATE, NOT AN ENDING: the device keeps the session and
      // reception's live list still shows the one row they must act on.
      expect(session!.endedAt).toBeNull();

      const event = await prisma.vaultOutbox.findFirst({
        where: { subjectId: pushed.body.id, type: 'tablet.details_disputed' },
      });
      expect(event).not.toBeNull();
      const payload = event!.payload as Record<string, unknown>;
      expect(payload.disputedTypes).toBe('address,mobile');
      expect(payload.disputedCount).toBe(2);
      expect(payload.isVerification).toBe(false);
      expect(payload.agreementChanged).toBe(false);

      // NOT ONE VALUE, ANYWHERE NEAR IT — not the one shown, and not a
      // replacement, because the patient was never asked for one.
      const serialised = JSON.stringify(event);
      for (const value of [
        '404 Wrongway Parade',
        '+61400000404',
        'wrong.address@example.invalid',
        '1969-11-02',
        'Dana',
        'Crossfield',
      ]) {
        expect(serialised).not.toContain(value);
      }

      // AND RECEPTION IS TOLD WHICH, as types, on their own list.
      const list = await http()
        .get('/tablet-sessions?active=true')
        .set('x-practice-id', practiceA)
        .expect(200);
      const row = (list.body as Array<Record<string, unknown>>).find((r) => r.id === pushed.body.id);
      expect((row!.disputedDetails as string[]).sort()).toEqual(['address', 'mobile']);
      expect(row!.state).toBe('details_disputed');
      expect(JSON.stringify(row)).not.toContain('404 Wrongway Parade');
    });

    /**
     * ONE CROSS ENDS THE TABLET'S PART IN IT (Carl, 4 Sep 2026).
     *
     * The moment a crossed row reaches reception, the screen is disabled and
     * the patient is told to wait: the only route forward is reception's
     * re-send, which builds a fresh session. This is the SERVER half of that.
     * "Blocked states are unreachable, not merely inert" (CLAUDE.md section 6)
     * is only true if the server refuses too -- a control disabled on glass is
     * a suggestion, and this endpoint is reachable by anything holding the
     * device credential.
     *
     * IT REVERSES WHAT THIS ENDPOINT USED TO ALLOW, deliberately. A second
     * answer used to extend the disputed list or take a cross back. It cannot
     * now, because reception is already acting on the first one and a record
     * that moves under the person acting on it is worse than a refusal.
     */
    it('disputed_session_refuses_a_second_confirm_details', async () => {
      const { patientId, assignorId } = await freshPatient('Quinn');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);

      const eventsBefore = await prisma.vaultOutbox.findMany({ where: { subjectId: pushed.body.id } });

      // THE PATIENT CHANGES THEIR MIND AND TICKS EVERYTHING. Too late: the
      // cross is with reception, and the way forward is their re-send.
      const refused = await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'address', 'mobile', 'email'],
      }).expect(409);
      expect(refused.body.reason).toBe('session_disputed');

      // Crossing a SECOND row is refused the same way, for the same reason.
      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'email'],
        disputed: ['address', 'mobile'],
      }).expect(409);

      // NOTHING WAS WRITTEN. The state, the answers and their timestamps are
      // exactly as the first answer left them.
      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.state).toBe('details_disputed');
      expect(session!.detailsDisputedTypes).toEqual(['address']);
      expect(session!.detailsConfirmedTypes.sort()).toEqual(['date_of_birth', 'email', 'mobile', 'name']);
      expect(session!.endedAt).toBeNull();

      // AND NOTHING WAS EMITTED. A locked-out device cannot add to the
      // evidence by retrying.
      const eventsAfter = await prisma.vaultOutbox.findMany({ where: { subjectId: pushed.body.id } });
      expect(eventsAfter).toHaveLength(eventsBefore.length);

      /*
       * RECEPTION'S OWN ACTS ARE UNAFFECTED. Resolving the dispute and
       * re-sending are staff acts on a staff surface, not the tablet's, and
       * the lock on the glass was never about them.
       */
      await http()
        .post(`/tablet-sessions/${pushed.body.id}/dispute-resolution`)
        .set('x-practice-id', practiceA)
        .send({ outcome: 'patient_error', details: ['address'] })
        .expect(201);
      const fresh = await http()
        .post(`/tablet-sessions/${pushed.body.id}/resend`)
        .set('x-practice-id', practiceA)
        .expect(201);
      // A NEW SESSION, and the patient may answer on that one.
      expect(fresh.body.id).not.toBe(pushed.body.id);
      expect(fresh.body.state).toBe('pushed');
      // AND THE SAME AGREEMENT: nothing was corrected, so nothing supersedes.
      expect(fresh.body.supersededAgreementId).toBeNull();
      await answer(fresh.body.id, {
        confirmed: ['name', 'date_of_birth', 'address', 'mobile', 'email'],
      }).expect(201);

      await http()
        .post(`/tablet-sessions/${fresh.body.id}/recall`)
        .set('x-practice-id', practiceA)
        .expect(201);
    });

    it('dispute_leaves_the_agreement_untouched', async () => {
      const { patientId, assignorId } = await freshPatient('Emery');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );

      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      /*
       * FIELD BY FIELD. A dispute stops a ceremony, not a visit: the
       * particulars stay locked exactly as they were, the artefact keeps its
       * hash, the status does not move, and nothing is declined or expired
       * (hard rule 8, REQ-REC-04).
       */
      expect(after).toEqual(before);

      // The capture request is still open, so the patient can sign by any
      // channel — or be handed the tablet again once the detail is fixed.
      const capture = await prisma.withPractice(practiceA, (tx) =>
        tx.captureRequest.findFirst({ where: { agreementId, channel: 'in_practice' } }),
      );
      expect(capture!.status).toBe('open');
    });

    it('refuses an answer that does not cover every row the tablet drew', async () => {
      const { patientId, assignorId } = await freshPatient('Frankie');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      // Four of five. A session recorded as answered having answered four
      // would be a ceremony record that says more than happened.
      await answer(pushed.body.id, { confirmed: ['name', 'date_of_birth', 'address'], disputed: ['mobile'] })
        .expect(400);

      // And a row cannot be both right and wrong.
      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'address', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(400);

      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.state).toBe('pushed');
    });

    it('correction_emits_type_and_staff_never_value', async () => {
      const { patientId } = await freshPatient('Gale');

      const res = await http()
        .patch(`/patients/${patientId}/details`)
        .set('x-practice-id', practiceA)
        .send({ address: '7 Rightway Street, Sampletown NSW 2000', mobile: '+61400000707' })
        .expect(200);
      expect(res.body.fields.sort()).toEqual(['address', 'mobile']);
      expect(res.body.types.sort()).toEqual(['address', 'mobile']);

      const patient = await prisma.withPractice(practiceA, (tx) =>
        tx.patient.findFirst({ where: { id: patientId } }),
      );
      expect(patient!.address).toBe('7 Rightway Street, Sampletown NSW 2000');
      expect(patient!.detailsCorrectedAt).not.toBeNull();
      // Per FIELD, so a later PMS sync can tell which value of its own is
      // older than our correction (D-01).
      const stamps = patient!.detailsCorrectedFields as Record<string, string>;
      expect(Object.keys(stamps).sort()).toEqual(['address', 'mobile']);

      const events = await prisma.vaultOutbox.findMany({
        where: { subjectId: patientId, type: 'patient.details_corrected' },
      });
      // ONE EVENT PER FIELD. "Somebody corrected two things" is a worse record
      // than two records naming the two things.
      expect(events.length).toBe(2);
      const byField = new Map(events.map((e) => [(e.payload as Record<string, unknown>).field, e]));
      expect([...byField.keys()].sort()).toEqual(['address', 'mobile']);

      for (const event of events) {
        const payload = event.payload as Record<string, unknown>;
        expect(payload.detailType).toBe(payload.field === 'address' ? 'address' : 'mobile');
        expect(payload.mirrorOnly).toBe(true);
        expect(payload.writtenBackToPms).toBe(false);
        // THE STAFF MEMBER, from the verified session and never the body.
        expect((event.actor as Record<string, unknown>).id).toBe(RECEPTIONIST.sub);
        expect((event.actor as Record<string, unknown>).principalType).toBe('staff');

        // AND NOT ONE CHARACTER OF THE VALUE — neither the old one nor the new.
        const serialised = JSON.stringify(event);
        for (const value of [
          '404 Wrongway Parade',
          '7 Rightway Street',
          '+61400000404',
          '+61400000707',
          'wrong.address@example.invalid',
        ]) {
          expect(serialised).not.toContain(value);
        }
      }
    });

    it('the correction refuses an unattributed caller — a change nobody can be asked about', async () => {
      const { patientId } = await freshPatient('Harper');
      currentPrincipal = null;

      await http()
        .patch(`/patients/${patientId}/details`)
        .set('x-practice-id', practiceA)
        .send({ mobile: '+61400000808' })
        .expect(400);

      const patient = await prisma.withPractice(practiceA, (tx) =>
        tx.patient.findFirst({ where: { id: patientId } }),
      );
      expect(patient!.mobile).toBe('+61400000404');
      expect(patient!.detailsCorrectedAt).toBeNull();
    });

    it('correction_refuses_medicare_field', async () => {
      const { patientId } = await freshPatient('Indigo');

      /*
       * THE KEY IS A QUOTED STRING RATHER THAN AN IDENTIFIER, deliberately.
       * The ESLint rule fails the build on an identifier with "medicare" in
       * its name anywhere outside the hard-rule test files, and this suite is
       * not one of them — so the test proves the SERVER refuses it without the
       * word ever becoming a name in this codebase (hard rule 1, REQ-VER-02).
       *
       * IT MUST BE REFUSED, NOT DROPPED. The global validation pipe strips
       * unknown fields, which would have made this a silent success — so the
       * controller passes the RAW body's keys to the service, and the service
       * says no out loud.
       */
      const res = await http()
        .patch(`/patients/${patientId}/details`)
        .set('x-practice-id', practiceA)
        .send({ 'medicareNumber': '0000 00000 0', address: '8 Should Not Save Street' })
        .expect(400);
      expect(String(res.body.message)).toMatch(/not an identity identifier/i);
      expect(String(res.body.message)).toMatch(/not configurable/i);

      // AND NOTHING ELSE IN THE REQUEST LANDED EITHER. A body carrying a
      // forbidden field is refused whole; accepting the rest would teach a
      // caller that sending it is harmless.
      const patient = await prisma.withPractice(practiceA, (tx) =>
        tx.patient.findFirst({ where: { id: patientId } }),
      );
      expect(patient!.address).toBe('404 Wrongway Parade, Sampletown NSW 2000');
      expect(patient!.detailsCorrectedAt).toBeNull();
      // There is no column for one, so nothing could have been written even
      // if the guard had let it through.
      expect(JSON.stringify(patient)).not.toContain('0000 00000 0');
    });

    it('resend_pushes_fresh_session_with_corrected_details', async () => {
      const { patientId, assignorId } = await freshPatient('Jules');
      const agreementId = await draft({ patientId, assignorId });
      const first = await pushTo(tabletA, agreementId).expect(201);

      await answer(first.body.id, {
        confirmed: ['name', 'date_of_birth', 'address', 'email'],
        disputed: ['mobile'],
      }).expect(201);

      // A CONTACT DETAIL, NOT A PARTICULAR (REQ-VER-02). It says where a copy
      // goes and nothing about the contract, so the locked agreement stands.
      await http()
        .patch(`/patients/${patientId}/details`)
        .set('x-practice-id', practiceA)
        .send({ mobile: '+61400000909' })
        .expect(200);

      const resent = await http()
        .post(`/tablet-sessions/${first.body.id}/resend`)
        .set('x-practice-id', practiceA)
        .expect(201);

      expect(resent.body.supersededAgreementId).toBeNull();
      expect(resent.body.agreementId).toBe(agreementId);
      expect(resent.body.id).not.toBe(first.body.id);
      expect(resent.body.state).toBe('pushed');
      expect(resent.body.deviceId).toBe(tabletA);
      expect(resent.body.disputedDetails).toEqual([]);

      // THE OLD SESSION IS OVER, and it was RECALLED — reception took the
      // screen back; the patient did not walk away.
      const old = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: first.body.id } }),
      );
      expect(old!.state).toBe('recalled');
      expect(old!.endedAt).not.toBeNull();

      // AND THE TABLET IS SHOWING THE CORRECTED VALUE — the payload is built
      // from the platform's own records at read time (REQ-DATA-11), which is
      // the whole reason a re-send is worth pressing.
      const shown = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(shown.body.session.id).toBe(resent.body.id);
      expect(shown.body.session.patient.mobile).toBe('+61400000909');
    });

    it('resend_supersedes_a_locked_agreement_when_a_particular_changed', async () => {
      const { patientId, assignorId } = await freshPatient('Kit');
      const agreementId = await draft({ patientId, assignorId });
      const first = await pushTo(tabletA, agreementId).expect(201);

      const locked = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(locked!.particularsLockedAt).not.toBeNull();

      await answer(first.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);

      await http()
        .patch(`/patients/${patientId}/details`)
        .set('x-practice-id', practiceA)
        .send({ address: '1 Corrected Way, Sampletown NSW 2000' })
        .expect(200);

      const resent = await http()
        .post(`/tablet-sessions/${first.body.id}/resend`)
        .set('x-practice-id', practiceA)
        .expect(201);

      /*
       * HARD-02: THE LOCKED PARTICULARS ARE HASHED IN, so a corrected
       * particular produces a NEW agreement rather than an edited one.
       */
      expect(resent.body.supersededAgreementId).toBe(agreementId);
      expect(resent.body.agreementId).not.toBe(agreementId);

      const replacement = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: resent.body.agreementId } }),
      );
      expect(replacement!.supersedesAgreementId).toBe(agreementId);
      expect(replacement!.patientId).toBe(patientId);
      // The anchor is carried, never changed — a different provider would be a
      // different agreement needing fresh consent (HARD-01).
      expect(replacement!.providerId).toBe(locked!.providerId);
      expect(replacement!.assignorIsPatient).toBe(locked!.assignorIsPatient);
      // D6a comes with it, so reception is not sent back to re-choose a
      // description nobody changed.
      expect(replacement!.serviceDescription).toBe(locked!.serviceDescription);
      // And it was locked afresh, against the CORRECTED records.
      expect(replacement!.particularsLockedAt).not.toBeNull();
      expect(replacement!.id).not.toBe(agreementId);

      /*
       * THE OLD ONE IS KEPT EXACTLY AS IT WAS. Its particulars, its hash and
       * its verification are evidence and are never rewritten — what stops it
       * being signed is that every channel that could still collect a
       * signature on the stale particulars is closed.
       */
      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(before!.particulars).toEqual(locked!.particulars);
      expect(before!.renderedArtefactHash).toBe(locked!.renderedArtefactHash);
      expect(before!.verificationEventId).toBe(locked!.verificationEventId);
      expect(before!.signatureEventId).toBeNull();

      const oldCaptures = await prisma.withPractice(practiceA, (tx) =>
        tx.captureRequest.findMany({ where: { agreementId } }),
      );
      expect(oldCaptures.every((r) => r.status !== 'open')).toBe(true);

      const superseded = await prisma.vaultOutbox.findFirst({
        where: { subjectId: agreementId, type: 'agreement.superseded' },
      });
      expect(superseded).not.toBeNull();
      const payload = superseded!.payload as Record<string, unknown>;
      expect(payload.supersededBy).toBe(replacement!.id);
      expect(payload.reason).toBe('patient_details_corrected');
      expect(payload.correctedTypes).toBe('address');
      // The TYPE, never the value (REQ-VER-04).
      expect(JSON.stringify(superseded)).not.toContain('1 Corrected Way');
      expect(JSON.stringify(superseded)).not.toContain('404 Wrongway Parade');

      // The tablet is showing the replacement, with the corrected address.
      const shown = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(shown.body.session.agreementId).toBe(replacement!.id);
      expect(shown.body.session.patient.address).toBe('1 Corrected Way, Sampletown NSW 2000');
    });

    it('superseding_agreement_keeps_d6a_and_is_pushable', async () => {
      /*
       * A LIVE BUG, CAUGHT ON RE-SEND (Carl, 4 Sep 2026). D6a can live in the
       * `serviceDescription` COLUMN (the staff surface,
       * `POST /service-descriptions/agreements/:id`) or in
       * `particulars.basicServiceDescription` (the lock's own DTO field, for a
       * caller that predates the staff surface — `prepareLock`'s own comment
       * says "the DTO still wins where it is given"). This agreement is locked
       * the SECOND way, with the column left null throughout, which is exactly
       * the shape that slipped through `supersedeForCorrection` when it copied
       * `agreement.serviceDescription` (the column) rather than reading D6a
       * the way `pushable` does.
       */
      const { patientId, assignorId } = await freshPatient('Nadia');
      const agreementId = await draft({ patientId, assignorId, description: null });

      const preLock = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(preLock!.serviceDescription).toBeNull();

      // Locked directly, D6a arriving only through the DTO — never through the
      // column-writing staff surface.
      await http()
        .post(`/agreements/${agreementId}/particulars`)
        .set('x-practice-id', practiceA)
        .send({ serviceDate: '2026-09-04', basicServiceDescription: D6A })
        .expect(201);

      const locked = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(locked!.serviceDescription).toBeNull();
      expect((locked!.particulars as Record<string, unknown>).basicServiceDescription).toBe(D6A);

      // Push the already-locked agreement (the re-push branch), dispute the
      // address, and correct it — the everyday path to a supersession.
      const first = await pushTo(tabletA, agreementId).expect(201);
      await answer(first.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);
      await http()
        .patch(`/patients/${patientId}/details`)
        .set('x-practice-id', practiceA)
        .send({ address: '2 Fixed Avenue, Sampletown NSW 2000' })
        .expect(200);

      /*
       * THE ASSERTION THAT MATTERS. `resend` supersedes and then immediately
       * pushes the replacement (`this.push(...)` at the end of `resend`), so
       * if the new draft lost D6a this call itself fails 409
       * `service_description_missing` — the exact symptom Carl saw at the
       * desk ("Service: Not set / Cannot be sent yet").
       */
      const resent = await http()
        .post(`/tablet-sessions/${first.body.id}/resend`)
        .set('x-practice-id', practiceA)
        .expect(201);
      expect(resent.body.supersededAgreementId).toBe(agreementId);

      const replacement = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: resent.body.agreementId } }),
      );
      // D6a now lives on the COLUMN of the new row, carried across from
      // wherever the old row actually held it.
      expect(replacement!.serviceDescription).toBe(D6A);
      // And the new lock's own particulars agree — a description that
      // "arrived" is one the fresh lock could read and validate against C6.
      expect((replacement!.particulars as Record<string, unknown>).basicServiceDescription).toBe(D6A);
      expect(replacement!.particularsLockedAt).not.toBeNull();
      expect(replacement!.status).toBe('awaiting_signature');

      // The tablet is showing the replacement, ready to sign — not stuck on
      // "Not set".
      const shown = await http()
        .get('/kiosk/session')
        .set('x-device-credential', tabletACredential)
        .expect(200);
      expect(shown.body.session.agreementId).toBe(replacement!.id);
    });

    it('the superseding row copies the anchor, D7, provider, patient and type — nothing drifts across a correction', async () => {
      /*
       * WHAT SHOULD AND SHOULD NOT MOVE ACROSS A SUPERSESSION (HARD-01,
       * hard rule 6, D7). This is deliberately NOT an exhaustive "differs only
       * in id/lock-state/supersedesAgreementId" comparison — `resend` re-locks
       * the replacement in the same call (a fresh `particulars` snapshot,
       * hash, renderer version, rule-set and mapping version, and a NEW
       * staff-verified verification event, because reception has the person in
       * front of them again, REQ-VER-03), so those fields are SUPPOSED to
       * differ from the old row and asserting otherwise would just be wrong
       * about the design. What must never differ is the identity of the
       * contract: which provider, which patient, who is signing, and what kind
       * of agreement this is.
       */
      const { patientId, assignorId } = await freshPatient('Oakley');
      const agreementId = await draft({ patientId, assignorId });
      const first = await pushTo(tabletA, agreementId).expect(201);

      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );

      await answer(first.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);
      await http()
        .patch(`/patients/${patientId}/details`)
        .set('x-practice-id', practiceA)
        .send({ address: '3 Steady Street, Sampletown NSW 2000' })
        .expect(200);

      const resent = await http()
        .post(`/tablet-sessions/${first.body.id}/resend`)
        .set('x-practice-id', practiceA)
        .expect(201);

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: resent.body.agreementId } }),
      );

      // THE CONTRACT'S IDENTITY, UNCHANGED (HARD-01 — the SAME provider seeing
      // the SAME patient; a different one would need fresh consent).
      expect(after!.type).toBe(before!.type);
      expect(after!.anchorKind).toBe(before!.anchorKind);
      expect(after!.providerId).toBe(before!.providerId);
      expect(after!.affiliationId).toBe(before!.affiliationId);
      expect(after!.organisationId).toBe(before!.organisationId);
      expect(after!.patientId).toBe(before!.patientId);
      expect(after!.practiceId).toBe(before!.practiceId);
      // D7, unchanged — a correction to an address is not a correction to who
      // is signing.
      expect(after!.assignorId).toBe(before!.assignorId);
      expect(after!.assignorIsPatient).toBe(before!.assignorIsPatient);
      expect(after!.patientAssignorId).toBe(before!.patientAssignorId);
      expect(after!.enduringPathway).toBe(before!.enduringPathway);
      // D6a, unchanged — nobody touched the service description.
      expect(after!.serviceDescription).toBe(before!.serviceDescription);

      // AND THE LINK AND THE OLD ROW'S OWN TRUTH, exactly the shape HARD-02
      // describes.
      expect(after!.supersedesAgreementId).toBe(agreementId);
      expect(after!.id).not.toBe(before!.id);
      const untouched = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(untouched!.particulars).toEqual(before!.particulars);
      expect(untouched!.renderedArtefactHash).toBe(before!.renderedArtefactHash);
    });

    /**
     * HOW THE DISPUTE ENDED -- the other half of the cross (Carl, 4 Sep 2026).
     *
     * `tablet.details_disputed` records that at a given moment the person the
     * particulars are about looked at them and said one was not theirs. On its
     * own that is half a story, and the missing half is the one somebody will
     * actually ask about: was OUR record wrong, or was the patient?
     *
     * AND WITHOUT IT, "THE PATIENT WAS MISTAKEN" HAD TO BE FAKED AS A
     * CORRECTION. The only exit from a dispute was `PATCH /patients/:id/details`
     * -- which writes `patient.details_corrected` -- so a receptionist whose
     * record was right had to either re-save the same value (an event claiming
     * a change nobody made) or leave the cross hanging.
     */
    const resolve = (
      sessionId: string,
      body: { outcome: string; details: string[] },
      practiceId = practiceA,
    ) =>
      http()
        .post(`/tablet-sessions/${sessionId}/dispute-resolution`)
        .set('x-practice-id', practiceId)
        .send(body);

    it('dispute_resolution_is_recorded_with_types_and_staff', async () => {
      const { patientId, assignorId } = await freshPatient('Noor');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'email'],
        disputed: ['address', 'mobile'],
      }).expect(201);

      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );

      const res = await resolve(pushed.body.id, {
        outcome: 'patient_error',
        details: ['address', 'mobile'],
      }).expect(201);
      expect(res.body.outcome).toBe('patient_error');
      expect([...res.body.details].sort()).toEqual(['address', 'mobile']);

      const event = await prisma.vaultOutbox.findFirst({
        where: { subjectId: pushed.body.id, type: 'tablet.dispute_resolved' },
      });
      expect(event).not.toBeNull();
      const payload = event!.payload as Record<string, unknown>;
      expect(payload.outcome).toBe('patient_error');
      expect(payload.resolvedTypes).toBe('address,mobile');
      expect(payload.disputedTypes).toBe('address,mobile');
      expect(payload.resolvedCount).toBe(2);
      // AGAINST A NAME. "Nothing was wrong after all" is a claim somebody may
      // be asked about later, and an unattributed one cannot be questioned.
      expect(typeof payload.resolvedBy).toBe('string');
      expect((payload.resolvedBy as string).length).toBeGreaterThan(0);
      expect((event!.actor as Record<string, unknown>).id).toBe(RECEPTIONIST.sub);
      expect((event!.actor as Record<string, unknown>).principalType).toBe('staff');
      // AND THE CONTRACT DID NOT MOVE (hard rule 8, REQ-REC-04).
      expect(payload.agreementChanged).toBe(false);

      /*
       * NOTHING WAS TOUCHED. Not the agreement, and not the session: the
       * cross is a fact and facts are not edited. What follows is a re-send,
       * which builds a FRESH session -- and after `patient_error` nothing was
       * corrected, so the SAME agreement goes out again, unsuperseded.
       */
      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(after).toEqual(before);

      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.state).toBe('details_disputed');
      expect(session!.endedAt).toBeNull();
      expect(session!.detailsDisputedTypes.sort()).toEqual(['address', 'mobile']);

      // A SESSION WITH NOTHING TO RESOLVE IS REFUSED. An answer to a question
      // nobody asked would read like evidence of a conversation that never
      // happened.
      const clean = await draft();
      const other = await pushTo(secondTabletA, clean).expect(201);
      await resolve(other.body.id, { outcome: 'corrected', details: ['address'] }).expect(400);
      await http()
        .post(`/tablet-sessions/${other.body.id}/recall`)
        .set('x-practice-id', practiceA)
        .expect(201);
    });

    it('dispute_resolution_never_carries_values', async () => {
      const { patientId, assignorId } = await freshPatient('Ora');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);

      await resolve(pushed.body.id, { outcome: 'corrected', details: ['address'] }).expect(201);

      const event = await prisma.vaultOutbox.findFirst({
        where: { subjectId: pushed.body.id, type: 'tablet.dispute_resolved' },
      });
      expect(event).not.toBeNull();

      /*
       * NOT ONE VALUE, ANYWHERE NEAR IT -- not the detail as it stood, and not
       * the detail as it now reads. The DTO has no field for either and the
       * service reads no patient row (REQ-VER-04, hard rule 9). Nor a
       * Medicare-shaped anything, which does not exist in this system at all
       * (hard rule 1), nor a dollar amount (hard rule 4).
       */
      const serialised = JSON.stringify(event);
      for (const value of [
        '404 Wrongway Parade',
        '+61400000404',
        'wrong.address@example.invalid',
        '1969-11-02',
        'Ora',
        'Crossfield',
      ]) {
        expect(serialised).not.toContain(value);
      }
      expect(serialised).not.toMatch(/medicare/i);
      expect(serialised).not.toMatch(/\$\s?\d/);

      // A NAMELESS CALLER IS REFUSED, like every other act on this page -- 403
      // from the scope guard, before anything reads the body.
      const saved = currentPrincipal;
      currentPrincipal = null;
      await resolve(pushed.body.id, { outcome: 'patient_error', details: ['address'] }).expect(403);
      currentPrincipal = saved;

      // AND THE LIST IS FIXED: a type outside the five has no field to arrive
      // in, and a resolution naming nothing is not a record of anything.
      await resolve(pushed.body.id, { outcome: 'corrected', details: ['medicare_number'] }).expect(400);
      await resolve(pushed.body.id, { outcome: 'corrected', details: [] }).expect(400);
      await resolve(pushed.body.id, { outcome: 'something_else', details: ['address'] }).expect(400);
    });

    it('dispute_resolution_persists_with_its_event', async () => {
      const { patientId, assignorId } = await freshPatient('Reese');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);
      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);

      const res = await resolve(pushed.body.id, {
        outcome: 'corrected',
        details: ['address'],
      }).expect(201);
      expect(res.body.resolvedAt).toBeTruthy();

      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.disputeResolution).toBe('corrected');
      expect(session!.disputeResolvedAt).not.toBeNull();
      // THE STAFF PRINCIPAL ID, NEVER A NAME. A name in a column goes stale the
      // moment somebody is renamed and joins to nothing; the display name is on
      // the event, where an audit line reads it.
      expect(session!.disputeResolvedByPrincipalId).toBe(RECEPTIONIST.sub);
      // A FACT ABOUT THE DISPUTE, NOT A NEW STATE.
      expect(session!.state).toBe('details_disputed');
      expect(session!.endedAt).toBeNull();
      expect(session!.detailsDisputedTypes).toEqual(['address']);

      // AND RECEPTION'S OWN LIST CARRIES IT, which is what lets the row read
      // "Resolved -- ready to re-send" instead of repeating the cross.
      const list = await http()
        .get('/tablet-sessions?active=true')
        .set('x-practice-id', practiceA)
        .expect(200);
      const row = (list.body as Array<Record<string, unknown>>).find((r) => r.id === pushed.body.id);
      expect(row!.disputeResolution).toBe('corrected');
      expect(row!.disputeResolvedAt).toBeTruthy();
      // The list is a status, not a mirror: no value, and no principal id
      // either -- nobody on that screen needs it.
      expect(JSON.stringify(row)).not.toContain('404 Wrongway Parade');
      expect(JSON.stringify(row)).not.toContain(RECEPTIONIST.sub);
    });

    /**
     * ONE WITHOUT THE OTHER IS STRUCTURALLY IMPOSSIBLE (hard rule 11, FR-11.2).
     *
     * The row and its outbox event commit together. Asserted by making the
     * EVENT write fail and finding the columns untouched, rather than by
     * trusting that two awaits happen to sit inside one transaction -- which is
     * the thing that silently stops being true when somebody refactors.
     */
    it('a failed event write leaves the resolution columns null', async () => {
      const { patientId, assignorId } = await freshPatient('Sasha');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(secondTabletA, agreementId).expect(201);
      await http()
        .post('/kiosk/session/' + pushed.body.id + '/confirm-details')
        .set('x-device-credential', secondTabletACredential)
        .send({ confirmed: ['name', 'date_of_birth', 'mobile', 'email'], disputed: ['address'] })
        .expect(201);

      /*
       * THE EVENT WRITE IS MADE TO FAIL, through the module mock declared at
       * the top of this file (which explains why not a database trigger). It
       * fails exactly the write under test and leaves every other event in the
       * suite alone.
       */
      mockFailVaultEventType = 'tablet.dispute_resolved';
      try {
        await resolve(pushed.body.id, { outcome: 'patient_error', details: ['address'] }).expect(500);
      } finally {
        mockFailVaultEventType = null;
      }

      const rolledBack = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      // THE ROW DID NOT MOVE WITHOUT ITS EVIDENCE.
      expect(rolledBack!.disputeResolution).toBeNull();
      expect(rolledBack!.disputeResolvedAt).toBeNull();
      expect(rolledBack!.disputeResolvedByPrincipalId).toBeNull();
      expect(rolledBack!.state).toBe('details_disputed');

      await http()
        .post('/tablet-sessions/' + pushed.body.id + '/recall')
        .set('x-practice-id', practiceA)
        .expect(201);
    });

    it('second_resolution_replaces_the_first', async () => {
      const { patientId, assignorId } = await freshPatient('Tam');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);
      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);

      // Reception corrects it ...
      await resolve(pushed.body.id, { outcome: 'corrected', details: ['address'] }).expect(201);
      const first = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(first!.disputeResolution).toBe('corrected');

      // ... and then realises the address we held was right all along.
      await resolve(pushed.body.id, { outcome: 'patient_error', details: ['address'] }).expect(201);
      const second = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );

      /*
       * THE ROW IS STATE; THE EVENTS ARE HISTORY. The column holds the LATEST
       * answer -- reception's screen must show what is true now -- and the
       * outbox holds BOTH, because "they said corrected, then said patient
       * error" is exactly the sort of thing somebody is asked about later, and
       * exactly what an append-only record is for (hard rule 11).
       */
      expect(second!.disputeResolution).toBe('patient_error');
      expect(second!.disputeResolvedAt!.getTime()).toBeGreaterThanOrEqual(
        first!.disputeResolvedAt!.getTime(),
      );

      const events = await prisma.vaultOutbox.findMany({
        where: { subjectId: pushed.body.id, type: 'tablet.dispute_resolved' },
        orderBy: { occurredAt: 'asc' },
      });
      expect(events).toHaveLength(2);
      expect((events[0].payload as Record<string, unknown>).outcome).toBe('corrected');
      expect((events[1].payload as Record<string, unknown>).outcome).toBe('patient_error');

      // Still a live, disputed session holding its device.
      expect(second!.state).toBe('details_disputed');
      expect(second!.endedAt).toBeNull();
    });

    it('a dispute resolution across a practice boundary finds nothing', async () => {
      const { patientId, assignorId } = await freshPatient('Pax');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);
      await answer(pushed.body.id, {
        confirmed: ['name', 'date_of_birth', 'mobile', 'email'],
        disputed: ['address'],
      }).expect(201);

      signedInAt(practiceB);
      await resolve(pushed.body.id, { outcome: 'patient_error', details: ['address'] }, practiceB).expect(
        404,
      );

      // Nothing recorded, and the dispute still practice A's to answer.
      const events = await prisma.vaultOutbox.findMany({
        where: { subjectId: pushed.body.id, type: 'tablet.dispute_resolved' },
      });
      expect(events).toHaveLength(0);
      signedInAt(practiceA);
    });

    it('the re-send refuses an unattributed caller, like every other act on this page', async () => {
      const { patientId, assignorId } = await freshPatient('Lior');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      currentPrincipal = null;
      /*
       * 403 RATHER THAN 400, and from the SCOPE guard rather than the service:
       * a caller with no verified session has no practice claim, so the act is
       * refused before anything reads the body. Exactly as the push is
       * (asserted above) — the two buttons must refuse the same way, because
       * they are the same act.
       */
      await http()
        .post(`/tablet-sessions/${pushed.body.id}/resend`)
        .set('x-practice-id', practiceA)
        .expect(403);

      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.endedAt).toBeNull();
    });

    it('a re-send across a practice boundary finds nothing', async () => {
      const { patientId, assignorId } = await freshPatient('Marlow');
      const agreementId = await draft({ patientId, assignorId });
      const pushed = await pushTo(tabletA, agreementId).expect(201);

      signedInAt(practiceB);
      await http()
        .post(`/tablet-sessions/${pushed.body.id}/resend`)
        .set('x-practice-id', practiceB)
        .expect(404);

      const session = await prisma.withPractice(practiceA, (tx) =>
        tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
      );
      expect(session!.endedAt).toBeNull();
    });
  });
});
