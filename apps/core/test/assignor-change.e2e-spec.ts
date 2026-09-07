import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

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
        affiliationId: providerId,
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
        await createServicingProvider(tx, practiceId, { name: 'Dr Example Provider', providerType: 'general_practitioner' })
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
        await deleteSeededAnchors(tx);
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

  it('relationship_and_authority_basis_are_recorded_separately', async () => {
    /*
     * REQ-VUL-01 NAMES THEM AS SEPARATE ATTRIBUTES, and until the kiosk's
     * relationship dropdown landed the server only ever had one of them: the
     * relationship was DERIVED from the basis (`RELATIONSHIP_BY_BASIS`), so a
     * grandparent and a friend both came out as "other".
     *
     * The tablet now asks the person what they are — in words they recognise —
     * derives the legal basis from that through versioned content, and sends
     * both. The basis is the ground for acting; the relationship is the fact
     * C8 prints on the agreement. Supplying the relationship overrides the
     * derivation with the more specific answer.
     */
    const agreementId = await draft();

    const res = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Kim Neighbour',
        relationship: 'Grandparent',
        relationshipsVersion: 'relationships-2026-09-1',
        authorityBasis: 'other_with_note',
        note: 'Grandparent',
        declaresEighteenOrOver: true,
        email: 'kim.neighbour@example.invalid',
      })
      .expect(201);

    const assignor = await prisma.withPractice(practiceId, (tx) =>
      tx.assignor.findFirst({ where: { id: res.body.assignorId } }),
    );
    // The word the person chose, not the category we filed them under.
    expect(assignor?.relationshipToPatient).toBe('Grandparent');
    expect(assignor?.authorityBasis).toBe('other_with_note');
    expect(assignor?.authorityNote).toBe('Grandparent');

    /*
     * AND WHICH LIST THEY CHOSE FROM lands on the vault event rather than on a
     * column (hard rule 14). The question asked months later is what the person
     * was OFFERED at the time, which is evidence about a moment, not current
     * state — and the outbox is where evidence about a moment goes.
     */
    const outbox = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.assignor_changed', subjectId: agreementId },
    });
    const changed = outbox.find(
      (row) => (row.payload as Record<string, unknown>).assignorId === res.body.assignorId,
    );
    expect((changed?.payload as Record<string, unknown>).relationshipsVersion).toBe(
      'relationships-2026-09-1',
    );

    // OMITTING IT CHANGES NOTHING for every caller that predates the dropdown:
    // the relationship is still derived from the basis, as it always was.
    const derived = await request(app.getHttpServer())
      .post(`/agreements/${await draft()}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Parent',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        email: 'sam.parent@example.invalid',
      })
      .expect(201);
    const withoutRelationship = await prisma.withPractice(practiceId, (tx) =>
      tx.assignor.findFirst({ where: { id: derived.body.assignorId } }),
    );
    expect(withoutRelationship?.relationshipToPatient).toBe('parent');
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

  /**
   * WHO SIGNS, AFTER THE LOCK — SUPERSEDES (Carl, 7 Sep 2026).
   *
   * The rule this replaced said a locked agreement could not change its
   * assignor at all, which was true of EDITING and read as true of the act.
   * Since an arrival locks its particulars the moment reception posts it,
   * every row on the tablet desk is locked and the control was dead on all of
   * them — so the mother who brought her son had no way through the product.
   * Hard rule 2 is intact: the locked agreement is not touched. A new one is
   * made (HARD-02), and these pin that the old one keeps its own true record.
   */
  async function lockedDraft(serviceDate = '2026-09-03'): Promise<string> {
    const agreementId = await draft();
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate, basicServiceDescription: 'Attendance by a general practitioner' })
      .expect(201);
    return agreementId;
  }

  it('who_is_signing_on_a_locked_row_supersedes_rather_than_edits', async () => {
    const agreementId = await lockedDraft();
    const before = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(before?.particularsLockedAt).not.toBeNull();

    const res = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(201);

    // A DIFFERENT AGREEMENT came back, and it points at the one it replaced.
    expect(res.body.id).not.toBe(agreementId);
    expect(res.body.supersedesAgreementId).toBe(agreementId);
    expect(res.body.assignorIsPatient).toBe(false);
    expect(res.body.patientAssignorId).toBe(patientAssignorId);
    // It is ready to sign in its own right: validated, rendered, hashed.
    expect(res.body.particularsLockedAt).not.toBeNull();
    expect(res.body.status).toBe('awaiting_signature');

    // AND THE OLD ONE IS UNTOUCHED (hard rule 11, hard rule 13). Same party,
    // same particulars, same hash, same status as before the request.
    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(after?.assignorIsPatient).toBe(true);
    expect(after?.assignorId).toBe(patientAssignorId);
    expect(after?.renderedArtefactHash).toBe(before?.renderedArtefactHash);
    expect(after?.particulars).toEqual(before?.particulars);
    expect(after?.status).toBe(before?.status);

    // The evidence says WHY, on the old agreement, and names nobody.
    const superseded = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.superseded', subjectId: agreementId },
    });
    expect(superseded).toHaveLength(1);
    expect((superseded[0].payload as Record<string, unknown>).reason).toBe('assignor_changed');
    expect((superseded[0].payload as Record<string, unknown>).supersededBy).toBe(res.body.id);
    expect(JSON.stringify(superseded[0])).not.toContain('Sam Carer');

    // And the party is stated on the NEW agreement, as ids and facts only.
    const changed = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.assignor_changed', subjectId: res.body.id as string },
    });
    expect(changed).toHaveLength(1);
    const payload = changed[0].payload as Record<string, unknown>;
    expect(payload.assignorIsPatient).toBe(false);
    expect(payload.assignorId).toBe(res.body.assignorId);
    expect(payload.supersedesAgreementId).toBe(agreementId);
    expect(JSON.stringify(changed[0])).not.toContain('Sam Carer');
    expect(JSON.stringify(changed[0])).not.toContain('0400000111');

    // The replacement is on reception's queue; the old one has nowhere left to
    // sign, on any channel (FR-2.7).
    const requests = await prisma.withPractice(practiceId, (tx) =>
      tx.captureRequest.findMany({ where: { agreementId: res.body.id as string } }),
    );
    expect(requests.map((r) => [r.channel, r.status])).toEqual([['in_practice', 'open']]);

    // ASKED FOR TWICE SUPERSEDES ONCE. A second press finds the answer already
    // on the record and returns it rather than making a third agreement.
    const again = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(201);
    expect(again.body.id).toBe(res.body.id);
    const successors = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { supersedesAgreementId: agreementId } }),
    );
    expect(successors).toHaveLength(1);

    // A DIFFERENT party on a row that has already moved on is refused with the
    // code that sends the console to the row that is live now.
    const moved = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Alex Other',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000222',
      })
      .expect(409);
    expect(moved.body.reason).toBe('agreement_moved_on');
  });

  it('supersession_carries_d6a_and_template_versions', async () => {
    const agreementId = await lockedDraft('2026-09-04');
    const before = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );

    const res = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Sam Carer',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(201);

    const replacement = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: res.body.id as string } }),
    );

    // D6a — chosen by a staff member on a staff surface. Losing it would send
    // reception back to re-choose something nobody changed.
    expect(replacement?.serviceDescription).toBe('Attendance by a general practitioner');
    const particulars = replacement?.particulars as Record<string, unknown>;
    expect(particulars.basicServiceDescription).toBe('Attendance by a general practitioner');
    // D5 — the visit did not move, only the party did.
    expect(particulars.serviceDate).toBe('2026-09-04');

    // RULE 14 — the replacement records what it was validated and rendered
    // under, and nothing changed between the two locks, so they agree.
    expect(replacement?.templateId).toBe(before?.templateId);
    expect(replacement?.templateVersion).toBe(before?.templateVersion);
    expect(replacement?.letterheadHash).toBe(before?.letterheadHash);
    expect(replacement?.ruleSetVersion).toBe('test-rules-1');
    expect(replacement?.mappingVersion).toBe('test-mapping-1');
    expect(replacement?.renderedArtefactHash).not.toBeNull();
    // A DIFFERENT document, because it names a different party — the point of
    // superseding rather than editing.
    expect(replacement?.renderedArtefactHash).not.toBe(before?.renderedArtefactHash);
  });

  it('staff_assignor_still_hard_blocked_after_lock', async () => {
    const agreementId = await lockedDraft();

    // REQ-VUL-04, fail closed — and the lock does not soften it. Case and
    // spacing are folded exactly as they are on an unlocked row.
    const blocked = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: '  mai   NGUYEN ',
        authorityBasis: 'parent',
        declaresEighteenOrOver: true,
        mobile: '0400000111',
      })
      .expect(400);
    expect(blocked.body.message).toContain('REQ-VUL-04');
    expect(JSON.stringify(blocked.body)).not.toContain('Nguyen');

    // A refused party supersedes NOTHING: no replacement, no orphan assignor,
    // no evidence of a change that did not happen.
    const successors = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { supersedesAgreementId: agreementId } }),
    );
    expect(successors).toEqual([]);
    const superseded = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.superseded', subjectId: agreementId },
    });
    expect(superseded).toEqual([]);

    // And the age gate is no softer either.
    const young = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({
        assignorIsPatient: false,
        name: 'Alex Sibling',
        authorityBasis: 'parent',
        declaresEighteenOrOver: false,
        mobile: '0400000111',
      })
      .expect(400);
    expect(young.body.message).toContain('REQ-AGE-01');
  });

  it('who_is_signing_refused_once_signed', async () => {
    const agreementId = await lockedDraft();

    /*
     * THE SIGNATURE EVENT ID IS THE FACT, so the fixture writes exactly that
     * and nothing else — the full ceremony is pinned by `signature.e2e-spec`
     * and re-running it here would be testing that instead of this.
     */
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.update({ where: { id: agreementId }, data: { signatureEventId: randomUUID() } }),
    );

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
      .expect(409);
    expect(refused.body.reason).toBe('already_signed');

    // Not even back to the patient: who signed is a fact about an act that
    // happened, and superseding would not change it.
    const back = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(409);
    expect(back.body.reason).toBe('already_signed');

    // Nothing was made and nothing was moved.
    const successors = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { supersedesAgreementId: agreementId } }),
    );
    expect(successors).toEqual([]);
    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(after?.assignorIsPatient).toBe(true);
    expect(after?.assignorId).toBe(patientAssignorId);
  });

  /**
   * TWO PRESSES, ONE SUPERSESSION (found in review, 7 Sep 2026).
   *
   * The disposition — locked, unsigned, no successor — was read in a
   * transaction that had already COMMITTED by the time the write opened its
   * own. Two overlapping calls both read it and both wrote a replacement: one
   * visit, two contracts, each claiming to replace the same agreement, and no
   * story anybody could reconstruct afterwards.
   *
   * The write now takes `SELECT ... FOR UPDATE` on the agreement and re-decides
   * under the lock, so the second caller blocks, reads what the first wrote,
   * and gets that agreement back rather than making another. The partial unique
   * index `agreements_one_successor` is the belt to that brace.
   */
  it('concurrent_who_is_signing_supersedes_once', async () => {
    const agreementId = await lockedDraft();
    const body = {
      assignorIsPatient: false,
      name: 'Sam Carer',
      authorityBasis: 'parent',
      declaresEighteenOrOver: true,
      mobile: '0400000111',
    };

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/agreements/${agreementId}/assignor`)
        .set('x-practice-id', practiceId)
        .send(body),
      request(app.getHttpServer())
        .post(`/agreements/${agreementId}/assignor`)
        .set('x-practice-id', practiceId)
        .send(body),
    ]);

    // NEITHER PRESS FAILED. The loser of the race is not told it lost — it is
    // told the answer, which is the same agreement.
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.id).toBe(second.body.id);
    expect(first.body.supersedesAgreementId).toBe(agreementId);

    // AND THERE IS EXACTLY ONE.
    const successors = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { supersedesAgreementId: agreementId } }),
    );
    expect(successors).toHaveLength(1);

    // One act, one supersession event — not two saying the same thing about
    // one agreement.
    const superseded = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.superseded', subjectId: agreementId },
    });
    expect(superseded).toHaveLength(1);
  });

  /**
   * A SIGNATURE THAT LANDS IN THE GAP REFUSES, rather than superseding what is
   * now signed evidence (found in review, 7 Sep 2026).
   *
   * HOW THE WINDOW IS STAGED. `changeAssignor` opens two transactions: the
   * first reads the agreement to decide what to do, the second writes. This
   * signs the row BETWEEN them, on its own connection, which is precisely what
   * a patient finishing at the tablet a heartbeat earlier would do. Without the
   * re-read under the lock, the write would go on to fabricate a successor for
   * a signed agreement — contradicting the one rule
   * `assignorRepointDisposition` never bends.
   */
  it('who_is_signing_refused_when_signed_between_read_and_write', async () => {
    const agreementId = await lockedDraft();
    /*
     * COUNTED, NOT LISTED. Earlier tests in this file have re-pointed their own
     * drafts at a party of the same name, and those rows are theirs — the
     * question here is whether THIS refusal left one behind.
     */
    const partiesBefore = await prisma.withPractice(practiceId, (tx) =>
      tx.assignor.count({ where: { name: 'Sam Carer' } }),
    );

    const original = prisma.withPractice.bind(prisma);
    let seen = 0;
    const spy = jest
      .spyOn(prisma, 'withPractice')
      .mockImplementation(async <T,>(scope: string, fn: (tx: never) => Promise<T>): Promise<T> => {
        seen += 1;
        // Call 1 is the disposition read. Immediately after it commits — and
        // before the write transaction below opens — the signature lands.
        if (seen === 2) {
          await original(scope, (tx) =>
            tx.agreement.update({
              where: { id: agreementId },
              data: { signatureEventId: randomUUID() },
            }),
          );
        }
        return original(scope, fn as never) as Promise<T>;
      });

    let refused: request.Response;
    try {
      refused = await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/assignor`)
        .set('x-practice-id', practiceId)
        .send({
          assignorIsPatient: false,
          name: 'Sam Carer',
          authorityBasis: 'parent',
          declaresEighteenOrOver: true,
          mobile: '0400000111',
        });
    } finally {
      spy.mockRestore();
    }

    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('already_signed');

    // NOTHING WAS MADE, and no assignor row was left behind by a transaction
    // that rolled back (hard rule 11).
    const successors = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { supersedesAgreementId: agreementId } }),
    );
    expect(successors).toEqual([]);
    const partiesAfter = await prisma.withPractice(practiceId, (tx) =>
      tx.assignor.count({ where: { name: 'Sam Carer' } }),
    );
    expect(partiesAfter).toBe(partiesBefore);
    const superseded = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.superseded', subjectId: agreementId },
    });
    expect(superseded).toEqual([]);
  });

  /**
   * WHO IS SIGNING IS ASKED, ANSWERED AND RECORDED — BEFORE THE PUSH (Carl,
   * 7 Sep 2026: "change the workflow to 'who is signing' only -- after that is
   * actioned, enable the select tablet and send button").
   *
   * WHY THE COLUMN HAD TO EXIST. Every agreement is drafted with the patient as
   * its own assignor — the arrival cascade does it, the New agreement form does
   * it — so `assignorIsPatient = true` is a DEFAULT, and on the record it is
   * indistinguishable from a receptionist having asked the person in front of
   * them. Carl pushed Kim to a tablet and said, twice, that the desk never
   * asked; it never had, and nothing could have recorded the answer.
   */
  it('confirming_the_patient_records_who_confirmed_and_when', async () => {
    const agreementId = await draft();
    const before = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    // A FRESH DRAFT IS UNCONFIRMED, which is the whole point: it already says
    // the patient is signing, and nobody has been asked.
    expect(before?.assignorIsPatient).toBe(true);
    expect(before?.assignorConfirmedAt).toBeNull();

    const res = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);

    // NOTHING ABOUT THE CONTRACT MOVED. Same party, same D7 — what changed is
    // that a person was asked.
    expect(res.body.assignorIsPatient).toBe(true);
    expect(res.body.assignorId).toBe(patientAssignorId);

    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(after?.assignorConfirmedAt).not.toBeNull();
    expect(after?.assignorId).toBe(before?.assignorId);

    /*
     * AND IT IS SAFE ON A LOCKED AGREEMENT, because a confirmation is not a
     * particular: it is not in `particulars`, not in the render and not in the
     * hash. Superseding to record it would spend a second agreement saying
     * exactly what the first one already said.
     */
    const lockedId = await lockedDraft();
    const lockedBefore = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: lockedId } }),
    );
    await request(app.getHttpServer())
      .post(`/agreements/${lockedId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);

    const lockedAfter = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: lockedId } }),
    );
    expect(lockedAfter?.assignorConfirmedAt).not.toBeNull();
    expect(lockedAfter?.renderedArtefactHash).toBe(lockedBefore?.renderedArtefactHash);
    expect(lockedAfter?.particulars).toEqual(lockedBefore?.particulars);
    const successors = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { supersedesAgreementId: lockedId } }),
    );
    expect(successors).toEqual([]);
  });

  it('assignor_confirmed_event_carries_ids_only', async () => {
    const agreementId = await draft();
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);

    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.assignor_confirmed', subjectId: agreementId },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.agreementId).toBe(agreementId);
    expect(payload.assignorIsPatient).toBe(true);

    /*
     * IDS AND FACTS ONLY (REQ-LOG-08, REQ-VER-04). The patient's name is on
     * this practice's records and not in the evidence row; neither is the
     * assignor's, and there is no contact value anywhere near it.
     */
    const serialised = JSON.stringify(events[0]);
    expect(serialised).not.toContain('Testpatient');
    expect(serialised).not.toContain('Robin');
    expect(serialised).not.toContain('Sam Carer');

    // AND IT IS NOT RECORDED AS A CHANGE, because nothing changed — a change in
    // the evidence that nobody made is worse than no record at all.
    const changed = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.assignor_changed', subjectId: agreementId },
    });
    expect(changed).toEqual([]);
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
