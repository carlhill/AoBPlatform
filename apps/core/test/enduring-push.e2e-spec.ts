import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { RuleResult, ValidationResponse } from '@aobplatform/contracts';
import { SERVICE_DESCRIPTIONS } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DevicesService } from '../src/devices/devices.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';

/**
 * ENDURING AT THE KIOSK — everything up to the human-authored boundary, and
 * the boundary itself (Carl, 4 Sep 2026; GA-PLAN B5).
 *
 * WHAT THIS SUITE PINS:
 *
 *  - HARD RULE 6, TWICE. An ongoing agreement is per practitioner × patient
 *    and never practice-wide (REQ-END-01), and it is GP-only (REQ-END-01a).
 *    Both are permanent rules rather than pending work, and both refuse with
 *    their own code so the console can say what to offer instead rather than
 *    telling somebody to wait for something that will never arrive.
 *  - SILENCE IS NOT A PASS. Today's rule set has no enduring branch: it
 *    returns C-rule verdicts and nothing about reg 65CB, so `valid: true`
 *    would mean "none of the EPISODIC rules failed" — which is not an answer
 *    to the question being asked. The push refuses with
 *    `enduring_rules_not_authored` until the rule set answers, and stops
 *    refusing the moment it does, with no further code change. That last half
 *    is the point: the branch is the only thing left.
 *  - AND NO INVENTED PARTICULARS. The payload the rule set is sent carries reg
 *    65CB's content set and NO service date and NO basic description, because
 *    both are episodic elements (REQ-REG-01, D5/D6a). A service date made up
 *    to satisfy C5 would be a particular nobody stated, rendered at a patient
 *    and hashed into the artefact.
 *
 * THE RULES CLIENT IS A STUB WITH A SWITCH, so both sides of the boundary can
 * be driven in one app: `enduringBranchAuthored = false` behaves like the
 * registered draft set (C-rules only), and `true` adds the E-family verdict a
 * real branch would return. Nothing in this file writes a rule.
 */

/** Flipped by the last test — see the module note. */
let enduringBranchAuthored = false;

const cRuleVerdicts = (): RuleResult[] => [
  { rule: 'C1', outcome: 'pass', message: 'D1 present.', citation: 's 65C(4)' },
  { rule: 'C6', outcome: 'pass', message: 'D6a applies to pre-agreements only.', citation: 'REQ-REG-03' },
];

/** What an AUTHORED branch would add. One verdict is all core looks for. */
const enduringVerdicts = (): RuleResult[] => [
  { rule: 'E1', outcome: 'pass', message: 'The enduring declaration is present.', citation: 'reg 65CB' },
  { rule: 'E4', outcome: 'pass', message: 'The provider is a general practitioner.', citation: 'REQ-END-01a' },
];

/** Everything the rules service was asked, so the payload itself can be read. */
const asked: Array<Record<string, unknown>> = [];

const switchableRules = {
  validate: async ({ payload }: { payload: unknown }): Promise<ValidationResponse> => {
    const p = (payload ?? {}) as Record<string, unknown>;
    asked.push(p);
    const enduring = p.agreementType === 'enduring';
    const results = [
      ...cRuleVerdicts(),
      ...(enduring && enduringBranchAuthored ? enduringVerdicts() : []),
    ];
    return {
      valid: !results.some((r) => r.outcome === 'fail'),
      results,
      ruleSetVersion: 'test-rules-1',
      mappingVersion: 'test-mapping-1',
    };
  },
};

const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-00000007ab02',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

