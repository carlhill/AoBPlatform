import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PORTAL_ACTIVATION_MAX_ATTEMPTS, PORTAL_SESSION_COOKIE } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RendererRegistry } from '../src/render/renderer-registry';
import { PortalService } from '../src/portal/portal.service';

/**
 * THE PATIENT'S OWN PAGE (C8 — REQ-PORT-01..08, FR-8.1/8.2, FR-1.14,
 * FR-1.19/-1.23, FR-5.3). TODO.md "The patient's own page", Carl 4 Sep 2026.
 *
 * WHAT THIS SUITE PINS, and every one is a rule rather than a behaviour
 * somebody liked:
 *
 *  - A TOKEN ALONE NEVER OPENS THE PORTAL. A valid, unexpired, unused
 *    invitation with wrong identifiers yields no session and no data — the
 *    family-phone rule made testable (REQ-VUL, addendum v4).
 *  - THE MEDICARE CARD NUMBER IS NOT AN IDENTIFIER, on the way in or the way
 *    out. Offering one to `activate` is a 400; no read can produce one
 *    (hard rule 1, REQ-VER-02).
 *  - NO AMOUNT ON AN AGREEMENT, ANYWHERE. The whole agreements payload is
 *    searched for a cents key and for the seeded figure (hard rule 4). The one
 *    card that carries one is the 89AA notice, and that is asserted too.
 *  - TENANCY FAILS CLOSED, and BOTH fences are live while it does. The service
 *    connects as `aob_app`, which holds neither SUPERUSER nor BYPASSRLS, so the
 *    RLS policies are really being exercised here rather than described. On top
 *    of them, the account's own links are the application filter — and another
 *    account's records are a 404 indistinguishable from a record that never
 *    existed.
 *  - RULE 13 ON THE PATIENT'S COPY. The artefact is re-rendered under the
 *    recorded renderer version and refused with 409 when the hash moves.
 *  - THE TERMINATION IS TWO BUSINESS DAYS AND THE NOTICE IS A DRAFT. The
 *    effective date comes from the enduring module's calendar, and the written
 *    notice is `draft_pending_review` with a review task beside it, because its
 *    wording is human-authored regulatory copy that does not exist yet.
 */
