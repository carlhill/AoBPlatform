import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { KIOSK_COMMAND_TTL_MS, KIOSK_SCREENS, SERVICE_DESCRIPTIONS } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DevicesService } from '../src/devices/devices.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';

/**
 * THE TABLET HEARTBEAT, "RETURN TO BEGIN", AND OUT OF USE — the server half
 * (Carl, 4–5 Sep 2026; TODO.md "Tablet heartbeat and Return to Begin",
 * "Tablets: make one inactive").
 *
 * WHAT CARL ASKED FOR. Reception needs one more option — force a tablet back
 * to the Begin page — and "the tablet must know what it is on": is it on
 * Begin, or is a patient part-way through, and on which page. Before this, the
 * tablet knew its own screen and never told the server, so a walk-up
 * mid-verify was invisible from the console and a tablet on Begin looked
 * exactly like one that was switched off. Recall only reaches a PUSHED
 * session, and the session poll is deliberately off during a walk-up, so
 * recall could not clear a walk-up at all.
 *
 * WHAT THIS SUITE PINS, and each is a rule rather than a behaviour:
 *
 *  - `heartbeat_carries_screen_names_not_values` — the endpoint takes a word
 *    from a fixed list of ten and refuses anything else, and the global
 *    whitelist strips every field the DTO does not declare. That is what makes
 *    "no patient detail rides on the poll" structural rather than a promise
 *    about today's client (REQ-VER-04, hard rule 9).
 *  - `reset_command_is_served_once_and_acknowledged` — served until the tablet
 *    says it has done it, then cleared. Served until, not once, so a single
 *    dropped request does not lose a reset.
 *  - `reset_command_expires_after_two_minutes` — dropped silently, so a tablet
 *    that was asleep when the button was pressed does not clear tomorrow's
 *    patient off the screen tomorrow morning.
 *  - `push_refuses_an_out_of_use_device` — reception's own switch, refusing
 *    with its own code so the console can offer the one press that reverses it.
 *  - TENANCY FAILS CLOSED. Another practice's tablet is a 404 on both new
 *    acts, because RLS filters on the transaction-local scope and a caller
 *    cannot tell a cross-practice id from a made-up one.
 *
 * NO VAULT EVENT PER HEARTBEAT, and that is asserted. A heartbeat is
 * telemetry, thirty rows a minute per tablet; the acts that ARE evidence write
 * their own through the outbox in the same transaction as the row (hard rule
 * 11).
 */

/** The receptionist doing the work. `null` = nobody signed in. */
const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-00000009cd01',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

function signedInAt(practiceId: string): void {
  currentPrincipal = { ...RECEPTIONIST, practiceId };
}

const D6A = SERVICE_DESCRIPTIONS[0];

/** Waves the payload through; this suite is not about the rule set. */
const permissiveRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

