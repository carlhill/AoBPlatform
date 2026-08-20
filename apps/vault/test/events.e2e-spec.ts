import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Evidence Vault API (e2e, memory store)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.CHAIN_STORE = 'memory';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const validEvent = {
    type: 'agreement.created',
    actor: { principalType: 'system', id: 'core' },
    subject: { type: 'Agreement', id: 'agr-e2e-1' },
    payload: { channel: 'in_practice', artefactSha256: 'a'.repeat(64) },
  };

  it('appends a valid event and returns the chained record', async () => {
    const res = await request(app.getHttpServer()).post('/events').send(validEvent).expect(201);
    expect(res.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.previousHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.recordedAt).toBeDefined();
  });

  it('rejects an event type outside the whitelist with 400 — never coerces', async () => {
    await request(app.getHttpServer())
      .post('/events')
      .send({ ...validEvent, type: 'agreement.updated' })
      .expect(400);
  });

  it('rejects a payload carrying a forbidden field (REQ-LOG-08 / HARD-03)', async () => {
    await request(app.getHttpServer())
      .post('/events')
      .send({ ...validEvent, payload: { medicareNumber: '2951' } })
      .expect(400);
  });

  it('rejects nested payloads — events are flat, content-free detail only', async () => {
    await request(app.getHttpServer())
      .post('/events')
      .send({ ...validEvent, payload: { nested: { deep: true } } })
      .expect(400);
  });

  it('has no update or delete route on events', async () => {
    const appended = await request(app.getHttpServer()).post('/events').send(validEvent).expect(201);
    await request(app.getHttpServer()).put(`/events/${appended.body.id}`).send({}).expect(404);
    await request(app.getHttpServer()).patch(`/events/${appended.body.id}`).send({}).expect(404);
    await request(app.getHttpServer()).delete(`/events/${appended.body.id}`).expect(404);
  });

  it('lists events by subject', async () => {
    const res = await request(app.getHttpServer()).get('/events').query({ subjectId: 'agr-e2e-1' }).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((e: { subject: { id: string } }) => e.subject.id === 'agr-e2e-1')).toBe(true);
  });

  it('verifies an artefact hash with metadata only (REQ-VAULT-09)', async () => {
    const found = await request(app.getHttpServer())
      .get(`/artefacts/${'a'.repeat(64)}/verify`)
      .expect(200);
    expect(found.body.exists).toBe(true);
    expect(Object.keys(found.body).sort()).toEqual(['exists', 'recordedAt']);

    const missing = await request(app.getHttpServer())
      .get(`/artefacts/${'f'.repeat(64)}/verify`)
      .expect(200);
    expect(missing.body.exists).toBe(false);
  });

  it('reports the whole chain as valid via the continuous-verifier endpoint', async () => {
    const res = await request(app.getHttpServer()).get('/chain/verify').expect(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});
