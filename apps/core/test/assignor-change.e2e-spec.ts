import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * SOMEBODY OTHER THAN THE PATIENT IS SIGNING — `POST /agreements/:id/assignor`.
 *
 * The check-in cascade drafts every `episodic_pre` with `assignorIsPatient:
 * true` (CONSULTATION-CAPTURE-PLAN.md §2.1 step 4). This is the write path for
 * the morning it is wrong: a parent has brought a child, a spouse or a friend
 * is signing. Until it existed the tablet handed over to the desk.
 *
 * WHAT THESE PIN. That the practice-staff block and the age gate are enforced
 * by the SERVER and not merely by the tablet (a control that lives only on a
 * client is a suggestion); that a non-patient assignor must be reachable,
 * because everything the patient would have received now goes to them; that
 * "friend" is a legitimate answer; that a locked agreement is never
 * re-pointed; that the change and its evidence commit together or not at all;
 * and that none of it crosses a practice boundary.
 */

/**
 * A rules stub that actually EVALUATES C8 rather than waving everything
 * through. The endpoint re-asks the rule set about the payload it just wrote,
 * so a stub that always passes would make the assertion meaningless — and the
 * transaction rollback on a C8 failure would never be exercised.
 */
/**
 * Flipped by the rollback test alone. The domain guards make a C8 failure
 * genuinely hard to provoke through the API — which is the point of them —
 * so the only honest way to prove the transaction unwinds on a rule-set
 * refusal is to make the rule set refuse.
 */
let ruleSetRefusesEverything = false;

const c8EvaluatingRules = {
  validate: async ({ payload }: { payload: unknown }): Promise<ValidationResponse> => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const ok =
      !ruleSetRefusesEverything &&
      (p.assignorIsPatient === true ||
        (p.assignorIsPatient === false &&
          typeof p.assignorName === 'string' &&
          p.assignorName.trim().length > 0 &&
          typeof p.assignorRelationship === 'string' &&
          p.assignorRelationship.trim().length > 0));
    return {
      valid: ok,
      results: [
        {
          rule: 'C8',
          outcome: ok ? 'pass' : 'fail',
          message:
            'D7: whether the assignor is the patient must be stated explicitly; a third-party ' +
            'assignor requires name and relationship.',
          citation: 's 65C(6)(b); REQ-REG-01 D7',
        },
      ],
      ruleSetVersion: 'test-rules-1',
      mappingVersion: 'test-mapping-1',
    };
  },
};

