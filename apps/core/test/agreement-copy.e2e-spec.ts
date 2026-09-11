import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { COPY_DELIVERY_VERSION } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RendererRegistry } from '../src/render/renderer-registry';
import { DeterministicPdfRenderer } from '../src/render/pdf-renderer';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

/**
 * W6 — "SEND ME A COPY". REQ-PORT-02, the s 65C copy-on-request obligation
 * automated.
 *
 * WHAT THIS SUITE PINS, and each of them is a way the feature could look
 * finished and not be:
 *
 *  - The offer carries a MASKED contact and never the value, and the address
 *    it masks comes from the record the SIGNER's contact lives on — the
 *    patient's when the patient signed, the assignor's when somebody else did
 *    (ASSIGNOR-RULES rules 5–6).
 *  - A signer with no contact on file gets a reason code and no channel. There
 *    is no endpoint anywhere that accepts a typed address (D-2026-09-11-03).
 *  - The send, its correspondence twin and the vault event commit together
 *    (hard rule 11), and the event carries ids, channel TYPES and versions —
 *    never an address (hard rule 9, REQ-VER-04).
 *  - Nothing that happens here moves the agreement (hard rule 8).
 *  - The link serves the hash recorded at signing, from the one deterministic
 *    render path, and refuses when the two disagree (hard rule 13).
 *  - No message about the agreement carries a dollar amount (hard rule 4) or
 *    the words this platform may never use about its forms (hard rule 12).
 *  - A copy link is practice-scoped at the database and fails closed across a
 *    boundary.
 */

/** A benefit figure that appears in exactly one place, so a leak is findable. */
const BENEFIT_CENTS = 4275;