describe('enduring at the kiosk (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practice = randomUUID();
  let gp: string;
  let specialist: string;
  let patient: string;
  let assignor: string;
  let tablet: string;

  const http = () => request(app.getHttpServer());

  async function enduringDraft(
    opts: { providerId?: string; anchorKind?: string; organisationId?: string | null } = {},
  ): Promise<string> {
    return prisma.withPractice(practice, async (tx) => {
      const agreement = await tx.agreement.create({
        data: {
          practiceId: practice,
          type: 'enduring',
          anchorKind: opts.anchorKind ?? 'provider',
          providerId: opts.anchorKind === 'organisation' ? null : (opts.providerId ?? gp),
          patientId: patient,
          assignorId: assignor,
          assignorIsPatient: true,
          enduringPathway: opts.anchorKind === 'organisation' ? 'accho_ams' : 'mymedicare',
          status: 'draft',
        },
      });
      return agreement.id;
    });
  }

  const push = (agreementId: string) =>
    http().post(`/devices/${tablet}/push`).set('x-practice-id', practice).send({ agreementId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(switchableRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practice, async (tx) => {
      /*
       * THE PRACTICE'S OWN DEFAULT D6a. It matters to the decline path: an
       * ENDURING agreement has no basic service description (D6a is a
       * pre-agreement element, REQ-REG-01), so when reception offers an
       * agreement for the visit instead, the practice default is the honest
       * source. Without one the new draft arrives without D6a and the push
       * refuses with `service_description_missing`, which the console already
       * fixes inline on the row -- never a guessed description.
       */
      await tx.practice.create({
        data: {
          id: practice,
          name: 'Enduring Test Practice',
          defaultServiceDescription: SERVICE_DESCRIPTIONS[0],
        },
      });
      gp = (
        await tx.provider.create({
          data: {
            practiceId: practice,
            name: 'Dr Example Provider',
            providerType: 'general_practitioner',
            placeOfPracticeAddress: '1 Example Street, Sampletown NSW 2000',
          },
        })
      ).id;
      specialist = (
        await tx.provider.create({
          data: { practiceId: practice, name: 'Dr Other Specialist', providerType: 'specialist' },
        })
      ).id;
      patient = (
        await tx.patient.create({
          data: {
            practiceId: practice,
            familyName: 'Sampleton',
            givenNames: 'Jamie',
            dateOfBirth: new Date('1957-03-14'),
            address: '12 Example Street, Sydney NSW 2000',
          },
        })
      ).id;
      assignor = (
        await tx.assignor.create({
          data: { practiceId: practice, name: 'Jamie Sampleton', authorityBasis: 'self' },
        })
      ).id;
    });

    const devices = app.get(DevicesService);
    const registered = await devices.registerForDev(practice, 'Reception tablet 1');
    await devices.pair(registered.code, 'enduring-e2e');
    tablet = registered.deviceId;
  });

  beforeEach(() => {
    currentPrincipal = { ...RECEPTIONIST, practiceId: practice };
    asked.length = 0;
  });

  afterEach(async () => {
    await prisma.withPractice(practice, (tx) =>
      tx.tabletSession.updateMany({
        where: { endedAt: null },
        data: { state: 'recalled', endedAt: new Date() },
      }),
    );
  });

  afterAll(async () => {
    await prisma.withPractice(practice, async (tx) => {
      await tx.tabletSession.deleteMany({});
      await tx.devicePairingCode.deleteMany({ where: { practiceId: practice } });
      await tx.device.deleteMany({});
      await tx.captureRequest.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.practice.deleteMany({ where: { id: practice } });
    });
    await app.close();
  });

  /**
   * HARD RULE 6 (REQ-END-01/-01a). Both halves are PERMANENT rules and neither
   * is pending work, which is why each has its own code: the console can say
   * what to offer instead rather than telling somebody to wait.
   */
  it('enduring_is_per_provider_and_patient_never_per_practice', async () => {
    // An agreement anchored to an ORGANISATION names no single practitioner.
    // It is a real thing on the ACCHO/AMS pathway and is still not a thing a
    // waiting-room tablet may collect a signature on: the screen could not
    // tell the person signing who they are agreeing with.
    const orgAnchored = await enduringDraft({ anchorKind: 'organisation' });
    const refusedOrg = await push(orgAnchored).expect(409);
    expect(refusedOrg.body.reason).toBe('enduring_not_per_provider');
    expect(refusedOrg.body.message).toMatch(/one provider and one patient/i);
    // The rule set was never asked: this is settled before anything leaves
    // the process.
    expect(asked).toHaveLength(0);

    // GP-ONLY, PERMANENTLY (REQ-END-01a). A specialist has no enduring
    // pathway, and the refusal says what to offer instead.
    const bySpecialist = await enduringDraft({ providerId: specialist });
    const refusedSpecialist = await push(bySpecialist).expect(409);
    expect(refusedSpecialist.body.reason).toBe('enduring_not_gp');
    expect(refusedSpecialist.body.message).toMatch(/general practitioner/i);
    expect(asked).toHaveLength(0);

    // AND NOTHING MOVED ON EITHER AGREEMENT. A refusal stops a screen, never a
    // patient (hard rule 8, REQ-REC-04).
    const after = await prisma.withPractice(practice, (tx) =>
      tx.agreement.findMany({ where: { id: { in: [orgAnchored, bySpecialist] } } }),
    );
    for (const agreement of after) {
      expect(agreement.status).toBe('draft');
      expect(agreement.particularsLockedAt).toBeNull();
      expect(agreement.verificationEventId).toBeNull();
    }
  });

  /**
   * THE BOUNDARY ITSELF. Everything else exists; this is the last thing in the
   * way, and it says so rather than pretending.
   */
  it('enduring_push_refuses_until_the_rule_set_exists', async () => {
    enduringBranchAuthored = false;
    const agreementId = await enduringDraft();

    const refused = await push(agreementId).expect(409);
    expect(refused.body.reason).toBe('enduring_rules_not_authored');
    expect(refused.body.message).toMatch(/reg 65CB/);

    /*
     * THE RULE SET WAS ASKED, AND WITH THE RIGHT PAYLOAD. This is the half
     * that cannot be got wrong quietly: a standing agreement has no single
     * service date and no one basic description (REQ-REG-01 makes both
     * episodic elements), so neither is sent — a value invented to satisfy C5
     * would be a particular nobody stated, rendered at a patient and hashed
     * into the artefact.
     */
    expect(asked).toHaveLength(1);
    const payload = asked[0];
    expect(payload.agreementType).toBe('enduring');
    expect(payload.serviceDate).toBeUndefined();
    expect(payload.basicServiceDescription).toBeUndefined();
    expect(payload.enduringPathway).toBe('mymedicare');
    expect(payload.providerName).toBe('Dr Example Provider');
    // Hard rule 4: no benefit or dollar amount anywhere in the particulars.
    expect(JSON.stringify(payload)).not.toMatch(/benefit|amount|fee|rebate/i);

    // NOTHING WAS LOCKED and no session was created — the refusal is complete.
    const untouched = await prisma.withPractice(practice, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(untouched?.status).toBe('draft');
    expect(untouched?.particularsLockedAt).toBeNull();
    const sessions = await prisma.withPractice(practice, (tx) =>
      tx.tabletSession.findMany({ where: { agreementId } }),
    );
    expect(sessions).toHaveLength(0);

    /*
     * AND THE MOMENT THE BRANCH ANSWERS, IT GOES. No further code change, no
     * flag, no deploy step beyond registering the rule set — which is the
     * whole design of the boundary: the platform asks the human-authored rule
     * set and believes the answer.
     */
    enduringBranchAuthored = true;
    const sent = await push(agreementId).expect(201);
    expect(sent.body.agreementType).toBe('enduring');
    expect(sent.body.state).toBe('pushed');

    const locked = await prisma.withPractice(practice, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(locked?.status).toBe('awaiting_signature');
    expect(locked?.particularsLockedAt).not.toBeNull();
    // The push IS the verification record (REQ-VER-03/-04).
    expect(locked?.verificationEventId).not.toBeNull();
    // Rule 14: the versions that validated it travel with it.
    expect(locked?.ruleSetVersion).toBe('test-rules-1');
    expect(locked?.mappingVersion).toBe('test-mapping-1');
    // And the stored snapshot carries no service date either (REQ-REG-01).
    expect((locked?.particulars as Record<string, unknown>).serviceDate).toBeUndefined();

    enduringBranchAuthored = false;
  });

  /**
   * THE PATIENT'S OWN ANSWER, AND RECEPTION'S REPLY TO IT (Carl, 4 Sep 2026).
   *
   * A decline is not a walk-away and is not a refusal of bulk billing: the
   * patient read a standing agreement and said they would rather be asked each
   * visit. It gets its own state so that reception's screen can offer the one
   * thing that follows — an agreement for today's visit.
   */
  it('declining_enduring_offers_episodic_for_the_visit', async () => {
    enduringBranchAuthored = true;
    const devices = app.get(DevicesService);
    const registered = await devices.registerForDev(practice, 'Decline tablet');
    const paired = await devices.pair(registered.code, 'decline-e2e');

    const agreementId = await enduringDraft();
    const sent = await http()
      .post(`/devices/${registered.deviceId}/push`)
      .set('x-practice-id', practice)
      .send({ agreementId })
      .expect(201);

    // The tablet says what the patient did. Its own word, not `walked_away`.
    await request(app.getHttpServer())
      .post(`/kiosk/session/${sent.body.id}/state`)
      .set('x-device-credential', paired.credential)
      .send({ state: 'declined_enduring' })
      .expect(201);

    const declined = await prisma.withPractice(practice, (tx) =>
      tx.tabletSession.findFirst({ where: { id: sent.body.id } }),
    );
    expect(declined?.state).toBe('declined_enduring');
    expect(declined?.endedAt).not.toBeNull();

    // NOTHING ON THE AGREEMENT MOVED (hard rule 8, REQ-REC-04).
    const untouched = await prisma.withPractice(practice, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(untouched?.status).toBe('awaiting_signature');
    expect(untouched?.signatureEventId).toBeNull();

    // RECEPTION'S ONE PRESS: a different agreement, for today's visit, on the
    // same tablet, for the same provider and patient.
    const offered = await http()
      .post(`/tablet-sessions/${sent.body.id}/offer-episodic`)
      .set('x-practice-id', practice)
      .send({})
      .expect(201);

    expect(offered.body.agreementType).toBe('episodic_pre');
    expect(offered.body.agreementId).not.toBe(agreementId);
    expect(offered.body.deviceId).toBe(registered.deviceId);

    const replacement = await prisma.withPractice(practice, (tx) =>
      tx.agreement.findFirst({ where: { id: offered.body.agreementId } }),
    );
    // HARD-01: the same provider seeing the same patient. A different provider
    // would be a different agreement needing its own consent.
    expect(replacement?.providerId).toBe(gp);
    expect(replacement?.patientId).toBe(patient);
    expect(replacement?.type).toBe('episodic_pre');
    // D6a CARRIED FROM THE PRACTICE'S OWN DEFAULT, never guessed.
    expect(replacement?.serviceDescription).toBe(SERVICE_DESCRIPTIONS[0]);

    // AND THE DECLINED ONE IS UNTOUCHED. A decline is a fact somebody may be
    // asked about later, not a deletion.
    const stillThere = await prisma.withPractice(practice, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(stillThere?.type).toBe('enduring');

    enduringBranchAuthored = false;
  });
});