describe('the tablet heartbeat and Return to Begin (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();

  let providerA: string;
  let patientA: string;
  let assignorA: string;
  let tabletA: string;
  let tabletACredential: string;
  let tabletB: string;

  const http = () => request(app.getHttpServer());

  async function pairTablet(practiceId: string, label: string) {
    const devices = app.get(DevicesService);
    const { deviceId, code } = await devices.registerForDev(practiceId, label);
    const { credential } = await devices.pair(code, `heartbeat-${label}`);
    return { deviceId, credential };
  }

  /** What the tablet sends, with the fields a test cares about overridden. */
  const beat = (body: Record<string, unknown> = {}) =>
    http()
      .post('/kiosk/heartbeat')
      .set('x-device-credential', tabletACredential)
      .send({ screen: 'begin', sessionId: null, build: 'test-build', ackCommandId: null, ...body });

  async function draft(): Promise<string> {
    return prisma.withPractice(practiceA, async (tx) => {
      const agreement = await tx.agreement.create({
        data: {
          practiceId: practiceA,
          type: 'episodic_pre',
          anchorKind: 'provider',
          providerId: providerA,
          patientId: patientA,
          assignorId: assignorA,
          assignorIsPatient: true,
          status: 'draft',
          serviceDescription: D6A,
        },
      });
      return agreement.id;
    });
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
      await tx.practice.create({ data: { id: practiceA, name: 'Heartbeat Test Practice A' } });
      providerA = (
        await tx.provider.create({
          data: {
            practiceId: practiceA,
            name: 'Dr Example Provider',
            providerType: 'general_practitioner',
          },
        })
      ).id;
      patientA = (
        await tx.patient.create({
          data: {
            practiceId: practiceA,
            familyName: 'Sampleton',
            givenNames: 'Jamie',
            dateOfBirth: new Date('1957-03-14'),
            address: '12 Example Street, Sydney NSW 2000',
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
      await tx.practice.create({ data: { id: practiceB, name: 'Heartbeat Test Practice B' } });
    });

    const first = await pairTablet(practiceA, 'Reception tablet 1');
    tabletA = first.deviceId;
    tabletACredential = first.credential;
    tabletB = (await pairTablet(practiceB, 'Other practice tablet')).deviceId;
  });

  beforeEach(async () => {
    signedInAt(practiceA);
    // Every test starts with a clean device: no pending command, in use.
    await prisma.withPractice(practiceA, (tx) =>
      tx.device.update({
        where: { id: tabletA },
        data: {
          pendingCommandId: null,
          pendingCommandKind: null,
          pendingCommandIssuedAt: null,
          pendingCommandIssuedBy: null,
          outOfUseAt: null,
          outOfUseBy: null,
        },
      }),
    );
    await prisma.withPractice(practiceA, (tx) =>
      tx.tabletSession.updateMany({
        where: { endedAt: null },
        data: { endedAt: new Date(), state: 'expired' },
      }),
    );
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.tabletSession.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.devicePairingCode.deleteMany({});
        await tx.device.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    currentPrincipal = null;
    await app.close();
  });

  it('heartbeat_carries_screen_names_not_values', async () => {
    currentPrincipal = null;

    /*
     * EVERY ONE OF THE TEN WORDS IS ACCEPTED, and the list is the contract.
     * The console renders each through its own string table, so this is also
     * the test that fails if somebody adds a screen to the tablet and forgets
     * to add it here.
     */
    for (const screen of KIOSK_SCREENS) {
      await beat({ screen }).expect(201);
    }
    const after = await prisma.withPractice(practiceA, (tx) =>
      tx.device.findFirst({ where: { id: tabletA } }),
    );
    expect(after?.currentScreen).toBe(KIOSK_SCREENS[KIOSK_SCREENS.length - 1]);

    /*
     * ANYTHING ELSE IS A 400. A free-text `screen` would be a field somebody
     * could one day fill with a heading — and the headings on this product's
     * screens are frequently a person's name.
     */
    await beat({ screen: 'Jamie Sampleton — check your details' }).expect(400);
    await beat({ screen: 'date_of_birth' }).expect(400);

    /*
     * AND A FIFTH FIELD IS STRIPPED BEFORE ANYTHING READS IT. `whitelist: true`
     * on the global pipe is what makes this structural: a client that sent a
     * patient's name alongside the screen would find it gone, not stored.
     */
    await http()
      .post('/kiosk/heartbeat')
      .set('x-device-credential', tabletACredential)
      .send({ screen: 'verify', sessionId: null, patientName: 'Jamie Sampleton', dateOfBirth: '1957-03-14' })
      .expect(201);
    const stripped = await prisma.withPractice(practiceA, (tx) =>
      tx.device.findFirst({ where: { id: tabletA } }),
    );
    expect(JSON.stringify(stripped)).not.toMatch(/Sampleton|1957/);

    /*
     * NO VAULT EVENT PER HEARTBEAT. Telemetry, not evidence — thirty rows a
     * minute per tablet in an append-only store would bury the events that
     * matter for no evidentiary gain.
     */
    const events = await prisma.vaultOutbox.findMany({ where: { subjectId: tabletA } });
    expect(events.filter((e) => e.type.includes('heartbeat'))).toHaveLength(0);
  });

  it('records where the tablet is, so the console can say it', async () => {
    currentPrincipal = null;
    const sessionId = randomUUID();
    await beat({ screen: 'check-details', sessionId }).expect(201);

    const row = await prisma.withPractice(practiceA, (tx) =>
      tx.device.findFirst({ where: { id: tabletA } }),
    );
    expect(row?.currentScreen).toBe('check-details');
    expect(row?.currentSessionId).toBe(sessionId);
    expect(row?.lastSeenAt).not.toBeNull();

    // A WALK-UP HAS NO SESSION, which is exactly the state that was invisible
    // before: a ceremony screen with a null session id.
    await beat({ screen: 'verify', sessionId: null }).expect(201);
    const walkUp = await prisma.withPractice(practiceA, (tx) =>
      tx.device.findFirst({ where: { id: tabletA } }),
    );
    expect(walkUp?.currentScreen).toBe('verify');
    expect(walkUp?.currentSessionId).toBeNull();

    // AND `GET /devices` CARRIES IT, with the staleness the SERVER computed —
    // the console never guesses the cadence.
    signedInAt(practiceA);
    const listed = await http().get('/devices').set('x-practice-id', practiceA).expect(200);
    const device = (listed.body.devices as Array<Record<string, unknown>>).find((d) => d.id === tabletA);
    expect(device?.currentScreen).toBe('verify');
    expect(device?.currentSessionId).toBeNull();
    expect(device?.stale).toBe(false);
    expect(device?.outOfUse).toBe(false);
    // No patient is looked up to decorate a device row (Carl, 5 Sep 2026).
    expect(JSON.stringify(device)).not.toMatch(/Sampleton|1957/);
  });

  it('reset_command_is_served_once_and_acknowledged', async () => {
    signedInAt(practiceA);
    const requested = await http()
      .post(`/devices/${tabletA}/return-to-begin`)
      .set('x-practice-id', practiceA)
      .send({})
      .expect(201);
    const commandId = requested.body.commandId as string;
    expect(requested.body.recalledSessionId).toBeNull();

    currentPrincipal = null;

    // SERVED, AND SERVED AGAIN. Until the acknowledgement arrives the command
    // comes back on every beat, so one dropped request does not lose a reset.
    const first = await beat().expect(201);
    expect(first.body.command).toMatchObject({ id: commandId, kind: 'return_to_begin' });
    const second = await beat().expect(201);
    expect(second.body.command.id).toBe(commandId);

    // ACKNOWLEDGED — and gone, once and for all.
    const acked = await beat({ ackCommandId: commandId }).expect(201);
    expect(acked.body.command).toBeNull();
    const after = await beat().expect(201);
    expect(after.body.command).toBeNull();

    const row = await prisma.withPractice(practiceA, (tx) =>
      tx.device.findFirst({ where: { id: tabletA } }),
    );
    expect(row?.pendingCommandId).toBeNull();

    /*
     * THE ACT IS EVIDENCED, the heartbeat is not. Who asked, which device,
     * which command — and no patient, because the tablet may have had
     * anybody's ceremony on it (REQ-LOG-08, hard rule 9).
     */
    const events = await prisma.vaultOutbox.findMany({
      where: { subjectId: tabletA, type: 'tablet.return_to_begin_requested' },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.commandId).toBe(commandId);
    expect(payload.recalledSessionId).toBe('');
    expect(JSON.stringify(payload)).not.toMatch(/Sampleton|1957|medicare/i);
  });

  it('reset_command_expires_after_two_minutes', async () => {
    signedInAt(practiceA);
    await http()
      .post(`/devices/${tabletA}/return-to-begin`)
      .set('x-practice-id', practiceA)
      .send({})
      .expect(201);

    /*
     * THE TABLET WAS ASLEEP. Reaching into the row is the honest way to age a
     * command by two minutes and a second — the alternative is a test that
     * takes two minutes to run, which is a test nobody runs.
     */
    await prisma.withPractice(practiceA, (tx) =>
      tx.device.update({
        where: { id: tabletA },
        data: { pendingCommandIssuedAt: new Date(Date.now() - KIOSK_COMMAND_TTL_MS - 1_000) },
      }),
    );

    currentPrincipal = null;
    const answer = await beat().expect(201);
    // DROPPED SILENTLY. A tablet that wakes up tomorrow morning must not clear
    // tomorrow's patient off the screen.
    expect(answer.body.command).toBeNull();
    const row = await prisma.withPractice(practiceA, (tx) =>
      tx.device.findFirst({ where: { id: tabletA } }),
    );
    expect(row?.pendingCommandId).toBeNull();
  });

  it('Return to Begin recalls a live pushed session through the existing path', async () => {
    signedInAt(practiceA);
    const agreementId = await draft();
    const pushed = await http()
      .post(`/devices/${tabletA}/push`)
      .set('x-practice-id', practiceA)
      .send({ agreementId })
      .expect(201);
    const sessionId = pushed.body.id as string;

    const requested = await http()
      .post(`/devices/${tabletA}/return-to-begin`)
      .set('x-practice-id', practiceA)
      .send({})
      .expect(201);
    expect(requested.body.recalledSessionId).toBe(sessionId);

    const session = await prisma.withPractice(practiceA, (tx) =>
      tx.tabletSession.findFirst({ where: { id: sessionId } }),
    );
    // THE EXISTING RECALL, not a second mechanism: the state and the event are
    // the ones the console has always read.
    expect(session?.state).toBe('recalled');
    expect(session?.endedAt).not.toBeNull();

    /*
     * AND NOTHING ON THE AGREEMENT MOVED (hard rule 8, REQ-REC-04). Reception
     * took a screen back; the patient is still seen and still billable by any
     * other route.
     */
    const agreement = await prisma.withPractice(practiceA, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(agreement?.status).toBe('awaiting_signature');
    expect(agreement?.particularsLockedAt).not.toBeNull();
  });

  it('push_refuses_an_out_of_use_device', async () => {
    signedInAt(practiceA);
    const agreementId = await draft();

    const out = await http()
      .post(`/devices/${tabletA}/out-of-use`)
      .set('x-practice-id', practiceA)
      .send({ outOfUse: true })
      .expect(201);
    expect(out.body.outOfUse).toBe(true);

    const refused = await http()
      .post(`/devices/${tabletA}/push`)
      .set('x-practice-id', practiceA)
      .send({ agreementId })
      .expect(409);
    // THE CODE IS THE CONTRACT — the console renders its own words and offers
    // the one press that reverses it.
    expect(refused.body.reason).toBe('device_out_of_use');

    // THE TABLET IS TOLD, AND KEEPS BEATING. That is the whole difference from
    // a revoke: it stays visible on the console and one press brings it back.
    currentPrincipal = null;
    const answer = await beat().expect(201);
    expect(answer.body.outOfUse).toBe(true);

    signedInAt(practiceA);
    const back = await http()
      .post(`/devices/${tabletA}/out-of-use`)
      .set('x-practice-id', practiceA)
      .send({ outOfUse: false })
      .expect(201);
    expect(back.body.outOfUse).toBe(false);

    await http()
      .post(`/devices/${tabletA}/push`)
      .set('x-practice-id', practiceA)
      .send({ agreementId })
      .expect(201);

    const events = await prisma.vaultOutbox.findMany({ where: { subjectId: tabletA } });
    expect(events.filter((e) => e.type === 'device.taken_out_of_use')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'device.put_back_in_use')).toHaveLength(1);
  });

  it('taking a tablet out of use recalls whatever is on it', async () => {
    signedInAt(practiceA);
    const agreementId = await draft();
    const pushed = await http()
      .post(`/devices/${tabletA}/push`)
      .set('x-practice-id', practiceA)
      .send({ agreementId })
      .expect(201);

    const out = await http()
      .post(`/devices/${tabletA}/out-of-use`)
      .set('x-practice-id', practiceA)
      .send({ outOfUse: true })
      .expect(201);
    // A tablet declared off the floor while still holding somebody's
    // particulars would be a screen nobody is watching with a session the
    // console still thinks is live.
    expect(out.body.recalledSessionId).toBe(pushed.body.id);
    const session = await prisma.withPractice(practiceA, (tx) =>
      tx.tabletSession.findFirst({ where: { id: pushed.body.id as string } }),
    );
    expect(session?.state).toBe('recalled');
  });

  it('refuses both new acts to an unattributed caller, and fails closed across practices', async () => {
    /*
     * NOBODY SIGNED IN. Sending a tablet back to Begin can take a screen away
     * from a patient standing at it; recorded as `unattributed` it would be an
     * act nobody can be asked about later, which is worse than a refusal.
     */
    currentPrincipal = null;
    await http()
      .post(`/devices/${tabletA}/return-to-begin`)
      .set('x-practice-id', practiceA)
      .send({})
      .expect(403);
    await http()
      .post(`/devices/${tabletA}/out-of-use`)
      .set('x-practice-id', practiceA)
      .send({ outOfUse: true })
      .expect(403);

    /*
     * ANOTHER PRACTICE'S TABLET IS A 404, not a 403. RLS filters on the
     * transaction-local scope, so a cross-practice id is indistinguishable
     * from a made-up one — which is the correct amount to learn from a
     * refusal.
     */
    signedInAt(practiceA);
    await http()
      .post(`/devices/${tabletB}/return-to-begin`)
      .set('x-practice-id', practiceA)
      .send({})
      .expect(404);
    await http()
      .post(`/devices/${tabletB}/out-of-use`)
      .set('x-practice-id', practiceA)
      .send({ outOfUse: true })
      .expect(404);

    // And practice B's tablet is untouched by any of it.
    const other = await prisma.withPractice(practiceB, (tx) =>
      tx.device.findFirst({ where: { id: tabletB } }),
    );
    expect(other?.outOfUseAt).toBeNull();
    expect(other?.pendingCommandId).toBeNull();
  });

  it('answers the practice cadence and the build floor, so one poll serves every screen', async () => {
    currentPrincipal = null;
    const answer = await beat({ screen: 'particulars' }).expect(201);
    expect(typeof answer.body.pollMs).toBe('number');
    expect(answer.body.pollMs).toBeGreaterThan(0);
    /*
     * `reload` RIDES HERE TOO. This is now the one poll that runs on every
     * screen — the waiting list is off mid-ceremony — so it is the one place a
     * rollback is guaranteed to reach an open tab (CLAUDE.md §7).
     */
    expect(answer.body.reload).toBe(false);
  });

  it('refuses a heartbeat with no device credential — the kiosk has one door', async () => {
    currentPrincipal = null;
    await http().post('/kiosk/heartbeat').send({ screen: 'begin' }).expect(401);
  });
});
