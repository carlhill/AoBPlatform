import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Rules & Conformance API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists registered rule-set versions (empty until the human-authored set lands)', async () => {
    const res = await request(app.getHttpServer()).get('/rule-sets').expect(200);
    expect(res.body).toEqual({ versions: [] });
  });

  it('returns 501 — never a silent pass — while no rule set is registered', async () => {
    const res = await request(app.getHttpServer())
      .post('/validate')
      .send({ payload: { patientName: 'Alex Testpatient' } })
      .expect(501);
    expect(res.body.message).toContain('human-authored');
  });

  it('rejects a request without a payload object', async () => {
    await request(app.getHttpServer()).post('/validate').send({}).expect(400);
  });
});