describe('M8 patient portal (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let renderers: RendererRegistry;
  let portal: PortalService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();

  let patientA = '';
  let patientB = '';
  let providerA = '';
  let assignorA = '';
  let signedAgreement = '';
  let enduringAgreement = '';
  let agreementB = '';
  let mismatchedAgreement = '';
  let captureRequestA = '';

  const STATED_CORRECT = {
    name: 'Sampleton Jamie',
    date_of_birth: '1962-11-02',
    address: '2 Example Street, Sampletown NSW 2000',
  };

  /** A benefit figure that appears in exactly one place, so a leak is findable. */
  const BENEFIT_CENTS = 4275;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    renderers = app.get(RendererRegistry);
    portal = app.get(PortalService);

    const renderer = renderers.current();

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.practice.create({ data: { id: practiceA, name: 'Portal Test Practice', state: 'NSW' } });
      await tx.practiceLocation.create({
        data: { practiceId: practiceA, address: '2 Example Street, Sampletown NSW 2000' },
      });
      const patient = await tx.patient.create({
        data: {
          practiceId: practiceA,
          familyName: 'Sampleton',
          givenNames: 'Jamie',
          dateOfBirth: new Date('1962-11-02'),
          address: '2 Example Street, Sampletown NSW 2000',
          mobile: '0400 000 000',
          email: 'jamie@example.invalid',
          patientRecordNumber: 'PRN-0001',
        },
      });
      patientA = patient.id;

      const provider = await tx.provider.create({
        data: { practiceId: practiceA, name: 'Dr Example Provider', providerType: 'general_practitioner' },
      });
      providerA = provider.id;

      const selfAssignor = await tx.assignor.create({
        data: { practiceId: practiceA, name: 'Jamie Sampleton', authorityBasis: 'self' },
      });
      const carer = await tx.assignor.create({
        data: {
          practiceId: practiceA,
          name: 'Alex Sampleton',
          authorityBasis: 'other_with_note',
          // The basis that needs a note gets one — a DB check constraint says
          // so, and rightly: `other_with_note` where the note is the basis.
          authorityNote: 'carer',
          relationshipToPatient: 'carer',
        },
      });
      assignorA = carer.id;

      /*
       * A SIGNED EPISODIC AGREEMENT, WITH A REAL HASH. The particulars are
       * rendered through the registry rather than hand-written, so the artefact
       * test exercises rule 13 for real instead of comparing a made-up string.
       * NOTE WHAT IS NOT IN THE PARTICULARS: no amount of any kind (hard rule 4)
       * and no Medicare number (hard rule 1).
       */
      const particulars = {
        agreementType: 'episodic_post',
        agreementDate: '2026-09-01',
        serviceDate: '2026-09-01',
        basicServiceDescription: 'General practitioner attendance',
        mbsItemNumbers: ['23'],
        patientName: 'Jamie Sampleton',
        providerName: 'Dr Example Provider',
      };
      const rendered = await renderer.render(particulars, ['en']);

      const agreement = await tx.agreement.create({
        data: {
          practiceId: practiceA,
          type: 'episodic_post',
          anchorKind: 'provider',
          providerId: provider.id,
          patientId: patient.id,
          assignorId: carer.id,
          assignorIsPatient: false,
          // Created as a DRAFT and moved to `stored` in the same breath as the
          // signature below. HARD-02 refuses any change to `signatureEventId`
          // once the status is a signed one, which is exactly right and means a
          // fixture has to walk the same order the real ceremony does.
          status: 'draft',
          serviceDescription: 'General practitioner attendance',
          particulars,
          particularsLockedAt: new Date('2026-09-01T01:00:00Z'),
          ruleSetVersion: 'test-rules-1',
          mappingVersion: 'test-mapping-1',
          renderedLanguages: ['en'],
          renderedArtefactHash: rendered.sha256,
          rendererVersion: rendered.rendererVersion,
        },
      });
      signedAgreement = agreement.id;

      const signature = await tx.signatureEvent.create({
        data: {
          practiceId: practiceA,
          agreementId: agreement.id,
          method: 'tap_to_approve',
          channel: 'sms_link',
          artefactHash: rendered.sha256,
          rendererVersion: rendered.rendererVersion,
        },
      });
      await tx.agreement.update({
        where: { id: agreement.id },
        data: { signatureEventId: signature.id, status: 'stored' },
      });

      /*
       * A SECOND LOCKED AGREEMENT WHOSE RECORDED HASH IS WRONG FROM BIRTH.
       *
       * The 409 path could not be reached by editing the first one — HARD-02
       * refuses to let a signed agreement's hash be changed, which is the rule
       * working. So the tamper case is seeded rather than simulated: an
       * agreement whose stored hash does not describe its own particulars,
       * which is precisely what rule 13 exists to catch on display.
       */
      const mismatched = await tx.agreement.create({
        data: {
          practiceId: practiceA,
          type: 'episodic_post',
          anchorKind: 'provider',
          providerId: provider.id,
          patientId: patient.id,
          assignorId: carer.id,
          assignorIsPatient: false,
          status: 'draft',
          particulars: { ...particulars, agreementDate: '2026-09-03' },
          particularsLockedAt: new Date('2026-09-03T01:00:00Z'),
          renderedLanguages: ['en'],
          renderedArtefactHash: 'f'.repeat(64),
          rendererVersion: rendered.rendererVersion,
        },
      });
      mismatchedAgreement = mismatched.id;

      // An enduring agreement, in force, to terminate.
      const enduring = await tx.agreement.create({
        data: {
          practiceId: practiceA,
          type: 'enduring',
          anchorKind: 'provider',
          providerId: provider.id,
          patientId: patient.id,
          assignorId: selfAssignor.id,
          assignorIsPatient: true,
          enduringPathway: 'mymedicare',
          status: 'stored',
        },
      });
      enduringAgreement = enduring.id;
      await tx.enduringDetail.create({
        data: {
          practiceId: practiceA,
          agreementId: enduring.id,
          notificationMethod: 'sms',
          terminationMethod: 'portal',
          scopeType: 'category',
          scopeValues: ['1'],
          enteredIntoAt: new Date('2026-08-01T00:00:00Z'),
        },
      });

      // A dispatched 89AA notice — the one artefact with an amount on it.
      await tx.notice.create({
        data: {
          practiceId: practiceA,
          agreementId: enduring.id,
          claimReference: 'CLAIM-TEST-1',
          claimLodgedAt: new Date('2026-09-02T01:00:00Z'),
          practitionerName: 'Dr Example Provider',
          patientName: 'Jamie Sampleton',
          serviceDate: new Date('2026-09-01'),
          benefitAmountCents: BENEFIT_CENTS,
          agreementMethod: 'sms',
          dispatchChannel: 'sms',
          payloadHash: 'test-payload-hash',
          dispatchedAt: new Date('2026-09-02T02:00:00Z'),
        },
      });

      // An open capture request and the message that carried it — `pending`.
      const capture = await tx.captureRequest.create({
        data: {
          practiceId: practiceA,
          agreementId: agreement.id,
          channel: 'sms_link',
          status: 'open',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      captureRequestA = capture.id;
      /*
       * A CORRESPONDENCE ROW MIRRORS A SEND, and a CHECK constraint says so:
       * it must point at a transport row or at a notice. That is the rule the
       * evidence layer is built on — no record of a message that never left —
       * so the fixture makes the transport row too rather than working round it.
       */
      const outbound = await tx.outboundItem.create({
        data: {
          practiceId: practiceA,
          channel: 'sms',
          destination: '0400 000 000',
          subjectType: 'CaptureRequest',
          subjectId: capture.id,
          payload: { kind: 'capture_link' },
          idempotencyKey: `portal-e2e-${capture.id}`,
          mediaType: 'sms',
          recipientType: 'patient',
          recipientId: patient.id,
          recipientName: 'Jamie Sampleton',
          state: 'sent',
          sentAt: new Date('2026-09-02T03:00:00Z'),
        },
      });
      await tx.correspondence.create({
        data: {
          outboundItemId: outbound.id,
          practiceId: practiceA,
          recipientType: 'patient',
          recipientId: patient.id,
          recipientName: 'Jamie Sampleton',
          channel: 'sms',
          subject: 'A request from your practice',
          bodyText: 'THIS BODY MUST NEVER REACH THE PORTAL',
          subjectType: 'CaptureRequest',
          subjectId: capture.id,
          state: 'sent',
          sentAt: new Date('2026-09-02T03:00:00Z'),
        },
      });
    });

    // A SECOND PRACTICE WITH A SECOND PATIENT, who this account never links.
    await prisma.withPractice(practiceB, async (tx) => {
      await tx.practice.create({ data: { id: practiceB, name: 'Other Practice', state: 'VIC' } });
      const patient = await tx.patient.create({
        data: {
          practiceId: practiceB,
          familyName: 'Otherperson',
          givenNames: 'Robin',
          dateOfBirth: new Date('1970-01-01'),
          address: '9 Other Road, Elsewhere VIC 3000',
        },
      });
      patientB = patient.id;
      const provider = await tx.provider.create({
        data: { practiceId: practiceB, name: 'Dr Other', providerType: 'general_practitioner' },
      });
      const assignor = await tx.assignor.create({
        data: { practiceId: practiceB, name: 'Robin Otherperson', authorityBasis: 'self' },
      });
      const agreement = await tx.agreement.create({
        data: {
          practiceId: practiceB,
          type: 'episodic_post',
          anchorKind: 'provider',
          providerId: provider.id,
          patientId: patient.id,
          assignorId: assignor.id,
          assignorIsPatient: true,
          status: 'stored',
        },
      });
      agreementB = agreement.id;
    });
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.portalTerminationNotice.deleteMany({});
        await tx.portalAssignorRevocation.deleteMany({});
        await tx.portalActivationToken.deleteMany({});
        await tx.reviewTask.deleteMany({});
        await tx.correspondence.deleteMany({});
        await tx.outboundItem.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.notice.deleteMany({});
        await tx.enduringDetail.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.practiceLocation.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    // Portal accounts are not practice-scoped; signature and verification
    // events are append-only by trigger and stay, which is the behaviour.
    await prisma.$executeRawUnsafe('DELETE FROM portal_sessions');
    await prisma.$executeRawUnsafe('DELETE FROM portal_account_patients');
    await prisma.$executeRawUnsafe('DELETE FROM portal_accounts');
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  /*
   * THE ACTIVATION LINK IS RATE-LIMITED BY ADDRESS, and every request in this
   * suite comes from the same one. The limiter is a brake on somebody
   * enumerating tokens, not part of any rule under test, so it is wound back
   * between tests — leaving it running would make the twentieth assertion in
   * the file fail for a reason none of them is about.
   */
  beforeEach(() => {
    portal.resetActivationRateLimit();
  });

  /** Mint one invitation the way the practice does. Returns the one-time token. */
  async function mintInvitation(agreementId = signedAgreement): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/portal-invitation`)
      .set('x-practice-id', practiceA)
      .expect(201);
    return res.body.activationToken;
  }

  /** The `aob_portal` cookie from a response, in the form supertest wants back. */
  function cookieFrom(res: request.Response): string {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const found = (raw ?? []).find((c) => c.startsWith(`${PORTAL_SESSION_COOKIE}=`));
    if (!found) throw new Error('no portal cookie was set');
    return found.split(';')[0];
  }

  async function activatedCookie(): Promise<string> {
    const token = await mintInvitation();
    const res = await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ agreementId: signedAgreement, activationToken: token, stated: STATED_CORRECT })
      .expect(201);
    return cookieFrom(res);
  }

  // -------------------------------------------------------------------------
  // Getting in
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // What the link opens — GET /portal/activate/:token/challenge
  // -------------------------------------------------------------------------

  it('activation_challenge_never_asks_for_a_medicare_number', async () => {
    const token = await mintInvitation();
    const res = await request(app.getHttpServer())
      .get(`/portal/activate/${encodeURIComponent(token)}/challenge`)
      .expect(200);

    /*
     * HARD RULE 1, REQ-VER-02. The types come from a practice row and a
     * practice row is data — so the server puts the list through the domain's
     * own approved-set guard before answering. There is no configuration that
     * produces a card-number box; there is only a configuration that produces
     * a page which refuses to open.
     */
    expect(res.body.identifierTypes.length).toBeGreaterThanOrEqual(3);
    expect(res.body.identifierTypes).not.toContain('medicare_number');
    expect(JSON.stringify(res.body)).not.toMatch(/medicare/i);
  });

  it('the challenge says which TYPES and nothing about the patient', async () => {
    const token = await mintInvitation();
    const res = await request(app.getHttpServer())
      .get(`/portal/activate/${encodeURIComponent(token)}/challenge`)
      .expect(200);

    expect(res.body.practiceName).toBe('Portal Test Practice');
    expect(res.body.attemptsRemaining).toBe(PORTAL_ACTIVATION_MAX_ATTEMPTS);
    expect(typeof res.body.expiresAt).toBe('string');

    /*
     * NO NAME, NO INITIALS, NO MASKED ANYTHING, NO IDS. Somebody holding a
     * forwarded link learns the practice's name — which the message they were
     * forwarded already said — and which KINDS of detail will be asked for,
     * which the kiosk shows anybody standing in a waiting room. Neither is a
     * fact about a person, and a partial value would be.
     */
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Sampleton');
    expect(body).not.toContain('Jamie');
    expect(body).not.toContain('Example Street');
    expect(body).not.toContain('1962-11-02');
    expect(body).not.toContain(patientA);
    expect(body).not.toContain(signedAgreement);
    // And no session was handed out by a read.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a dead link with a reason code the page can map (Carl, 4 Sep 2026)', async () => {
    const unknown = await request(app.getHttpServer())
      .get('/portal/activate/not-a-real-token/challenge')
      .expect(404);
    expect(unknown.body.reason).toBe('token_unknown');

    /*
     * EXPIRED. Aged past its seven days rather than waiting for them — and the
     * MINT DATE moves with the expiry, because a DB check constraint refuses a
     * row that expires before it was created. That constraint is the reason
     * this is three lines rather than one, and it is worth the three.
     */
    const expiring = await mintInvitation();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600_000);
    await prisma.withPractice(practiceA, (tx) =>
      tx.portalActivationToken.updateMany({
        where: { agreementId: signedAgreement, usedAt: null, lockedAt: null },
        data: { createdAt: eightDaysAgo, expiresAt: new Date(Date.now() - 1000) },
      }),
    );
    const expired = await request(app.getHttpServer())
      .get(`/portal/activate/${encodeURIComponent(expiring)}/challenge`)
      .expect(404);
    expect(expired.body.reason).toBe('token_expired');

    // LOCKED, by the same three failures that lock the attempt path.
    const locking = await mintInvitation();
    const wrong = { ...STATED_CORRECT, name: 'Wrongname Person' };
    for (let i = 0; i < PORTAL_ACTIVATION_MAX_ATTEMPTS; i += 1) {
      await request(app.getHttpServer())
        .post('/portal/activate')
        .send({ activationToken: locking, stated: wrong });
    }
    const locked = await request(app.getHttpServer())
      .get(`/portal/activate/${encodeURIComponent(locking)}/challenge`)
      .expect(404);
    expect(locked.body.reason).toBe('token_locked');

    // USED IS `token_expired` TOO, on purpose: telling a stranger holding a
    // forwarded link that the patient has already activated is a disclosure.
    const spendable = await mintInvitation();
    await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ activationToken: spendable, stated: STATED_CORRECT })
      .expect(201);
    const used = await request(app.getHttpServer())
      .get(`/portal/activate/${encodeURIComponent(spendable)}/challenge`)
      .expect(404);
    expect(used.body.reason).toBe('token_expired');

    // NO REFUSAL EVER CARRIES A DETAIL, whatever its reason.
    for (const res of [unknown, expired, locked, used]) {
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('Sampleton');
      expect(body).not.toContain('Example Street');
    }
  });

  it('activates from the token alone — the page is never told an agreement id', async () => {
    const token = await mintInvitation();
    const res = await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ activationToken: token, stated: STATED_CORRECT })
      .expect(201);
    expect(res.body.activated).toBe(true);
    // A caller that DOES name one still has it checked against the row.
    const other = await mintInvitation();
    await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ agreementId: enduringAgreement, activationToken: other, stated: STATED_CORRECT })
      .expect(404);
  });

  it('offers activation only after a signature (FR-1.14)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/agreements/${enduringAgreement}/portal-invitation`)
      .set('x-practice-id', practiceA)
      .expect(400);
    expect(res.body.message).toContain('signed');
  });

  it('portal_activation_rejects_medicare_number_as_identifier', async () => {
    const token = await mintInvitation();
    const res = await request(app.getHttpServer())
      .post('/portal/activate')
      .send({
        agreementId: signedAgreement,
        activationToken: token,
        stated: { ...STATED_CORRECT, medicare_number: '1234567891' },
      })
      .expect(400);
    expect(res.body.message).toContain('not an approved patient identifier');
    expect(res.body.message).toContain('not configurable');
    // And nothing was opened by the attempt.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('a_token_alone_never_opens_the_portal', async () => {
    const token = await mintInvitation();

    const res = await request(app.getHttpServer())
      .post('/portal/activate')
      .send({
        agreementId: signedAgreement,
        activationToken: token,
        stated: { ...STATED_CORRECT, date_of_birth: '1990-01-01' },
      })
      .expect(401);

    // NO SESSION…
    expect(res.headers['set-cookie']).toBeUndefined();
    // …AND NO DATA. Not even which identifier was wrong (REQ-SEC-07).
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Sampleton');
    expect(body).not.toContain('Example Street');

    // …AND THE READS STAY SHUT to a caller holding only the token.
    await request(app.getHttpServer()).get('/portal/agreements').expect(401);
    await request(app.getHttpServer()).get('/portal/details').expect(401);
  });

  it('activation_locks_after_three_failed_attempts', async () => {
    const token = await mintInvitation();
    const wrong = { ...STATED_CORRECT, name: 'Wrongname Person' };
    const attempt = () =>
      request(app.getHttpServer())
        .post('/portal/activate')
        .send({ agreementId: signedAgreement, activationToken: token, stated: wrong });

    await attempt().expect(401);
    await attempt().expect(401);
    await attempt().expect(423);
    // A FOURTH ATTEMPT IS REFUSED EVEN WITH THE RIGHT ANSWERS. The invitation
    // is spent, not the person: three is the whole budget (REQ-PORT-08).
    const spent = await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ agreementId: signedAgreement, activationToken: token, stated: STATED_CORRECT })
      .expect(423);
    expect(spent.body.reason).toBe('token_locked');
    expect(spent.headers['set-cookie']).toBeUndefined();

    /*
     * THE COUNT IS PER TOKEN, NOT PER PATIENT. A fresh invitation for the same
     * patient starts at three — otherwise a mistyped address would put somebody
     * out of the portal for good, and the practice's remedy (mint another) would
     * not be a remedy.
     */
    const fresh = await mintInvitation();
    await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ agreementId: signedAgreement, activationToken: fresh, stated: STATED_CORRECT })
      .expect(201);
  });

  it('activation_logs_identifier_types_not_values', async () => {
    await prisma.vaultOutbox.deleteMany({ where: { type: 'portal.activated' } });
    const token = await mintInvitation();
    await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ activationToken: token, stated: STATED_CORRECT })
      .expect(201);

    const events = await prisma.vaultOutbox.findMany({ where: { type: 'portal.activated' } });
    expect(events).toHaveLength(1);
    const payload = JSON.stringify(events[0].payload);

    // TYPES AND AN OUTCOME (REQ-VER-04, hard rule 9).
    expect(payload).toContain('address');
    expect(payload).toContain('date_of_birth');
    expect(payload).toContain('passed');
    // AND NOT ONE VALUE — not a name, not a date, not an address, not the token.
    expect(payload).not.toContain('Sampleton');
    expect(payload).not.toContain('Jamie');
    expect(payload).not.toContain('1962-11-02');
    expect(payload).not.toContain('Example Street');
    expect(payload).not.toContain(token);
    // AND NEVER A CARD NUMBER, in any spelling.
    expect(payload).not.toMatch(/medicare/i);
  });

  it('activates on three correct identifiers, links the practice and issues a session', async () => {
    const token = await mintInvitation();
    const res = await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ agreementId: signedAgreement, activationToken: token, stated: STATED_CORRECT })
      .expect(201);

    expect(res.body.activated).toBe(true);
    expect(res.body.links).toHaveLength(1);
    expect(res.body.links[0]).toMatchObject({ practiceId: practiceA, patientId: patientA });
    expect(res.body.links[0].practiceName).toBe('Portal Test Practice');

    const cookie = cookieFrom(res);
    const session = await request(app.getHttpServer()).get('/portal/session').set('Cookie', cookie).expect(200);
    expect(session.body.accountId).toBe(res.body.accountId);

    // The activation and the access are both in the chain (FR-8.2, hard rule 11).
    const events = await prisma.vaultOutbox.findMany({ where: { type: { startsWith: 'portal.' } } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['portal.activated', 'portal.accessed']));
    // TYPES ONLY, never values (REQ-VER-04, hard rule 9).
    const serialised = JSON.stringify(events);
    expect(serialised).toContain('date_of_birth');
    expect(serialised).not.toContain('Sampleton');
    expect(serialised).not.toContain('1962-11-02');
  });

  it('portal_invitation_message_quotes_the_record_id', async () => {
    const token = await mintInvitation();

    const [invitation, queued] = await prisma.withPractice(practiceA, async (tx) => [
      await tx.portalActivationToken.findFirst({ orderBy: { createdAt: 'desc' } }),
      await tx.outboundItem.findFirst({
        where: { subjectType: 'PortalActivationToken' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    /*
     * THE ACCOUNT EXISTS BEFORE THE PATIENT DOES ANYTHING. That is what lets the
     * FIRST message quote the id they will later see on the page and in their
     * password manager — the check is worthless if the id only appears afterwards.
     */
    expect(invitation?.accountId).toBeTruthy();
    const recordId = `AoBPlatform-PatientId-${invitation!.accountId}`;

    // THE BODY THE SANDBOX GATEWAY IS HANDED. The worker passes this payload
    // straight through — composition happens at enqueue, delivery moves bytes.
    expect(queued).toBeTruthy();
    const payload = queued!.payload as Record<string, string>;
    const body = `${payload.subject ?? ''}
${payload.body ?? ''}`;

    expect(body).toContain(recordId);
    expect(body).toContain(
      'Every genuine message from us about your record quotes it, and you will see it on the page after you sign in.',
    );
    // THE LINK, IN FULL, because people forward and paste — and a bare
    // "click here" is the exact shape of a phishing message.
    expect(body).toContain(`/patient/portal/activate/${token}`);
    expect(payload.templateKey).toBe('portal_invitation_v1');
    expect(payload.templateVersion).toBeTruthy();

    /*
     * AND NOTHING ELSE ABOUT THEM. The given name and the practice's name are
     * what makes a message readable as ours; every other patient value stays
     * out — no date of birth, no address, no record number, no Medicare number
     * (there is no such column), no amount of any kind (hard rule 4).
     */
    expect(body).not.toContain('1962-11-02');
    expect(body).not.toContain('2 Example Street');
    expect(body).not.toContain('PRN-0001');
    /*
     * THE CARD NUMBER IS MENTIONED ONCE AND ONLY IN THE FOOTER'S PROMISE NOT TO
     * ASK FOR ONE, which is the line doing the most work in the whole message:
     * it hands the reader a rule they can apply to the NEXT message, including
     * one we did not send. Nothing anywhere asks for one (hard rule 1).
     */
    expect(body).toContain('We will never ask you for a password, a Medicare number, or bank details');
    expect(body).not.toMatch(/(send|reply with|enter|provide|confirm)[^.]{0,40}medicare/i);
    expect(body).not.toMatch(/[$]|\bAUD\b|\bdollars?\b/i);
    // Hard rule 12 — never about our forms.
    expect(body).not.toMatch(/\b(certified|approved|accredited|government-approved)\b/i);
  });

  it('activation_links_into_the_preminted_account', async () => {
    const token = await mintInvitation();
    const invitation = await prisma.withPractice(practiceA, (tx) =>
      tx.portalActivationToken.findFirst({ orderBy: { createdAt: 'desc' } }),
    );
    const preMinted = invitation!.accountId!;

    /*
     * A TOKEN NAMING AN ACCOUNT IS STILL NOT A DOOR. Wrong identifiers open
     * nothing: no session, no new link, and the invitation is not spent
     * (REQ-VUL, addendum v4 — the family-phone rule). The link COUNT is what is
     * asserted rather than zero, because this patient has activated earlier in
     * this suite and the mint deliberately reuses the account they already have.
     */
    const linksBefore = await prisma.withPractice(practiceA, (tx) =>
      tx.portalAccountPatient.count({ where: { accountId: preMinted } }),
    );
    const refused = await request(app.getHttpServer())
      .post('/portal/activate')
      .send({
        agreementId: signedAgreement,
        activationToken: token,
        stated: { ...STATED_CORRECT, address: '99 Nowhere Road, Sampletown NSW 2000' },
      })
      .expect(401);
    expect(refused.headers['set-cookie']).toBeUndefined();
    const afterRefusal = await prisma.withPractice(practiceA, async (tx) => ({
      links: await tx.portalAccountPatient.count({ where: { accountId: preMinted } }),
      spent: (await tx.portalActivationToken.findFirst({ where: { id: invitation!.id } }))?.usedAt ?? null,
    }));
    expect(afterRefusal.links).toBe(linksBefore);
    expect(afterRefusal.spent).toBeNull();

    const res = await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ agreementId: signedAgreement, activationToken: token, stated: STATED_CORRECT })
      .expect(201);

    // THE ID IN THE MESSAGE IS THE ID ON THE PAGE.
    expect(res.body.accountId).toBe(preMinted);
    const session = await request(app.getHttpServer())
      .get('/portal/session')
      .set('Cookie', cookieFrom(res))
      .expect(200);
    expect(session.body.accountId).toBe(preMinted);
    expect(session.body.links.some((l: { patientId: string }) => l.patientId === patientA)).toBe(true);
  });

  it('gives one patient one record id, however many invitations they are sent', async () => {
    await mintInvitation();
    await mintInvitation();
    const tokens = await prisma.withPractice(practiceA, (tx) =>
      tx.portalActivationToken.findMany({ where: { patientId: patientA }, orderBy: { createdAt: 'desc' }, take: 2 }),
    );
    expect(tokens[0].accountId).toBe(tokens[1].accountId);
  });

  it('spends the invitation — a used one cannot be replayed', async () => {
    const token = await mintInvitation();
    await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ agreementId: signedAgreement, activationToken: token, stated: STATED_CORRECT })
      .expect(201);
    await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ agreementId: signedAgreement, activationToken: token, stated: STATED_CORRECT })
      .expect(410);
  });

  // -------------------------------------------------------------------------
  // The reads
  // -------------------------------------------------------------------------

  it('portal_details_never_include_a_medicare_number', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer()).get('/portal/details').set('Cookie', cookie).expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      practiceId: practiceA,
      patientId: patientA,
      familyName: 'Sampleton',
      givenNames: 'Jamie',
      dateOfBirth: '1962-11-02',
      patientRecordNumber: 'PRN-0001',
    });

    // No such KEY, under any spelling, and no such value.
    const keys = Object.keys(res.body[0]).map((k) => k.toLowerCase());
    for (const key of keys) {
      expect(key).not.toContain('medicare');
      expect(key).not.toContain('card');
    }
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('medicare');
  });

  it('portal_agreements_carry_no_amount', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer()).get('/portal/agreements').set('Cookie', cookie).expect(200);

    const agreement = res.body.find((a: { id: string }) => a.id === signedAgreement);
    expect(agreement).toMatchObject({
      practiceName: 'Portal Test Practice',
      providerName: 'Dr Example Provider',
      type: 'episodic_post',
      serviceDate: '2026-09-01',
      serviceDescription: 'General practitioner attendance',
      channel: 'sms_link',
      artefactAvailable: true,
    });
    expect(agreement.signedAt).toBeTruthy();

    const serialised = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of ['amount', 'cents', 'benefit', 'fee', 'price', '$']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(serialised).not.toContain(String(BENEFIT_CENTS));
  });

  it('serves the copy as signed, re-verifying the hash first (REQ-PORT-02, rule 13)', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer())
      .get(`/portal/agreements/${signedAgreement}/artefact`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    const stored = await prisma.withPractice(practiceA, (tx) =>
      tx.agreement.findFirst({ where: { id: signedAgreement } }),
    );
    expect(res.headers['x-artefact-sha256']).toBe(stored!.renderedArtefactHash);

    // Reading evidence is itself evidence (REQ-LOG-07).
    const reads = await prisma.vaultOutbox.findMany({
      where: { type: 'artefact.accessed', subjectId: signedAgreement },
    });
    expect(reads.length).toBeGreaterThan(0);
  });

  it('refuses the copy with 409 when the recorded hash does not match (rule 13)', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer())
      .get(`/portal/agreements/${mismatchedAgreement}/artefact`)
      .set('Cookie', cookie)
      .expect(409);
    expect(res.body.message).toContain('tamper signal');
  });

  it('shows 89AA notices with the amount — the one card that has one (REQ-PORT-04, hard rule 7)', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer()).get('/portal/notices').set('Cookie', cookie).expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      date: '2026-09-01',
      providerName: 'Dr Example Provider',
      practiceName: 'Portal Test Practice',
      benefitAmountCents: BENEFIT_CENTS,
    });

    // NOTHING THAT COULD READ AS A DECISION. A notice is one-way and is never
    // chased; a status field here would be an invitation to build a button.
    const keys = Object.keys(res.body[0]).map((k) => k.toLowerCase());
    for (const forbidden of ['status', 'state', 'approved', 'accepted', 'action', 'consent']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('lists visits from service dates only, never a clinical fact', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer()).get('/portal/visits').set('Cookie', cookie).expect(200);
    expect(res.body[0]).toMatchObject({
      date: '2026-09-01',
      practiceName: 'Portal Test Practice',
      locationLine: '2 Example Street, Sampletown NSW 2000',
    });
    expect(Object.keys(res.body[0]).sort()).toEqual(['date', 'locationLine', 'practiceId', 'practiceName']);
  });

  it('lists messages with a purpose key and a pending flag, and NEVER a body (REQ-PORT-06)', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer()).get('/portal/messages').set('Cookie', cookie).expect(200);

    /*
     * THE CAPTURE REQUEST IS THE ROW UNDER TEST. Since 4 Sep 2026 every
     * `mintInvitation` also QUEUES the invitation itself, so this list legitimately
     * carries one `portal_invitation` row per invitation minted in this suite —
     * which is the behaviour, not noise: the first message we send a patient is
     * the one they are most likely to check.
     */
    const captures = res.body.filter((m: { purposeKey: string }) => m.purposeKey === 'capture_request');
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      channel: 'sms',
      state: 'sent',
      purposeKey: 'capture_request',
      practiceName: 'Portal Test Practice',
      pending: true,
    });
    expect(res.body.some((m: { purposeKey: string }) => m.purposeKey === 'portal_invitation')).toBe(true);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('THIS BODY MUST NEVER REACH THE PORTAL');
    expect(serialised).not.toContain('A request from your practice');
  });

  it('shows an unused invitation as waiting for the patient, and clears it once activated', async () => {
    /*
     * REQ-PORT-06 — "Waiting for you" is the anti-phishing strip, and it only
     * works if it is complete. Before 5 Sep 2026 the invitation to this very
     * page was never pending, so a patient signed in on one device saw the
     * offer they had not yet taken up on another listed as though it were
     * finished (Carl, 5 Sep 2026).
     */
    const cookie = await activatedCookie();
    const openInvitations = async (): Promise<number> => {
      const res = await request(app.getHttpServer()).get('/portal/messages').set('Cookie', cookie).expect(200);
      return res.body.filter(
        (m: { purposeKey: string; pending: boolean }) => m.purposeKey === 'portal_invitation' && m.pending,
      ).length;
    };

    /*
     * A DELTA RATHER THAN A COUNT. Earlier tests in this file mint invitations
     * they never spend, and every one of them is legitimately still waiting —
     * asserting on the total would be asserting on the order of the suite.
     */
    const before = await openInvitations();
    const waiting = await mintInvitation();
    expect(await openInvitations()).toBe(before + 1);

    // ONE WRITE CLEARS IT. `usedAt` is set in the same transaction as the link,
    // so there is no second update to forget.
    await request(app.getHttpServer())
      .post('/portal/activate')
      .send({ activationToken: waiting, stated: STATED_CORRECT })
      .expect(201);
    expect(await openInvitations()).toBe(before);
  });

  it('shows who acts for the patient, and an empty iActFor until FR-1.19 exists', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer()).get('/portal/assignors').set('Cookie', cookie).expect(200);
    expect(res.body.actsForMe).toHaveLength(1);
    expect(res.body.actsForMe[0]).toMatchObject({
      assignorId: assignorA,
      name: 'Alex Sampleton',
      relationshipKey: 'carer',
      active: true,
    });
    expect(res.body.iActFor).toEqual([]);
  });

  it('revokes an assignor with no justification asked for or accepted (FR-1.23)', async () => {
    const cookie = await activatedCookie();
    await request(app.getHttpServer())
      .post(`/portal/assignors/${assignorA}/revoke`)
      .set('Cookie', cookie)
      // A reason in the body is stripped by the whitelist and reaches nothing.
      .send({ reason: 'none of your business' })
      .expect(201);

    const after = await request(app.getHttpServer()).get('/portal/assignors').set('Cookie', cookie).expect(200);
    expect(after.body.actsForMe[0].active).toBe(false);

    const events = await prisma.vaultOutbox.findMany({ where: { type: 'portal.assignor_revoked' } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('none of your business');

    // THE AGREEMENT DID NOT MOVE. Revoking says who may act from now on; it
    // does not unmake a validly signed contract (HARD-02).
    const agreement = await prisma.withPractice(practiceA, (tx) =>
      tx.agreement.findFirst({ where: { id: signedAgreement } }),
    );
    expect(agreement!.status).toBe('stored');
    expect(agreement!.assignorId).toBe(assignorA);

    await prisma.withPractice(practiceA, (tx) => tx.portalAssignorRevocation.deleteMany({}));
  });

  it('raises a correction request that carries a field type and no new value', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer())
      .post('/portal/details/correction-request')
      .set('Cookie', cookie)
      .send({ practiceId: practiceA, fieldType: 'address', newValue: '7 Somewhere Else' })
      .expect(201);

    expect(res.body).toMatchObject({ raised: true, fieldType: 'address', practiceId: practiceA });

    const task = await prisma.withPractice(practiceA, (tx) =>
      tx.reviewTask.findFirst({ where: { id: res.body.reviewTaskId } }),
    );
    expect(task!.kind).toBe('portal_correction_requested');
    expect(task!.subjectId).toBe(patientA);
    // The proposed value was stripped by the whitelist and is nowhere.
    expect(JSON.stringify(task)).not.toContain('Somewhere Else');

    const events = await prisma.vaultOutbox.findMany({ where: { type: 'portal.correction_requested' } });
    expect(JSON.stringify(events)).not.toContain('Somewhere Else');
    expect(JSON.stringify(events)).not.toContain('Example Street');
  });

  it('refuses a correction request for a practice the account never linked', async () => {
    const cookie = await activatedCookie();
    await request(app.getHttpServer())
      .post('/portal/details/correction-request')
      .set('Cookie', cookie)
      .send({ practiceId: practiceB, fieldType: 'address' })
      .expect(404);
  });

  it('builds an access log of keys, never values (FR-8.2)', async () => {
    const cookie = await activatedCookie();
    const res = await request(app.getHttpServer()).get('/portal/access-log').set('Cookie', cookie).expect(200);

    expect(res.body.length).toBeGreaterThan(0);
    for (const entry of res.body) {
      expect(Object.keys(entry).sort()).toEqual(['actionKey', 'actorType', 'at', 'practiceId', 'practiceName']);
      expect(['practice_staff', 'patient', 'system']).toContain(entry.actorType);
      expect(entry.practiceName).toBe('Portal Test Practice');
    }
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('Sampleton');
    expect(serialised).not.toContain('Example Street');
  });

  // -------------------------------------------------------------------------
  // Ending an enduring agreement
  // -------------------------------------------------------------------------

  it('terminates an enduring agreement two BUSINESS days out, with a DRAFT notice (REQ-PORT-05, FR-5.3)', async () => {
    const cookie = await activatedCookie();

    const before = await request(app.getHttpServer()).get('/portal/enduring').set('Cookie', cookie).expect(200);
    expect(before.body).toHaveLength(1);
    expect(before.body[0]).toMatchObject({
      agreementId: enduringAgreement,
      providerName: 'Dr Example Provider',
      activeSince: '2026-08-01',
    });

    const res = await request(app.getHttpServer())
      .post(`/portal/enduring/${enduringAgreement}/terminate`)
      .set('Cookie', cookie)
      .expect(201);

    expect(res.body.noticeStatus).toBe('draft_pending_review');
    expect(res.body.noticeTemplateKey).toBe('enduring_termination_notice_v1');
    expect(res.body.calendar).toContain('NSW');

    // TWO BUSINESS DAYS, not two calendar days: strictly later than the notice,
    // and never landing on a weekend.
    const noticeAt = new Date(res.body.noticeAt);
    const effectiveAt = new Date(res.body.effectiveAt);
    expect(effectiveAt.getTime()).toBeGreaterThan(noticeAt.getTime());
    expect([0, 6]).not.toContain(effectiveAt.getUTCDay());
    expect(effectiveAt.getTime() - noticeAt.getTime()).toBeGreaterThanOrEqual(2 * 86_400_000);

    const notice = await prisma.withPractice(practiceA, (tx) =>
      tx.portalTerminationNotice.findFirst({ where: { agreementId: enduringAgreement } }),
    );
    expect(notice!.status).toBe('draft_pending_review');
    expect(notice!.templateVersion).toContain('DRAFT');

    const task = await prisma.withPractice(practiceA, (tx) =>
      tx.reviewTask.findFirst({ where: { id: notice!.reviewTaskId! } }),
    );
    expect(task!.kind).toBe('portal_enduring_terminated');

    const events = await prisma.vaultOutbox.findMany({ where: { type: 'portal.enduring_terminated' } });
    expect(events).toHaveLength(1);
    // The event carries no amount and no name.
    expect(JSON.stringify(events).toLowerCase()).not.toContain('sampleton');
  });

  // -------------------------------------------------------------------------
  // Tenancy
  // -------------------------------------------------------------------------

  it('portal_reads_are_scoped_to_the_accounts_own_links', async () => {
    const mine = await activatedCookie();

    // A second account, linked to the OTHER practice's patient through the dev
    // seam — the same shape the real path produces, without a second ceremony.
    const other = await request(app.getHttpServer())
      .post('/dev/portal-session')
      .send({ patientIds: [patientB], practiceIds: [practiceB] })
      .expect(201);
    const theirs = cookieFrom(other);

    // Each sees only their own.
    const mineAgreements = await request(app.getHttpServer())
      .get('/portal/agreements')
      .set('Cookie', mine)
      .expect(200);
    expect(mineAgreements.body.map((a: { id: string }) => a.id)).not.toContain(agreementB);
    expect(mineAgreements.body.every((a: { practiceId: string }) => a.practiceId === practiceA)).toBe(true);

    const theirAgreements = await request(app.getHttpServer())
      .get('/portal/agreements')
      .set('Cookie', theirs)
      .expect(200);
    expect(theirAgreements.body.map((a: { id: string }) => a.id)).toEqual([agreementB]);

    const theirDetails = await request(app.getHttpServer())
      .get('/portal/details')
      .set('Cookie', theirs)
      .expect(200);
    expect(JSON.stringify(theirDetails.body)).not.toContain('Sampleton');

    // FAILS CLOSED, AND INDISTINGUISHABLY. Somebody else's agreement is a 404,
    // the same answer an id that never existed gets.
    await request(app.getHttpServer())
      .get(`/portal/agreements/${agreementB}/artefact`)
      .set('Cookie', mine)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/portal/agreements/${randomUUID()}/artefact`)
      .set('Cookie', mine)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/portal/enduring/${enduringAgreement}/terminate`)
      .set('Cookie', theirs)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/portal/assignors/${assignorA}/revoke`)
      .set('Cookie', theirs)
      .expect(404);
  });

  it('a revoked session stops working at once', async () => {
    const cookie = await activatedCookie();
    await request(app.getHttpServer()).get('/portal/session').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).post('/portal/sign-out').set('Cookie', cookie).expect(201);
    await request(app.getHttpServer()).get('/portal/session').set('Cookie', cookie).expect(401);
  });

  it('a made-up cookie is a 401, not a database error', async () => {
    await request(app.getHttpServer())
      .get('/portal/session')
      .set('Cookie', `${PORTAL_SESSION_COOKIE}=not-a-uuid`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/portal/session')
      .set('Cookie', `${PORTAL_SESSION_COOKIE}=${randomUUID()}`)
      .expect(401);
  });

  it('adds a second practice to the SAME account rather than making a second one', async () => {
    // Deliberately reuses the first practice's own invitation flow: the point
    // under test is that an existing cookie is honoured, not that two practices
    // exist. A second link from the same practice is idempotent.
    const cookie = await activatedCookie();
    const token = await mintInvitation();
    const res = await request(app.getHttpServer())
      .post('/portal/activate')
      .set('Cookie', cookie)
      .send({ agreementId: signedAgreement, activationToken: token, stated: STATED_CORRECT })
      .expect(201);

    const before = await request(app.getHttpServer()).get('/portal/session').set('Cookie', cookie).expect(200);
    expect(res.body.accountId).toBe(before.body.accountId);
    expect(res.body.links).toHaveLength(1);
  });

  it('the dev portal session writes its access event like the real one', async () => {
    const res = await request(app.getHttpServer())
      .post('/dev/portal-session')
      .set('x-practice-id', practiceA)
      .send({ patientIds: [patientA] })
      .expect(201);
    expect(res.body.links).toHaveLength(1);
    const events = await prisma.vaultOutbox.findMany({ where: { type: 'portal.accessed' } });
    expect(events.length).toBeGreaterThan(0);
    // Unused in the assertions above but pinned so the fixture stays honest.
    expect(captureRequestA).toBeTruthy();
    expect(providerA).toBeTruthy();
  });
});