/** The practice administrator registering the tablet. Null = nobody signed in. */
const ADMIN = {
  sub: '00000000-0000-4000-8000-00000000dev1',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'robin.admin',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

describe('agreement copy — "send me a copy" (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let renderers: RendererRegistry;

  const practiceA = randomUUID();
  const practiceB = randomUUID();

  let patientA = '';
  let carerAssignorA = '';
  /** The anchoring affiliation at practice A (HARD-01 — every agreement has one). */
  let affiliationA = '';
  /** Signed by the patient themselves; the patient record holds a mobile and an email. */
  let selfSigned = '';
  /** Signed by a carer; the CARER's own contact is the one to use. */
  let carerSigned = '';
  /** Signed by a patient the practice holds no contact for at all. */
  let noContactSigned = '';
  /** Locked, with a hash that does not describe its own particulars. */
  let mismatched = '';
  /** At practice B. Nothing at practice A may reach it. */
  let otherPracticeSigned = '';

  let credentialA = '';
  let credentialB = '';

  const http = () => request(app.getHttpServer());

  const PATIENT_EMAIL = 'jamie.copy@example.invalid';
  const PATIENT_MOBILE = '0400 000 000';
  const CARER_EMAIL = 'alex.carer@example.invalid';
  const CARER_MOBILE = '0400 111 222';

  async function seedSignedAgreement(
    tx: Parameters<Parameters<PrismaService['withPractice']>[1]>[0],
    input: {
      practiceId: string;
      patientId: string;
      assignorId: string;
      assignorIsPatient: boolean;
      affiliationId: string;
      agreementDate: string;
      hash?: string;
    },
  ): Promise<string> {
    /*
     * `pdf-1`, NOT `current()`, for the reason the portal suite gives: this
     * fixture hand-builds an agreement out of bare particulars, which is what
     * an agreement locked before the wording became versioned content looks
     * like, and `pdf-1` is the renderer those are recorded under. Rule 13 is
     * still exercised for real — the registry resolves the version from the
     * agreement's own column and the hash still has to match.
     */
    const renderer = renderers.get(DeterministicPdfRenderer.VERSION)!;
    const particulars = {
      agreementType: 'episodic_post',
      agreementDate: input.agreementDate,
      serviceDate: input.agreementDate,
      basicServiceDescription: 'General practitioner attendance',
      mbsItemNumbers: ['23'],
      patientName: 'Jamie Copyton',
      providerName: 'Dr Example Provider',
    };
    const rendered = await renderer.render(particulars, ['en']);

    const agreement = await tx.agreement.create({
      data: {
        practiceId: input.practiceId,
        type: 'episodic_post',
        anchorKind: 'provider',
        affiliationId: input.affiliationId,
        patientId: input.patientId,
        assignorId: input.assignorId,
        assignorIsPatient: input.assignorIsPatient,
        status: 'draft',
        serviceDescription: 'General practitioner attendance',
        particulars,
        particularsLockedAt: new Date(`${input.agreementDate}T01:00:00Z`),
        ruleSetVersion: 'test-rules-1',
        mappingVersion: 'test-mapping-1',
        renderedLanguages: ['en'],
        renderedArtefactHash: input.hash ?? rendered.sha256,
        rendererVersion: rendered.rendererVersion,
      },
    });

    if (!input.hash) {
      const signature = await tx.signatureEvent.create({
        data: {
          practiceId: input.practiceId,
          agreementId: agreement.id,
          method: 'tap_to_approve',
          channel: 'in_practice',
          artefactHash: rendered.sha256,
          rendererVersion: rendered.rendererVersion,
        },
      });
      await tx.agreement.update({
        where: { id: agreement.id },
        data: { signatureEventId: signature.id, status: 'stored' },
      });
    }

    return agreement.id;
  }

  /**
   * Register and pair a tablet exactly as the practice does — through the
   * console route and the public exchange, never by writing the credential.
   */
  async function pairTablet(practiceId: string, label: string): Promise<string> {
    currentPrincipal = { ...ADMIN, practiceId };
    const registered = await http()
      .post('/devices')
      .set('x-practice-id', practiceId)
      .send({ label })
      .expect(201);
    currentPrincipal = null;
    const paired = await http().post('/devices/pair').send({ code: registered.body.code }).expect(201);
    return paired.body.credential as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // The same seam the device-pairing suite uses: middleware runs before the
    // guards and cannot be forged by a client.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    renderers = app.get(RendererRegistry);

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.practice.create({ data: { id: practiceA, name: 'Copy Test Practice', state: 'NSW' } });
      await tx.practiceLocation.create({
        data: { practiceId: practiceA, address: '2 Example Street, Sampletown NSW 2000' },
      });

      const patient = await tx.patient.create({
        data: {
          practiceId: practiceA,
          familyName: 'Copyton',
          givenNames: 'Jamie',
          dateOfBirth: new Date('1962-11-02'),
          address: '2 Example Street, Sampletown NSW 2000',
          mobile: PATIENT_MOBILE,
          email: PATIENT_EMAIL,
          patientRecordNumber: 'PRN-C001',
        },
      });
      patientA = patient.id;

      const silent = await tx.patient.create({
        data: {
          practiceId: practiceA,
          familyName: 'Nocontact',
          givenNames: 'Robin',
          dateOfBirth: new Date('1970-01-05'),
          patientRecordNumber: 'PRN-C002',
        },
      });

      const provider = await createServicingProvider(tx, practiceA, {
        name: 'Dr Example Provider',
        providerType: 'general_practitioner',
      });
      affiliationA = provider.id;

      const self = await tx.assignor.create({
        data: { practiceId: practiceA, name: 'Jamie Copyton', authorityBasis: 'self' },
      });
      const silentSelf = await tx.assignor.create({
        data: { practiceId: practiceA, name: 'Robin Nocontact', authorityBasis: 'self' },
      });
      const carer = await tx.assignor.create({
        data: {
          practiceId: practiceA,
          name: 'Alex Carer',
          authorityBasis: 'other_with_note',
          authorityNote: 'carer',
          relationshipToPatient: 'carer',
          contactEmail: CARER_EMAIL,
          contactMobile: CARER_MOBILE,
        },
      });
      carerAssignorA = carer.id;

      selfSigned = await seedSignedAgreement(tx, {
        practiceId: practiceA,
        patientId: patient.id,
        assignorId: self.id,
        assignorIsPatient: true,
        affiliationId: provider.id,
        agreementDate: '2026-09-01',
      });
      carerSigned = await seedSignedAgreement(tx, {
        practiceId: practiceA,
        patientId: patient.id,
        assignorId: carer.id,
        assignorIsPatient: false,
        affiliationId: provider.id,
        agreementDate: '2026-09-02',
      });
      noContactSigned = await seedSignedAgreement(tx, {
        practiceId: practiceA,
        patientId: silent.id,
        assignorId: silentSelf.id,
        assignorIsPatient: true,
        affiliationId: provider.id,
        agreementDate: '2026-09-03',
      });
      /*
       * A LOCKED AGREEMENT WHOSE RECORDED HASH IS WRONG FROM BIRTH. The 409
       * path cannot be reached by editing a signed one — HARD-02 refuses,
       * which is the rule working — so the tamper case is seeded rather than
       * simulated.
       */
      mismatched = await seedSignedAgreement(tx, {
        practiceId: practiceA,
        patientId: patient.id,
        assignorId: self.id,
        assignorIsPatient: true,
        affiliationId: provider.id,
        agreementDate: '2026-09-04',
        hash: 'f'.repeat(64),
      });
    });

    await prisma.withPractice(practiceB, async (tx) => {
      await tx.practice.create({ data: { id: practiceB, name: 'Other Copy Practice', state: 'NSW' } });
      const patient = await tx.patient.create({
        data: {
          practiceId: practiceB,
          familyName: 'Elsewhere',
          givenNames: 'Sam',
          dateOfBirth: new Date('1980-03-03'),
          mobile: '0400 999 999',
          patientRecordNumber: 'PRN-B001',
        },
      });
      const provider = await createServicingProvider(tx, practiceB, {
        name: 'Dr Other Provider',
        providerType: 'general_practitioner',
      });
      const self = await tx.assignor.create({
        data: { practiceId: practiceB, name: 'Sam Elsewhere', authorityBasis: 'self' },
      });
      otherPracticeSigned = await seedSignedAgreement(tx, {
        practiceId: practiceB,
        patientId: patient.id,
        assignorId: self.id,
        assignorIsPatient: true,
        affiliationId: provider.id,
        agreementDate: '2026-09-05',
      });
    });

    credentialA = await pairTablet(practiceA, 'Copy Test Tablet A');
    credentialB = await pairTablet(practiceB, 'Copy Test Tablet B');
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.agreementCopyLink.deleteMany({});
        await tx.correspondence.deleteMany({});
        await tx.outboundItem.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.patient.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.device.deleteMany({});
        await tx.practiceLocation.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  /* ---------------------------------------------------------------------
   * The offer
   * ------------------------------------------------------------------ */

  describe('the offer', () => {
    it('a_copy_offer_carries_a_masked_contact_and_never_the_value', async () => {
      const res = await http()
        .get(`/kiosk/agreements/${selfSigned}/copy-offer`)
        .set('x-device-credential', credentialA)
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(PATIENT_EMAIL);
      expect(body).not.toContain('0400000000');
      expect(body).not.toContain('0400 000 000');
      expect(res.body.channels.map((c: { channel: string }) => c.channel).sort()).toEqual(['email', 'sms']);
      for (const channel of res.body.channels) expect(channel.masked).toContain('•');
      // The version of the option list travels with the offer (hard rule 14).
      expect(res.body.version).toBe(COPY_DELIVERY_VERSION);
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('the_copy_offer_uses_the_signers_own_contact_not_the_patients', async () => {
      const res = await http()
        .get(`/kiosk/agreements/${carerSigned}/copy-offer`)
        .set('x-device-credential', credentialA)
        .expect(200);

      // The carer's mobile ends 222, the patient's ends 000. The mask is the
      // only place the difference shows, and it has to show the carer's.
      const sms = res.body.channels.find((c: { channel: string }) => c.channel === 'sms');
      expect(sms.masked).toContain('222');
      expect(sms.masked).not.toContain('000');
    });

    it('a_missing_contact_sends_the_patient_to_reception_not_to_a_text_box', async () => {
      // D-2026-09-11-03. The answer is a reason code the tablet maps to copy
      // and a destination; there is no endpoint that takes a typed address.
      const res = await http()
        .get(`/kiosk/agreements/${noContactSigned}/copy-offer`)
        .set('x-device-credential', credentialA)
        .expect(200);
      expect(res.body.channels).toEqual([]);
      expect(res.body.unavailable).toBe('no_contact_on_file');
    });

    it('offers nothing for an agreement nobody has signed', async () => {
      const draft = await prisma.withPractice(practiceA, async (tx) =>
        tx.agreement.create({
          data: {
            practiceId: practiceA,
            type: 'episodic_pre',
            anchorKind: 'provider',
            affiliationId: affiliationA,
            patientId: patientA,
            assignorId: carerAssignorA,
            assignorIsPatient: false,
            status: 'draft',
            particulars: {},
          },
        }),
      );
      await http()
        .get(`/kiosk/agreements/${draft.id}/copy-offer`)
        .set('x-device-credential', credentialA)
        .expect(404);
      await prisma.withPractice(practiceA, (tx) => tx.agreement.delete({ where: { id: draft.id } }));
    });

    it('fails closed across a practice boundary', async () => {
      await http()
        .get(`/kiosk/agreements/${otherPracticeSigned}/copy-offer`)
        .set('x-device-credential', credentialA)
        .expect(404);
    });
  });

  /* ---------------------------------------------------------------------
   * The send
   * ------------------------------------------------------------------ */

  describe('the send', () => {
    it('copy_send_writes_its_vault_event_in_the_same_transaction', async () => {
      const before = await prisma.vaultOutbox.count();

      const res = await http()
        .post(`/kiosk/agreements/${selfSigned}/copy`)
        .set('x-device-credential', credentialA)
        .send({ optionKey: 'email' })
        .expect(201);
      expect(res.body).toEqual({ channel: 'email', queued: true });

      const link = await prisma.withPractice(practiceA, (tx) =>
        tx.agreementCopyLink.findFirst({ where: { agreementId: selfSigned, channel: 'email' } }),
      );
      expect(link).not.toBeNull();
      expect(link!.optionsVersion).toBe(COPY_DELIVERY_VERSION);
      expect(link!.outboundItemId).not.toBeNull();

      // The queued message and its correspondence twin, from the same commit.
      const queued = await prisma.withPractice(practiceA, (tx) =>
        tx.outboundItem.findFirst({ where: { id: link!.outboundItemId! } }),
      );
      expect(queued!.channel).toBe('email');
      expect(queued!.destination).toBe(PATIENT_EMAIL);
      const twin = await prisma.withPractice(practiceA, (tx) =>
        tx.correspondence.findFirst({ where: { outboundItemId: link!.outboundItemId! } }),
      );
      expect(twin!.state).toBe('queued');

      // And the event, through the outbox, in the same transaction.
      const after = await prisma.vaultOutbox.count();
      expect(after).toBeGreaterThan(before);
      const event = await prisma.vaultOutbox.findFirst({
        where: { type: 'agreement.copy_requested', subjectId: selfSigned },
        orderBy: { occurredAt: 'desc' },
      });
      expect(event).not.toBeNull();
    });

    it('copy_events_carry_channel_types_and_ids_never_an_address', async () => {
      const event = await prisma.vaultOutbox.findFirst({
        where: { type: 'agreement.copy_requested', subjectId: selfSigned },
        orderBy: { occurredAt: 'desc' },
      });
      const serialised = JSON.stringify(event);
      // Hard rule 9 / REQ-VER-04 — types and outcomes, never values. Not even
      // a masked one: a mask is still derived from the value.
      expect(serialised).not.toContain(PATIENT_EMAIL);
      expect(serialised).not.toContain('0400');
      expect(serialised).not.toContain('Jamie');
      expect(serialised).not.toContain('•');

      const payload = (event!.payload ?? {}) as Record<string, unknown>;
      expect(payload.channel).toBe('email');
      expect(payload.recipientType).toBe('patient');
      expect(payload.optionsVersion).toBe(COPY_DELIVERY_VERSION);
    });

    it('no_dollar_amount_on_any_copy_message', async () => {
      const link = await prisma.withPractice(practiceA, (tx) =>
        tx.agreementCopyLink.findFirst({ where: { agreementId: selfSigned, channel: 'email' } }),
      );
      const queued = await prisma.withPractice(practiceA, (tx) =>
        tx.outboundItem.findFirst({ where: { id: link!.outboundItemId! } }),
      );
      const body = JSON.stringify(queued!.payload);
      // Hard rule 4. The figure exists nowhere in this suite but the constant,
      // so a leak is findable rather than merely improbable.
      expect(body).not.toContain(String(BENEFIT_CENTS));
      expect(body).not.toMatch(/\$|\bAUD\b|\bdollars?\b|\brebate\b/i);
    });

    it('a_copy_message_never_claims_certification_or_approval', async () => {
      const link = await prisma.withPractice(practiceA, (tx) =>
        tx.agreementCopyLink.findFirst({ where: { agreementId: selfSigned, channel: 'email' } }),
      );
      const queued = await prisma.withPractice(practiceA, (tx) =>
        tx.outboundItem.findFirst({ where: { id: link!.outboundItemId! } }),
      );
      // Hard rule 12, REQ-65C-05. The email's own footer and layout are in
      // scope here, not only the template the domain test walks.
      expect(JSON.stringify(queued!.payload)).not.toMatch(
        /\b(certified|approved|accredited|government-approved)\b/i,
      );
    });

    it('sends to the carer when the carer signed, and records which record it read', async () => {
      await http()
        .post(`/kiosk/agreements/${carerSigned}/copy`)
        .set('x-device-credential', credentialA)
        .send({ optionKey: 'sms' })
        .expect(201);

      const link = await prisma.withPractice(practiceA, (tx) =>
        tx.agreementCopyLink.findFirst({ where: { agreementId: carerSigned } }),
      );
      expect(link!.recipientType).toBe('assignor');
      expect(link!.recipientId).toBe(carerAssignorA);
      const queued = await prisma.withPractice(practiceA, (tx) =>
        tx.outboundItem.findFirst({ where: { id: link!.outboundItemId! } }),
      );
      expect(queued!.destination).toBe(CARER_MOBILE);
      expect(queued!.destination).not.toBe(PATIENT_MOBILE);
    });

    it('a_declined_or_impossible_copy_never_blocks_anything', async () => {
      const before = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: noContactSigned } }),
      );

      // "Not now" sends nothing, and so does a channel with no address behind
      // it. Both are refused with the reason code, and NEITHER moves the
      // agreement (hard rule 8, REQ-REC-04).
      await http()
        .post(`/kiosk/agreements/${selfSigned}/copy`)
        .set('x-device-credential', credentialA)
        .send({ optionKey: 'not_now' })
        .expect(400);
      await http()
        .post(`/kiosk/agreements/${noContactSigned}/copy`)
        .set('x-device-credential', credentialA)
        .send({ optionKey: 'email' })
        .expect(400);

      const after = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: noContactSigned } }),
      );
      expect(after!.status).toBe(before!.status);
      expect(after!.signatureEventId).toBe(before!.signatureEventId);
      expect(after!.renderedArtefactHash).toBe(before!.renderedArtefactHash);
      const links = await prisma.withPractice(practiceA, (tx) =>
        tx.agreementCopyLink.count({ where: { agreementId: noContactSigned } }),
      );
      expect(links).toBe(0);
    });

    it('there_is_no_endpoint_that_accepts_a_typed_address', async () => {
      // D-2026-09-11-03 at the wire. `whitelist: true` strips anything the DTO
      // does not declare, so an address sent alongside the option key never
      // reaches the service — and the send still goes to the record's address.
      await http()
        .post(`/kiosk/agreements/${selfSigned}/copy`)
        .set('x-device-credential', credentialA)
        .send({ optionKey: 'sms', destination: 'attacker@example.invalid', mobile: '0499 999 999' })
        .expect(201);

      const link = await prisma.withPractice(practiceA, (tx) =>
        tx.agreementCopyLink.findFirst({ where: { agreementId: selfSigned, channel: 'sms' } }),
      );
      const queued = await prisma.withPractice(practiceA, (tx) =>
        tx.outboundItem.findFirst({ where: { id: link!.outboundItemId! } }),
      );
      expect(queued!.destination).toBe(PATIENT_MOBILE);
    });

    it('a tablet cannot ask for a copy of another practice agreement', async () => {
      await http()
        .post(`/kiosk/agreements/${otherPracticeSigned}/copy`)
        .set('x-device-credential', credentialA)
        .send({ optionKey: 'sms' })
        .expect(404);
      // And practice B's own tablet still can.
      await http()
        .post(`/kiosk/agreements/${otherPracticeSigned}/copy`)
        .set('x-device-credential', credentialB)
        .send({ optionKey: 'sms' })
        .expect(201);
    });

    it('answers 401 to an unpaired caller, with no body', async () => {
      const res = await http()
        .post(`/kiosk/agreements/${selfSigned}/copy`)
        .send({ optionKey: 'email' })
        .expect(401);
      expect(JSON.stringify(res.body)).not.toContain(PATIENT_EMAIL);
    });
  });

  /* ---------------------------------------------------------------------
   * The copy itself
   * ------------------------------------------------------------------ */

  describe('the link', () => {
    /** Mint a link the way the send does, and hand back the raw token. */
    async function mintCopyLink(agreementId: string, practiceId: string): Promise<string> {
      const { mintAgreementCopyToken } = await import('../src/agreement-copy/copy-token');
      const { token, tokenHash } = mintAgreementCopyToken(practiceId);
      await prisma.withPractice(practiceId, (tx) =>
        tx.agreementCopyLink.create({
          data: {
            practiceId,
            agreementId,
            tokenHash,
            channel: 'email',
            optionKey: 'email',
            optionsVersion: COPY_DELIVERY_VERSION,
            recipientType: 'patient',
            recipientId: patientA,
            expiresAt: new Date(Date.now() + 3600_000),
          },
        }),
      );
      return token;
    }

    it('the_copy_link_serves_the_hash_recorded_at_signing', async () => {
      const token = await mintCopyLink(selfSigned, practiceA);
      const res = await http().get(`/agreement-copy/${token}`).expect(200);

      const stored = await prisma.withPractice(practiceA, (tx) =>
        tx.agreement.findFirst({ where: { id: selfSigned } }),
      );
      // Hard rule 13: the bytes served are the ones whose hash the record
      // holds, re-rendered under the version recorded on the agreement.
      expect(res.headers['x-artefact-sha256']).toBe(stored!.renderedArtefactHash);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('two_opens_of_one_copy_link_are_byte_identical', async () => {
      const token = await mintCopyLink(selfSigned, practiceA);
      const first = await http().get(`/agreement-copy/${token}`).expect(200);
      const second = await http().get(`/agreement-copy/${token}`).expect(200);
      // One deterministic render path. Two renders, the same bytes — which is
      // also why the link may be opened twice without burning.
      expect(Buffer.from(second.body).equals(Buffer.from(first.body))).toBe(true);
      expect(second.headers['x-artefact-sha256']).toBe(first.headers['x-artefact-sha256']);
    });

    it('records every open as evidence, with the hash it served and no address', async () => {
      const token = await mintCopyLink(selfSigned, practiceA);
      await http().get(`/agreement-copy/${token}`).expect(200);

      const event = await prisma.vaultOutbox.findFirst({
        where: { type: 'artefact.accessed', subjectId: selfSigned },
        orderBy: { occurredAt: 'desc' },
      });
      const payload = (event!.payload ?? {}) as Record<string, unknown>;
      expect(payload.action).toBe('copy_link_download');
      expect(JSON.stringify(event)).not.toContain(PATIENT_EMAIL);

      const link = await prisma.withPractice(practiceA, (tx) =>
        tx.agreementCopyLink.findFirst({ where: { tokenHash: { not: '' } }, orderBy: { createdAt: 'desc' } }),
      );
      expect(link!.openCount).toBeGreaterThan(0);
      expect(link!.firstOpenedAt).not.toBeNull();
    });

    it('refuses to serve a copy whose hash has moved', async () => {
      const token = await mintCopyLink(mismatched, practiceA);
      // 409, not 500 and not silently serving: the conflict is between the
      // record and the artefact, and no retry fixes it.
      await http().get(`/agreement-copy/${token}`).expect(409);
    });

    it('answers the same 404 to an expired link as to one that never existed', async () => {
      const token = await mintCopyLink(selfSigned, practiceA);
      const parsedHash = token.slice(token.indexOf('.') + 1);
      const { hashCopySecret } = await import('../src/agreement-copy/copy-token');
      await prisma.withPractice(practiceA, (tx) =>
        tx.agreementCopyLink.updateMany({
          where: { tokenHash: hashCopySecret(parsedHash) },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );
      const expired = await http().get(`/agreement-copy/${token}`).expect(404);
      const unknown = await http()
        .get(`/agreement-copy/${Buffer.from(practiceA).toString('base64url')}.${'z'.repeat(43)}`)
        .expect(404);
      // Distinguishing them tells whoever holds a stale URL that it was once
      // real, which is the first half of guessing the rest.
      expect(expired.body.message).toBe(unknown.body.message);
    });

    it('answers 404 to a token that is not one of ours', async () => {
      await http().get('/agreement-copy/not-a-token').expect(404);
    });
  });
});
