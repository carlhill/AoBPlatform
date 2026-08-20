import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('DRAFT rule set behind the flag (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.RULES_REGISTER_DRAFT_SET = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    delete process.env.RULES_REGISTER_DRAFT_SET;
    await app.close();
  });

  it('lists the draft version when the flag is set', async () => {
    const res = await request(app.getHttpServer()).get('/rule-sets').expect(200);
    expect(res.body.versions).toEqual(['draft-2026-08']);
  });

  it('validates a compliant pre-agreement payload with versions recorded (rule 14)', async () => {
    const res = await request(app.getHttpServer())
      .post('/validate')
      .send({
        payload: {
          patientName: 'Alex Testpatient',
          agreementDate: '2026-08-21',
          agreementType: 'episodic_pre',
          providerName: 'Dr Example Provider',
          providerAddress: '1 Example Street, Sampletown NSW 2000',
          serviceDate: '2026-08-21',
          basicServiceDescription: 'General practitioner attendance',
          assignorIsPatient: true,
          signaturePresent: true,
          signatureMethod: 'drawn',
          signatureTimestamp: '2026-08-21T09:30:00.000Z',
          particularsLockedAt: '2026-08-21T09:29:00.000Z',
          verificationPassed: true,
        },
      })
      .expect(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.ruleSetVersion).toBe('draft-2026-08');
    expect(res.body.mappingVersion).toBe('dev-mapping-1');
    expect(res.body.results).toHaveLength(14); // every rule reports, pass or not
  });

  it('blocks a defective payload with per-rule findings and citations (REQ-TEST-06)', async () => {
    const res = await request(app.getHttpServer())
      .post('/validate')
      .send({
        payload: {
          patientName: '',
          agreementType: 'episodic_pre',
          basicServiceDescription: 'Totally invented category',
          benefitAmount: 65.7,
          assignorIsPatient: true,
          signaturePresent: true,
          signatureMethod: 'drawn',
        },
      })
      .expect(200);
    expect(res.body.valid).toBe(false);
    const byRule = Object.fromEntries(
      res.body.results.map((r: { rule: string; outcome: string; citation?: string }) => [r.rule, r]),
    );
    expect(byRule.C1.outcome).toBe('fail');
    expect(byRule.C6.outcome).toBe('fail');
    expect(byRule.C11.outcome).toBe('warn'); // benefit amount warns, never blocks
    expect(byRule.C12.outcome).toBe('fail'); // no lock timestamp
    for (const r of res.body.results) expect(r.citation?.length ?? 0).toBeGreaterThan(0);
  });
});
