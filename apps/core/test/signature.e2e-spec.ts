import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ArtefactsService } from '../src/artefacts/artefacts.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

/**
 * A 1×1 PNG. Obviously not a signature — it is here to be a real PNG header,
 * because the server admits the raster by SIGNATURE and not by what it claims.
 */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * TWO STROKES, FIVE POINTS, WITH THEIR TIMING (REQ-SIG-01). The gap between
 * the strokes is data, and so is the pause in the middle of the second one —
 * both survive to the stored vector because nothing on this path smooths or
 * resamples. No biometric template is derived from any of it.
 */
function drawnSignature() {
  return {
    vector: [
      { points: [{ x: 10, y: 40, t: 0 }, { x: 60, y: 80, t: 22, p: 0.35 }] },
      {
        points: [
          { x: 120, y: 40, t: 410 },
          { x: 160, y: 90, t: 433 },
          { x: 210, y: 45, t: 902 },
        ],
      },
    ],
    rasterPngBase64: TINY_PNG,
    padWidth: 600,
    padHeight: 200,
  };
}

const PARTICULARS = {
  patientName: 'Alex Testpatient',
  agreementDate: '2026-09-01',
  agreementType: 'episodic_pre',
  serviceDate: '2026-09-01',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
};

describe('signature capture — the full journey (e2e, real Postgres)', () => {
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
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Signature Test Practice' } });
      providerId = (
        await tx.provider.create({ data: { practiceId, name: 'Dr GP Test', providerType: 'general_practitioner' } })
      ).id;
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Testpatient',
            givenNames: 'Alex',
            dateOfBirth: new Date('1957-03-14'),
            address: '1 Example Street, Sampletown NSW 2000',
          },
        })
      ).id;
      assignorId = (
        await tx.assignor.create({ data: { practiceId, name: 'Alex Testpatient', authorityBasis: 'self' } })
      ).id;
    });
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.captureRequest.deleteMany({});
      await tx.verificationChallenge.deleteMany({});
      /*
       * THE SIGNATURE ARTEFACTS ARE DELIBERATELY NOT CLEANED UP. `artefacts`
       * is append-only and the database says so — a DELETE raises "Artefacts
       * are not deleted. Tombstone the row." Evidence outliving its subject is
       * the design (rule 11), and a test that could delete it would be a test
       * proving the opposite of what the table promises.
       */
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  it('walks draft → remote verify → lock → sign → stored with full evidence binding', async () => {
    // Draft
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    const agreementId = draft.body.id;

    // Remote capture + verification
    const opened = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(201);
    await request(app.getHttpServer()).get(`/capture/link/${opened.body.token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/capture/link/${opened.body.token}/verify`)
      .send({
        stated: {
          name: 'Testpatient Alex',
          date_of_birth: '1957-03-14',
          address: '1 Example Street, Sampletown NSW 2000',
        },
      })
      .expect(201);

    // Lock → renders and hashes the artefact before signature can enable
    const locked = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: PARTICULARS.serviceDate, basicServiceDescription: PARTICULARS.basicServiceDescription })
      .expect(201);
    expect(locked.body.renderedArtefactHash).toMatch(/^[0-9a-f]{64}$/);

    // Sign
    const signed = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({
        method: 'tap_to_approve',
        channel: 'sms_link',
        captureRequestId: opened.body.captureRequestId,
        deviceFingerprint: 'test-device-1',
      })
      .expect(201);
    expect(signed.body.status).toBe('stored');
    expect(signed.body.signatureEventId).toBeDefined();

    // Signature event binds artefact hash + versions + verification event (REQ-SIG-02)
    const signatureEvents = await prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findMany({ where: { agreementId } }),
    );
    expect(signatureEvents).toHaveLength(1);
    const sig = signatureEvents[0];
    expect(sig.artefactHash).toBe(locked.body.renderedArtefactHash);
    expect(sig.ruleSetVersion).toBe('test-rules-1');
    expect(sig.mappingVersion).toBe('test-mapping-1');
    expect(sig.verificationEventId).toBeTruthy();
    expect(sig.deviceFingerprint).toBe('test-device-1');
    expect(sig.ipAddress).toBeTruthy();

    // Capture request completed
    const captureRows = await prisma.withPractice(practiceId, (tx) =>
      tx.captureRequest.findMany({ where: { agreementId } }),
    );
    expect(captureRows[0].status).toBe('completed');

    // Full evidence trail in the outbox
    const outbox = await prisma.vaultOutbox.findMany({ where: { subjectId: agreementId } });
    expect(outbox.map((r) => r.type)).toEqual(
      expect.arrayContaining([
        'agreement.created',
        'agreement.particulars_locked',
        'agreement.rendered',
        'agreement.signed',
        'agreement.validated',
        'agreement.stored',
      ]),
    );
  });

  // Renderer determinism is covered per-renderer in src/render/renderer.spec.ts.

  it('signing_requires_awaiting_signature_state — a draft cannot be signed', async () => {
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/agreements/${draft.body.id}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'drawn', channel: 'in_practice' })
      .expect(400);
  });

  /**
   * A fresh agreement, verified, locked and waiting for a signature — the
   * state a tablet actually meets (REQ-REG-06: a draft never reaches a
   * device).
   */
  async function stageAwaitingSignature(): Promise<{ agreementId: string; captureRequestId: string }> {
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    const agreementId = draft.body.id;

    /*
     * VERIFIED THROUGH THE LINK, SIGNED AS IF AT THE PRACTICE. The link is
     * simply the only channel with a server-side verification hop a test can
     * drive end to end; the signature that follows carries `in_practice`,
     * which is the kiosk's channel and the path under test.
     */
    const opened = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(201);
    await request(app.getHttpServer()).get(`/capture/link/${opened.body.token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/capture/link/${opened.body.token}/verify`)
      .send({
        stated: {
          name: 'Testpatient Alex',
          date_of_birth: '1957-03-14',
          address: '1 Example Street, Sampletown NSW 2000',
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: PARTICULARS.serviceDate, basicServiceDescription: PARTICULARS.basicServiceDescription })
      .expect(201);

    return { agreementId, captureRequestId: opened.body.captureRequestId };
  }

  it('drawn_signature_requires_strokes — a drawn signature with no payload is refused', async () => {
    const { agreementId, captureRequestId } = await stageAwaitingSignature();

    // Everything else about this request is correct: the particulars are
    // locked, the render is verified, the capture request is open. The only
    // thing missing is the mark — and without it "drawn" is a tap-to-approve
    // filed under the wrong method (REQ-SIG-01/-02).
    const refused = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'drawn', channel: 'in_practice', captureRequestId })
      .expect(400);
    expect(JSON.stringify(refused.body)).toMatch(/strokes and the image/i);

    // And the agreement is untouched — a refusal is not a partial signature.
    const after = await request(app.getHttpServer())
      .get(`/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(after.body.status).toBe('awaiting_signature');
    expect(after.body.signatureEventId).toBeNull();
  });

  it('tap-to-approve may not carry a drawing, because a tap draws nothing', async () => {
    const { agreementId, captureRequestId } = await stageAwaitingSignature();
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'tap_to_approve', channel: 'in_practice', captureRequestId, signature: drawnSignature() })
      .expect(400);
  });

  it('signature_artefacts_hashed_and_bound_in_same_transaction', async () => {
    const { agreementId, captureRequestId } = await stageAwaitingSignature();

    const signed = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'drawn', channel: 'in_practice', captureRequestId, signature: drawnSignature() })
      .expect(201);
    expect(signed.body.status).toBe('stored');

    const [sig] = await prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findMany({ where: { agreementId } }),
    );

    // BOTH HALVES, BOUND ALONGSIDE THE RENDERED AGREEMENT'S OWN HASH
    // (REQ-SIG-02). Three hashes on one event: what was agreed, and the two
    // representations of the mark that agreed to it.
    expect(sig.artefactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.signatureRasterSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.signatureVectorSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.signatureRasterSha256).not.toBe(sig.signatureVectorSha256);
    expect(sig.padWidth).toBe(600);
    expect(sig.padHeight).toBe(200);
    expect(sig.strokeCount).toBe(2);
    expect(sig.pointCount).toBe(5);

    // The artefacts really exist, are subject-typed to this agreement, and
    // hash to exactly what the signature event bound.
    const artefacts = await prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findMany({ where: { subjectType: 'Agreement', subjectId: agreementId } }),
    );
    const raster = artefacts.find((a) => a.purpose === 'signature_raster');
    const vector = artefacts.find((a) => a.purpose === 'signature_vector');
    expect(raster!.id).toBe(sig.signatureRasterArtefactId);
    expect(vector!.id).toBe(sig.signatureVectorArtefactId);
    expect(raster!.sha256).toBe(sig.signatureRasterSha256);
    expect(vector!.sha256).toBe(sig.signatureVectorSha256);
    expect(raster!.detectedContentType).toBe('image/png');
    // No name on the artefact row: who signed is bound through the agreement's
    // assignor record, and repeating it here would spread a name for nothing.
    expect(raster!.uploadedByName).not.toContain('Alex');

    // The vault carries the hashes and the shape, and NOTHING of the drawing.
    const events = await prisma.vaultOutbox.findMany({ where: { subjectId: sig.id } });
    const captured = events.find((e) => e.type === 'signature.captured');
    const payload = captured!.payload as Record<string, unknown>;
    expect(payload.signatureRasterSha256).toBe(sig.signatureRasterSha256);
    expect(payload.signatureVectorSha256).toBe(sig.signatureVectorSha256);
    expect(payload.strokeCount).toBe(2);
    expect(JSON.stringify(payload)).not.toContain(TINY_PNG.slice(0, 24));

    // Each artefact got its own event too, in the same transaction.
    for (const artefact of [raster!, vector!]) {
      const rows = await prisma.vaultOutbox.findMany({ where: { subjectId: artefact.id } });
      expect(rows.map((r) => r.type)).toContain('artefact.accessed');
    }
  });

  it('signature_artefacts_hashed_and_bound_in_same_transaction — a failure part-way rolls ALL of it back', async () => {
    /*
     * THE STRUCTURAL HALF OF THE SAME RULE (rule 11). The assertions above
     * prove the rows are all there on the happy path; this proves they cannot
     * be there PARTLY. The second artefact row is made to fail inside the
     * signing transaction, and what must survive is nothing: no signature
     * event, and not the first artefact row either.
     *
     * The staged BYTES do survive in the store, and that is the documented
     * design — orphaned content is identifiable by its hash and harmless,
     * whereas a row pointing at content that was never written is a broken
     * reference.
     */
    const { agreementId, captureRequestId } = await stageAwaitingSignature();
    const artefactsService = app.get(ArtefactsService);
    const real = artefactsService.recordStaged.bind(artefactsService);
    let calls = 0;
    const spy = jest
      .spyOn(artefactsService, 'recordStaged')
      .mockImplementation(async (tx, pid, staged) => {
        calls += 1;
        if (calls === 2) throw new Error('forced failure inside the signing transaction');
        return real(tx, pid, staged);
      });

    try {
      await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/sign`)
        .set('x-practice-id', practiceId)
        .send({ method: 'drawn', channel: 'in_practice', captureRequestId, signature: drawnSignature() })
        .expect(500);
    } finally {
      spy.mockRestore();
    }

    const events = await prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findMany({ where: { agreementId } }),
    );
    expect(events).toHaveLength(0);

    const artefacts = await prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findMany({ where: { subjectType: 'Agreement', subjectId: agreementId } }),
    );
    expect(artefacts).toHaveLength(0);

    const after = await request(app.getHttpServer())
      .get(`/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(after.body.status).toBe('awaiting_signature');
  });

  it('signature_display_reverifies_hash', async () => {
    const { agreementId, captureRequestId } = await stageAwaitingSignature();
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'drawn', channel: 'in_practice', captureRequestId, signature: drawnSignature() })
      .expect(201);

    // Displayed, and served the way every artefact is served: as an
    // attachment, with the DETECTED type and nosniff.
    const shown = await request(app.getHttpServer())
      .get(`/agreements/${agreementId}/signature/raster/content`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(shown.headers['content-type']).toContain('image/png');
    expect(shown.headers['x-content-type-options']).toBe('nosniff');
    expect(shown.headers['content-disposition']).toContain('attachment');
    expect(Buffer.from(shown.body).subarray(0, 8)).toEqual(Buffer.from(TINY_PNG, 'base64').subarray(0, 8));

    const vectorShown = await request(app.getHttpServer())
      .get(`/agreements/${agreementId}/signature/vector/content`)
      .set('x-practice-id', practiceId)
      .expect(200);
    // Served as text/plain, so supertest hands it back as text rather than a
    // parsed body — which is itself the point: the strokes are stored as the
    // bytes that were hashed, not as a JSON document the server reinterprets.
    expect(JSON.parse(vectorShown.text).strokes).toHaveLength(2);

    const [sig] = await prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findMany({ where: { agreementId } }),
    );

    /*
     * THE DATABASE WILL NOT LET THIS TEST CHEAT, WHICH IS THE FIRST FINDING.
     * `artefacts` refuses an UPDATE to `sha256` or `storageKey` outright ("The
     * hash and provenance of an artefact are immutable"), and `signature_events`
     * refuses updates altogether. So neither end of the binding can be edited
     * to agree with a forgery — the only surface an attacker has left is the
     * BYTES in the store, which is exactly the surface rule 13 is about.
     *
     * So the tamper is done where a tamper could really happen: the object is
     * altered underneath us, the row and the signature event still say what
     * they always said, and the display re-hashes on the way out and refuses.
     */
    const artefact = await prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findFirstOrThrow({ where: { id: sig.signatureRasterArtefactId as string } }),
    );
    const root = app.get(ConfigService).get<string>('ARTEFACT_STORE_ROOT', './.artefacts');
    const objectPath = resolve(join(root, artefact.storageKey));
    const original = await readFile(objectPath);

    await writeFile(objectPath, Buffer.concat([original, Buffer.from('tampered')]));
    const refused = await request(app.getHttpServer())
      .get(`/agreements/${agreementId}/signature/raster/content`)
      .set('x-practice-id', practiceId)
      .expect(400);
    expect(JSON.stringify(refused.body)).toMatch(/hash/i);
    // The refusal says what it is. A tamper reported as a transient error is a
    // tamper somebody retries past.
    expect(JSON.stringify(refused.body)).toMatch(/tamper signal/i);

    // Put the bytes back; the same request succeeds again, which proves the
    // refusal was about the CONTENT and not about the route.
    await writeFile(objectPath, original);
    await request(app.getHttpServer())
      .get(`/agreements/${agreementId}/signature/raster/content`)
      .set('x-practice-id', practiceId)
      .expect(200);
  });

  it('a tap-to-approve has no drawing to display, and says so', async () => {
    const { agreementId, captureRequestId } = await stageAwaitingSignature();
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'tap_to_approve', channel: 'in_practice', captureRequestId })
      .expect(201);

    const missing = await request(app.getHttpServer())
      .get(`/agreements/${agreementId}/signature/raster/content`)
      .set('x-practice-id', practiceId)
      .expect(404);
    expect(JSON.stringify(missing.body)).toMatch(/no drawn mark/i);
  });

  it('signature_events_append_only — the DB trigger rejects updates to signature evidence', async () => {
    const events = await prisma.withPractice(practiceId, (tx) => tx.signatureEvent.findMany({ take: 1 }));
    expect(events.length).toBeGreaterThan(0);
    await expect(
      prisma.withPractice(practiceId, (tx) =>
        tx.signatureEvent.update({ where: { id: events[0].id }, data: { method: 'drawn' } }),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