describe('re-pointing a draft agreement at another assignor (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();
  let providerId: string;
  let patientId: string;
  let patientAssignorId: string;

  /** A fresh draft per test — these mutate the agreement, so they cannot share one. */
  async function draft(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({
        type: 'episodic_pre',
        providerId,
        patientId,
        assignorId: patientAssignorId,
        assignorIsPatient: true,
      })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(c8EvaluatingRules)
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Assignor Change Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr Example Provider', providerType: 'general_practitioner' },
        })
      ).id;
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Testpatient',
            givenNames: 'Robin',
            dateOfBirth: new Date('2016-04-02'),
          },
        })
      ).id;
      patientAssignorId = (
        await tx.assignor.create({ data: { practiceId, name: 'Robin Testpatient', authorityBasis: 'self' } })
      ).id;
      // The practice's own people. The block is against THIS list.
      await tx.staffMember.create({
        data: { practiceId, name: 'Mai Nguyen', role: 'front_desk', active: true },
      });
      // Access withdrawn last week — still practice staff this morning.
      await tx.staffMember.create({
        data: {
          practiceId,
          name: 'Jo Formerstaff',
          role: 'front_desk',
          active: false,
          deactivatedAt: new Date('2026-08-20'),
        },
      });
    });

    // The tenancy test creates the practice it is about, rather than assuming
    // one is lying around.
    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Somewhere Else Medical' } });
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.captureRequest.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.staffMember.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  it('points a draft at a parent, and D7 flips explicitly', async () => {
    const agreementId = await draft();
    const res = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400 000 111',
      })
      .expect(201);

    expect(res.body.assignorIsPatient).toBe(false);
    expect(res.body.assignorId).not.toBe(patientAssignorId);
    // Remembered, so a revert is exact rather than a name match.
    expect(res.body.patientAssignorId).toBe(patientAssignorId);

    const assignor = await prisma.withPractice(practiceId, (tx) =>
      tx.assignor.findFirst({ where: { id: res.body.assignorId } }),
    );
    expect(assignor?.authorityBasis).toBe('parent');
    expect(assignor?.relationshipToPatient).toBe('parent');
    // C7.2 — the preference is on the ASSIGNOR, and mobile wins when both
    // could apply. Nothing here verified the number; it is somewhere to send.
    expect(assignor?.preferredChannel).toBe('mobile');
    // REQ-VUL-02 / REQ-AGE-01 — declarations recorded, never verified, and no
    // date of birth was asked for.
    expect(assignor?.authorityDeclaredAt).not.toBeNull();
    expect(assignor?.declaredOfFullAgeAt).not.toBeNull();
    expect(assignor?.dateOfBirth).toBeNull();
  });

  it('reverts to the patient, and doing it twice is the same as doing it once', async () => {
    const agreementId = await draft();
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'spouse',
        declaresEighteenOrOver: true,
        email: 'sam.carer@example.invalid',
      })
      .expect(201);

    const back = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);
    expect(back.body.assignorIsPatient).toBe(true);
    expect(back.body.assignorId).toBe(patientAssignorId);

    const again = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);
    expect(again.body.assignorId).toBe(patientAssignorId);

    // Idempotent means no second event, not merely no second row.
    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.assignor_changed', subjectId: agreementId },
    });
    expect(events).toHaveLength(2); // the change out, and the one change back
  });

  it('non_patient_assignor_requires_contact_channel', async () => {
    const agreementId = await draft();

    // Nothing at all. Carl, 3 Sep 2026: the copy (REQ-REG-08), any
    // post-service approval and every reminder now go to the SIGNER.
    const none = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'guardian',
        declaresEighteenOrOver: true,
      })
      .expect(400);
    expect(none.body.message).toContain('REQ-REG-08');
    // Framed as contact, never as identity.
    expect(none.body.message).not.toMatch(/identif|verif|prove who/i);
    // And it never echoes what was typed.
    expect(JSON.stringify(none.body)).not.toContain('Sam Carer');

    // A landline is not a channel this ceremony can use.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'guardian',
        declaresEighteenOrOver: true,
        mobile: '02 9999 0000',
      })
      .expect(400);

    // A typo'd address is the same as no address — a copy sent nowhere.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'guardian',
        declaresEighteenOrOver: true,
        email: 'sam.carer@example',
      })
      .expect(400);

    // Nothing was written by any of the three.
    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(after?.assignorIsPatient).toBe(true);
  });

  it('friend_is_other_with_note', async () => {
    const agreementId = await draft();

    // The platform does not judge who a patient chooses to bring with them.
    const res = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Kim Neighbour',
        authorityBasis: 'other_with_note',
        note: 'friend',
        declaresEighteenOrOver: true,
        email: 'kim.neighbour@example.invalid',
      })
      .expect(201);

    const assignor = await prisma.withPractice(practiceId, (tx) =>
      tx.assignor.findFirst({ where: { id: res.body.assignorId } }),
    );
    expect(assignor?.authorityBasis).toBe('other_with_note');
    expect(assignor?.authorityNote).toBe('friend');
    // C8 wants a relationship; the note is the honest one, so the rule set is
    // answered without asking the same question twice on the screen.
    expect(assignor?.relationshipToPatient).toBe('friend');
    expect(assignor?.preferredChannel).toBe('email');

    // "Other" with no note is a shrug, not an authority basis.
    const shrug = await request(app.getHttpServer())
      .post(`/agreements/${await draft()}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Kim Neighbour',
        authorityBasis: 'other_with_note',
        declaresEighteenOrOver: true,
        email: 'kim.neighbour@example.invalid',
      })
      .expect(400);
    expect(shrug.body.message).toContain('REQ-VUL-01');
  });

  it('practice_staff_rejected_as_assignor_server_side', async () => {
    const agreementId = await draft();

    // Case and spacing folded, exactly as the tablet folds them — a block a
    // different capitalisation walks through is not a block. And this request
    // never went near the tablet: the rule is the server's.
    const blocked = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'mai   NGUYEN',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(400);
    expect(blocked.body.message).toContain('REQ-VUL-04');
    expect(JSON.stringify(blocked.body)).not.toContain('Nguyen');

    // Deactivated is still staff. Fail closed.
    const formerStaff = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Jo Formerstaff',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(400);
    expect(formerStaff.body.message).toContain('REQ-VUL-04');

    // Somebody who merely shares a job title is fine.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Mai Nguyen-Baker',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(201);
  });

  it('assignor_for_another_must_be_of_full_age', async () => {
    const agreementId = await draft();

    const tooYoung = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Alex Sibling',
        authorityBasis: 'co_resident_relative_18_plus',
        declaresEighteenOrOver: false,
        mobile: '0400000222',
      })
      .expect(400);
    expect(tooYoung.body.message).toContain('REQ-AGE-01');

    // Omitting the declaration is not the same as making it.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Alex Sibling',
        authorityBasis: 'co_resident_relative_18_plus',
        mobile: '0400000222',
      })
      .expect(400);

    // The staff block is reported AHEAD of the age gate: a refusal that names
    // the age tells a staff member the wrong reason.
    const staffAndYoung = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Mai Nguyen',
        authorityBasis: 'parent',
        declaresEighteenOrOver: false,
        mobile: '0400000222',
      })
      .expect(400);
    expect(staffAndYoung.body.message).toContain('REQ-VUL-04');
  });

  it('locked_agreement_cannot_change_assignor', async () => {
    const agreementId = await draft();
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: '2026-09-03', basicServiceDescription: 'Attendance by a general practitioner' })
      .expect(201);

    // Hard rule 2 / REQ-REG-06. The artefact has been rendered and hashed
    // against this party; moving it underneath would break the hash the
    // signature will be bound to. A correction supersedes (HARD-02).
    const refused = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(400);
    expect(refused.body.message).toContain('REQ-REG-06');

    // Not even back to the patient.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(400);

    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(after?.assignorIsPatient).toBe(true);
    expect(after?.assignorId).toBe(patientAssignorId);
  });

  it('assignor_change_emits_vault_event_in_same_transaction', async () => {
    const agreementId = await draft();
    const res = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'health_epoa',
        declaresEighteenOrOver: true,
        mobile: '+61 400 000 333',
        email: 'sam.carer@example.invalid',
      })
      .expect(201);

    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.assignor_changed', subjectId: agreementId },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.authorityBasis).toBe('health_epoa');
    expect(payload.assignorIsPatient).toBe(false);
    expect(payload.assignorId).toBe(res.body.assignorId);
    expect(payload.previousAssignorId).toBe(patientAssignorId);
    // The channel TYPE, and only the type (REQ-VER-04, REQ-LOG-08).
    expect(payload.contactChannelType).toBe('mobile');
    // Reg 65CB(5): a declaration was recorded; nobody checked it.
    expect(payload.authoritySelfDeclared).toBe(true);

    // No name, no number, no address anywhere in the evidence row —
    // identifiers stay in the encrypted store.
    const serialised = JSON.stringify(events[0]);
    expect(serialised).not.toContain('Sam Carer');
    expect(serialised).not.toContain('400000333');
    expect(serialised).not.toContain('example.invalid');
  });

  it('a change the rule set refuses leaves NOTHING behind (one transaction, rule 11)', async () => {
    const agreementId = await draft();

    // C8 is asked about the payload AS PERSISTED, not about the request that
    // produced it — so a refusal arrives with the rows already written, and
    // the whole thing has to unwind.
    ruleSetRefusesEverything = true;
    let refused: request.Response;
    try {
      refused = await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/assignor`)
        .set('x-practice-id', practiceId)
        .send({
          assignorIsPatient: false,
          name: 'Kim Neighbour',
          authorityBasis: 'parent',
          declaresEighteenOrOver: true,
          email: 'kim.neighbour@example.invalid',
        })
        .expect(400);
    } finally {
      ruleSetRefusesEverything = false;
    }
    expect(JSON.stringify(refused.body)).toContain('C8');

    // The agreement is untouched, no assignor row was left orphaned, and no
    // evidence claims a change that did not happen.
    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(after?.assignorIsPatient).toBe(true);
    expect(after?.assignorId).toBe(patientAssignorId);

    const orphans = await prisma.withPractice(practiceId, (tx) =>
      tx.assignor.findMany({ where: { name: 'Kim Neighbour', authorityBasis: 'parent' } }),
    );
    expect(orphans).toEqual([]);

    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.assignor_changed', subjectId: agreementId },
    });
    expect(events).toEqual([]);
  });

  it('cross_practice_assignor_change_fails_closed (RLS)', async () => {
    const agreementId = await draft();

    // Another practice cannot re-point this agreement — and is not told it
    // exists.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', otherPracticeId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(404);

    // An id belonging to nobody's practice sees nothing, not everything.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', randomUUID())
      .send({ assignorIsPatient: true })
      .expect(404);

    // A missing scope is refused outright rather than defaulting to one.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .send({ assignorIsPatient: true })
      .expect(400);

    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(after?.assignorIsPatient).toBe(true);

    // And the other practice's staff list never gated this practice's block:
    // nothing of practice A leaked into B's scope either.
    const leaked = await prisma.withPractice(otherPracticeId, (tx) =>
      tx.agreement.findMany({ where: { id: agreementId } }),
    );
    expect(leaked).toEqual([]);
  });
});
