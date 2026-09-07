import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { genericAgreementTemplate } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { extractText } from '../src/artefacts/extract-text';
import { RendererRegistry, renderInputOf } from '../src/render/renderer-registry';

/**
 * THE FULL AGREEMENT — letterhead, the whole s 65C data set, the words the
 * assignor ticks, and per-practice wording with a platform review in front of
 * it (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1).
 *
 * WHAT THIS SUITE PINS, and each of them is a named rule:
 *  - the rendered PDF carries the letterhead and every D-element, not a
 *    patient's name and a list of keys;
 *  - a signature is refused unless every statement was ticked;
 *  - a practice cannot activate its own legal wording;
 *  - a proposed variant that drops a data element is refused at the moment it
 *    is typed, not at a tablet;
 *  - and every agreement records which template version produced it.
 */

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

/** A real PNG. See `renderer.spec.ts` — pdfkit decodes it properly. */
function greyPng(size: number, shade: number): Buffer {
  const raw = Buffer.alloc(size * (size + 1), shade);
  for (let row = 0; row < size; row += 1) raw[row * (size + 1)] = 0;
  const crc32 = (bytes: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const EPISODIC_AFFIRMATIONS = genericAgreementTemplate('episodic').statements.map((s) => s.key);

/** A platform reviewer, and a practice administrator who is not one. */
const REVIEWER = {
  sub: '00000000-0000-4000-8000-00000000rev1'.replace(/[^0-9a-f-]/g, '0'),
  principalType: 'platform',
  roles: ['platform_admin'],
  preferredUsername: 'sam.reviewer',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

describe('the full agreement: letterhead, words and per-practice wording (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  let providerId: string;
  let patientId: string;
  let assignorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    /*
     * WHO IS ASKING, faked at the edge exactly as the service-description
     * suite does it. `AUTH_ENFORCE` is off in development, so the guard does
     * not build a principal — and the one rule this suite is really about
     * ("a practice cannot activate its own wording") is invisible without one.
     */
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({
        data: {
          id: practiceId,
          name: 'Testville Family Medical',
          legalName: 'Testville Family Medical Pty Ltd',
          tradingNames: ['Testville Family Medical'],
          // Deliberately invalid checksum — fixtures never carry a real ABN.
          abn: '12345678901',
          businessPhone: '(02) 5550 0000',
          businessEmail: 'reception@testville.example',
          headOfficeLine1: '1 Test Street',
          headOfficeSuburb: 'Testville',
          headOfficeState: 'NSW',
          headOfficePostcode: '2000',
          pms: 'other',
        },
      });
      const provider = await tx.provider.create({
        data: {
          practiceId,
          name: 'Dr Sam Example',
          providerType: 'general_practitioner',
          placeOfPracticeAddress: '1 Test Street, Testville NSW 2000',
        },
      });
      providerId = provider.id;
      const patient = await tx.patient.create({
        data: { practiceId, givenNames: 'Alex', familyName: 'Testpatient', dateOfBirth: new Date('1990-02-03') },
      });
      patientId = patient.id;
      const assignor = await tx.assignor.create({
        data: { practiceId, name: 'Alex Testpatient', authorityBasis: 'self' },
      });
      assignorId = assignor.id;
    });
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      // NOT the signature events: a database trigger refuses to delete them,
      // which is the append-only rule working (REQ-SIG-02, hard rule 11).
      // They are scoped to a throwaway practice and have no foreign key back
      // to the rows below, so leaving them behind costs nothing.
      await tx.agreement.deleteMany({});
      await tx.practiceAgreementTemplate.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.vaultOutbox.deleteMany({});
    });
    await prisma.practice.deleteMany({ where: { id: practiceId } });
    await app.close();
  });

  beforeEach(() => {
    currentPrincipal = null;
  });

  async function draftAndLock() {
    const created = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    const agreementId = created.body.id as string;
    const locked = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: '2026-09-01', basicServiceDescription: 'General practitioner attendance' })
      .expect(201);
    return { agreementId, locked };
  }

  it('render_carries_the_full_data_set_and_letterhead — end to end, through the lock', async () => {
    const { agreementId, locked } = await draftAndLock();
    expect(locked.body.renderedArtefactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(locked.body.templateVersion).toBe('episodic-generic-1');
    expect(locked.body.letterheadHash).toMatch(/^[0-9a-f]{64}$/);

    const agreement = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    const rendered = await app
      .get(RendererRegistry)
      .get(agreement!.rendererVersion)!
      .render(renderInputOf(agreement!), agreement!.renderedLanguages);
    expect(rendered.sha256).toBe(agreement!.renderedArtefactHash);

    const page = (extractText(new Uint8Array(rendered.bytes), 'application/pdf') ?? '').replace(/\s+/g, ' ');
    expect(page).toContain('Testville Family Medical Pty Ltd');
    expect(page).toContain('1 Test Street, Testville NSW 2000');
    expect(page).toContain('(02) 5550 0000');
    expect(page).toContain('ABN 12 345 678 901');
    expect(page).toContain('Alex Testpatient');
    expect(page).toContain('Dr Sam Example');
    expect(page).toContain('General practitioner attendance');
    expect(page).toContain('The patient is signing this agreement');
    expect(page).toContain('I assign my right to the Medicare benefit');
    // Hard rules 3, 4 and 12, on the page a patient actually reads.
    expect(page).not.toMatch(/\$|practitioner signature|approved|certified|accredited/i);
  });

  it('agreement_records_the_template_version_used', async () => {
    const { agreementId } = await draftAndLock();
    const agreement = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(agreement!.templateId).toBe('episodic-generic');
    expect(agreement!.templateVersion).toBe('episodic-generic-1');
    expect(agreement!.ruleSetVersion).toBe('test-rules-1');
    expect(agreement!.mappingVersion).toBe('test-mapping-1');
    expect(agreement!.letterheadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature_requires_every_statement_affirmed', async () => {
    const { agreementId } = await draftAndLock();
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/transition`)
      .set('x-practice-id', practiceId)
      .send({ to: 'awaiting_signature' })
      .expect(201);

    // Nothing ticked at all.
    const noTicks = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'tap_to_approve', channel: 'in_practice' })
      .expect(400);
    expect(String(noTicks.body.message)).toMatch(/not agreed to every statement/);

    // One of the two ticked is still not a signature to the document.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'tap_to_approve', channel: 'in_practice', affirmations: [EPISODIC_AFFIRMATIONS[0]] })
      .expect(400);

    // Both, and it goes through — with the KEYS on the signature event.
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'tap_to_approve', channel: 'in_practice', affirmations: EPISODIC_AFFIRMATIONS })
      .expect(201);

    const [event] = await prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findMany({ where: { agreementId } }),
    );
    expect(event.affirmations).toEqual(EPISODIC_AFFIRMATIONS);
    expect(event.templateVersion).toBe('episodic-generic-1');
  });

  it('logo_is_embedded_and_moves_the_hash — and clearing it never deletes the artefact', async () => {
    const before = await draftAndLock();

    const logo = greyPng(64, 0x30);
    const set = await request(app.getHttpServer())
      .post('/practices/letterhead/logo')
      .set('x-practice-id', practiceId)
      .send({ contentBase64: logo.toString('base64'), filename: 'logo.png' })
      .expect(201);
    expect(set.body.contentType).toBe('image/png');
    expect(set.body.widthPx).toBe(64);

    const after = await draftAndLock();
    expect(after.locked.body.letterheadHash).not.toBe(before.locked.body.letterheadHash);
    expect(after.locked.body.renderedArtefactHash).not.toBe(before.locked.body.renderedArtefactHash);

    await request(app.getHttpServer())
      .delete('/practices/letterhead/logo')
      .set('x-practice-id', practiceId)
      .expect(200);

    // The artefact is still there — the agreement above embeds those bytes and
    // has to keep re-verifying (hard rules 11 and 13).
    const artefacts = await prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findMany({ where: { purpose: 'practice_logo' } }),
    );
    expect(artefacts).toHaveLength(1);
    expect(artefacts[0].deletedAt).toBeNull();

    const agreement = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: after.agreementId } }),
    );
    const rendered = await app
      .get(RendererRegistry)
      .get(agreement!.rendererVersion)!
      .render(renderInputOf(agreement!), agreement!.renderedLanguages);
    expect(rendered.sha256).toBe(agreement!.renderedArtefactHash);
  });

  it('logo_upload_refuses_svg_and_oversize', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const refused = await request(app.getHttpServer())
      .post('/practices/letterhead/logo')
      .set('x-practice-id', practiceId)
      .send({ contentBase64: svg.toString('base64') })
      .expect(400);
    expect(String(refused.body.message)).toMatch(/PNG or a JPEG/);
  });

  describe('per-practice wording', () => {
    function variantBody(overrides: Record<string, unknown> = {}) {
      const generic = genericAgreementTemplate('episodic');
      return {
        title: 'Testville bulk-billing agreement',
        sections: generic.sections,
        statements: generic.statements,
        footer: generic.footer,
        ...overrides,
      };
    }

    it('practice_template_must_carry_every_data_element', async () => {
      const generic = genericAgreementTemplate('episodic');
      const refused = await request(app.getHttpServer())
        .post('/agreement-templates')
        .set('x-practice-id', practiceId)
        .send({
          agreementType: 'episodic',
          version: 'testville-episodic-9',
          body: variantBody({
            sections: generic.sections.filter((s) => s.key !== 'service'),
          }),
        })
        .expect(400);
      expect(String(refused.body.message)).toMatch(/never renders \{\{serviceDate\}\}/);
    });

    it('refuses wording carrying an amount, a practitioner signature or an approval claim', async () => {
      for (const [line, expected] of [
        ['The Medicare benefit is $41.20.', /hard rule 4/],
        ['Practitioner signature: ______', /hard rule 3/],
        ['This is a government-approved form.', /hard rule 12/],
      ] as const) {
        const refused = await request(app.getHttpServer())
          .post('/agreement-templates')
          .set('x-practice-id', practiceId)
          .send({
            agreementType: 'episodic',
            version: 'testville-episodic-8',
            body: variantBody({ footer: [...genericAgreementTemplate('episodic').footer, line] }),
          })
          .expect(400);
        expect(String(refused.body.message)).toMatch(expected);
      }
    });

    it('practice_template_cannot_activate_itself', async () => {
      const proposed = await request(app.getHttpServer())
        .post('/agreement-templates')
        .set('x-practice-id', practiceId)
        .send({ agreementType: 'episodic', version: 'testville-episodic-1', body: variantBody() })
        .expect(201);
      const id = proposed.body.id as string;

      await request(app.getHttpServer())
        .post(`/agreement-templates/${id}/submit`)
        .set('x-practice-id', practiceId)
        .expect(201);

      /*
       * TWO LAYERS, AND BOTH ARE TESTED, because either alone would be a
       * single point of failure on the one act this module exists to fence.
       *
       * FIRST: a practice administrator's own token. `@RequireRoles` answers
       * before the service is reached, which is the right order — the request
       * never gets far enough to name a template.
       */
      currentPrincipal = {
        sub: randomUUID(),
        principalType: 'practice',
        roles: [],
        preferredUsername: 'mai.frontdesk',
        practiceId,
        raw: {},
      };
      const byRole = await request(app.getHttpServer())
        .post(`/platform/agreement-templates/${practiceId}/${id}/activate`)
        .set('x-practice-id', practiceId)
        .send({})
        .expect(403);
      expect(String(byRole.body.message)).toMatch(/platform_admin/);

      /*
       * SECOND, AND THE ONE THAT MATTERS: a PLATFORM operator who is ACTING AS
       * this practice. They hold `platform_admin`, so the role guard lets them
       * through — and they are, at that moment, performing the practice's own
       * acts. Activating the practice's wording from inside its own session is
       * the practice activating it, and the service says so.
       */
      currentPrincipal = { ...REVIEWER, practiceId };
      const refused = await request(app.getHttpServer())
        .post(`/platform/agreement-templates/${practiceId}/${id}/activate`)
        .set('x-practice-id', practiceId)
        .send({})
        .expect(403);
      expect(String(refused.body.message)).toMatch(/cannot activate its own/i);

      // Still not active, and the generic wording is still what a lock uses.
      const stillDraft = await prisma.withPractice(practiceId, (tx) =>
        tx.practiceAgreementTemplate.findFirst({ where: { id } }),
      );
      expect(stillDraft!.status).toBe('in_review');
      expect(stillDraft!.activatedAt).toBeNull();
    });

    it('a platform reviewer activates it, and the next agreement records the practice version', async () => {
      const existing = await prisma.withPractice(practiceId, (tx) =>
        tx.practiceAgreementTemplate.findFirst({ where: { version: 'testville-episodic-1' } }),
      );
      currentPrincipal = REVIEWER;
      await request(app.getHttpServer())
        .post(`/platform/agreement-templates/${practiceId}/${existing!.id}/activate`)
        .send({ reviewNotes: 'Read against the s 65C data set. Fine.' })
        .expect(201);
      currentPrincipal = null;

      const { agreementId } = await draftAndLock();
      const agreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: agreementId } }),
      );
      expect(agreement!.templateVersion).toBe('testville-episodic-1');

      const rendered = await app
        .get(RendererRegistry)
        .get(agreement!.rendererVersion)!
        .render(renderInputOf(agreement!), agreement!.renderedLanguages);
      const page = (extractText(new Uint8Array(rendered.bytes), 'application/pdf') ?? '').replace(/\s+/g, ' ');
      expect(page).toContain('Testville bulk-billing agreement');

      // And retiring it falls back to the generic — never to nothing (rule 8).
      await request(app.getHttpServer())
        .post(`/agreement-templates/${existing!.id}/retire`)
        .set('x-practice-id', practiceId)
        .expect(201);
      const next = await draftAndLock();
      const nextAgreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: next.agreementId } }),
      );
      expect(nextAgreement!.templateVersion).toBe('episodic-generic-1');
    });
  });
});
