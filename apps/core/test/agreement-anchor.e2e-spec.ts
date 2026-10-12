import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { anchorForLegacyProvider, matchAffiliationsForProvider } from '../src/affiliations/agreement-anchor';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

/** Exact string from the current mapping — anything else and C6 refuses the lock. */
const D6A = 'General practitioner attendance';

/**
 * THE AGREEMENT ANCHOR — the practitioner's affiliation at a location, which
 * replaced the practice-wide `providers` row on 7 September 2026 (Carl:
 * "retire providers as the anchor").
 *
 * WHAT THESE PIN, and why each was worth a test of its own:
 *
 *  - A new agreement HAS an anchor, enforced by the database and not only by
 *    the service, because a row that cannot say which person at which address
 *    it named is not evidence of a contract (s 65C(5)(a)).
 *  - Coverage is per PRACTITIONER. A GP at two of a practice's sites is one
 *    person, and the previous model — a practice-wide row per site's worth of
 *    data — would have offered the same patient a second enduring agreement at
 *    the second site, which is the exact thing REQ-END-01 forbids.
 *  - D4 reads the person and THAT LOCATION's provider number, because the
 *    number is issued per practitioner per location (FR-1.8).
 *  - The backfill and the deprecated `providerId` door never GUESS an anchor.
 *    Naming the wrong doctor on a consent record is worse than saying "we do
 *    not know" and asking somebody.
 *  - An arrival naming a provider NUMBER lands on the affiliation at that
 *    location, because the number names both by itself.
 */
describe('the agreement anchor: a practitioner at a location (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();

  /** One doctor, two of this practice's sites. The whole point of the suite. */
  let mainStreet: Awaited<ReturnType<typeof createServicingProvider>>;
  let afterHours: Awaited<ReturnType<typeof createServicingProvider>>;
  /** A second person, for the "different practitioner is not covered" half. */
  let otherDoctor: Awaited<ReturnType<typeof createServicingProvider>>;
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
      await tx.practice.create({
        data: { id: practiceId, name: 'Anchor Test Practice', defaultServiceDescription: D6A },
      });
      mainStreet = await createServicingProvider(tx, practiceId, {
        name: 'Dr Sample Anchor',
        providerType: 'general_practitioner',
        providerNumber: '1111111A',
        suburb: 'Sampletown',
        locationCode: 'Main Street',
      });
      // THE SAME PERSON, the other site, a different number — which is how
      // provider numbers are issued (FR-1.8).
      afterHours = await createServicingProvider(tx, practiceId, {
        name: 'Dr Sample Anchor',
        providerType: 'general_practitioner',
        providerNumber: '1111111B',
        practitionerId: mainStreet.practitionerId,
        suburb: 'Otherville',
        locationCode: 'After Hours',
      });
      otherDoctor = await createServicingProvider(tx, practiceId, {
        name: 'Dr Other Anchor',
        providerType: 'general_practitioner',
        locationId: mainStreet.locationId,
      });
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Anchorpatient',
            givenNames: 'Robin',
            dateOfBirth: new Date('1961-05-06'),
            address: '3 Example Street, Sampletown NSW 2000',
            patientRecordNumber: 'ANCHOR-0001',
          },
        })
      ).id;
      assignorId = (
        await tx.assignor.create({ data: { practiceId, name: 'Robin Anchorpatient', authorityBasis: 'self' } })
      ).id;
    });

    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Somebody Else Medical' } });
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.arrival.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.enduringDetail.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  const draft = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/agreements').set('x-practice-id', practiceId).send({
      type: 'episodic_pre',
      patientId,
      assignorId,
      assignorIsPatient: true,
      ...body,
    });

  // -------------------------------------------------------------------------

  /**
   * THE DATABASE SAYS SO, NOT ONLY THE SERVICE. The constraint is what makes
   * this true of rows written by a migration, a script or a future endpoint
   * that forgets — which is the whole difference between a rule and a habit
   * (CLAUDE.md §2).
   */
  it('new_agreements_are_anchored_on_an_affiliation', async () => {
    const created = await draft({ affiliationId: mainStreet.affiliationId }).expect(201);

    await prisma.withPractice(practiceId, async (tx) => {
      const row = await tx.agreement.findFirst({ where: { id: created.body.id } });
      expect(row?.affiliationId).toBe(mainStreet.affiliationId);
      // Nothing was written to the retired anchor: this caller named a
      // practitioner and no `providers` row was involved at all.
      expect(row?.providerId).toBeNull();
      expect(row?.providerAnchorBackfill).toBeNull();

      // And the anchor reaches the person and the place in one hop.
      const affiliation = await tx.affiliation.findFirst({ where: { id: row!.affiliationId! } });
      expect(affiliation?.practitionerId).toBe(mainStreet.practitionerId);
      expect(affiliation?.locationId).toBe(mainStreet.locationId);

      // The database refuses an unanchored one outright.
      await expect(
        tx.agreement.create({
          data: {
            practiceId,
            type: 'episodic_pre',
            anchorKind: 'provider',
            patientId,
            assignorId,
            assignorIsPatient: true,
          },
        }),
      ).rejects.toThrow(/agreements_new_rows_are_anchored_on_an_affiliation/);
    });
  });

  /**
   * RLS, NOT A FILTER. Another practice cannot anchor an agreement on this
   * practice's affiliation: the scoped read finds nothing, so the answer is
   * "not found here" rather than a cross-practice draft.
   */
  it('a cross-practice anchor fails closed', async () => {
    const res = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', otherPracticeId)
      .send({
        type: 'episodic_pre',
        affiliationId: mainStreet.affiliationId,
        patientId,
        assignorId,
        assignorIsPatient: true,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toContain(mainStreet.practitionerId);
  });

  /**
   * HARD RULE 6, REQ-END-01: the agreement is per PRACTITIONER × patient, and
   * a practitioner is a person rather than a row on a location.
   *
   * The failure this prevents is precise: a patient with a live enduring
   * agreement with their GP walks into the practice's after-hours site, the
   * platform sees a different affiliation, decides "no enduring agreement
   * here" and asks them to sign a second one for services the first already
   * assigns.
   */
  it('enduring_coverage_is_per_practitioner_across_locations', async () => {
    const enduringId = await prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.create({
        data: {
          practiceId,
          type: 'enduring',
          anchorKind: 'provider',
          affiliationId: mainStreet.affiliationId,
          patientId,
          assignorId,
          assignorIsPatient: true,
          enduringPathway: 'mymedicare',
          status: 'active',
        },
      });
      await tx.enduringDetail.create({
        data: {
          practiceId,
          agreementId: agreement.id,
          notificationMethod: 'email',
          terminationMethod: 'email',
          scopeType: 'category',
          scopeValues: ['1'],
          enteredIntoAt: new Date(),
        },
      });
      return agreement.id;
    });

    const coverage = (query: Record<string, string>) =>
      request(app.getHttpServer())
        .get('/enduring/coverage')
        .set('x-practice-id', practiceId)
        .query({ patientId, ...query })
        .expect(200);

    // The site it was made at.
    const atMain = await coverage({ affiliationId: mainStreet.affiliationId });
    expect(atMain.body.covered).toBe(true);
    expect(atMain.body.agreementIds).toContain(enduringId);

    // THE OTHER SITE, SAME DOCTOR — still covered. This is the assertion the
    // whole change exists for.
    const atAfterHours = await coverage({ affiliationId: afterHours.affiliationId });
    expect(atAfterHours.body.covered).toBe(true);
    expect(atAfterHours.body.agreementIds).toContain(enduringId);

    // Asked about the PERSON directly, the same answer.
    const byPerson = await coverage({ practitionerId: mainStreet.practitionerId });
    expect(byPerson.body.covered).toBe(true);

    // A DIFFERENT doctor at the same site is NOT covered — per practitioner
    // cuts both ways, and never becomes per practice.
    const byOther = await coverage({ affiliationId: otherDoctor.affiliationId });
    expect(byOther.body.covered).toBe(false);
    expect(byOther.body.agreementIds).toHaveLength(0);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.enduringDetail.deleteMany({ where: { agreementId: enduringId } });
      await tx.agreement.deleteMany({ where: { id: enduringId } });
    });
  });

  /**
   * D4 — s 65C(5)(a) name and place of practice, (b) the provider number, and
   * the number is per LOCATION (FR-1.8). The two sites of one doctor must
   * therefore render two different numbers and two different addresses under
   * one name; a practice-wide row could only ever have held one of each.
   */
  it('render_d4_reads_the_practitioner_and_the_locations_provider_number', async () => {
    const lockedAt = async (affiliationId: string) => {
      const created = await draft({ affiliationId }).expect(201);
      await request(app.getHttpServer())
        .post(`/agreements/${created.body.id}/transition`)
        .set('x-practice-id', practiceId)
        .send({ to: 'awaiting_signature' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/agreements/${created.body.id}/particulars`)
        .set('x-practice-id', practiceId)
        .send({ serviceDate: new Date().toISOString().slice(0, 10), basicServiceDescription: D6A })
        .expect(201);
      return prisma.withPractice(practiceId, async (tx) => {
        const row = await tx.agreement.findFirst({ where: { id: created.body.id } });
        return (row!.particulars ?? {}) as Record<string, unknown>;
      });
    };

    const main = await lockedAt(mainStreet.affiliationId);
    expect(main.providerName).toBe('Dr Sample Anchor');
    expect(main.providerNumber).toBe('1111111A');
    expect(String(main.providerAddress)).toContain('Sampletown');

    const other = await lockedAt(afterHours.affiliationId);
    // SAME PERSON. DIFFERENT PLACE. DIFFERENT NUMBER.
    expect(other.providerName).toBe('Dr Sample Anchor');
    expect(other.providerNumber).toBe('1111111B');
    expect(String(other.providerAddress)).toContain('Otherville');

    // And no amount anywhere on the particulars (hard rule 4), nor a
    // practitioner signature field (hard rule 3).
    const rendered = JSON.stringify({ main, other });
    expect(rendered).not.toMatch(/\$|benefitAmount|practitionerSignature/i);
  });

  /**
   * NEVER GUESS. The backfill and the deprecated `providerId` door share one
   * matcher, and when its three keys find nothing — or find TWO candidates —
   * the answer is "no anchor" and a person is asked, not a coin toss written
   * into a contract's record.
   */
  it('backfill_never_guesses_an_anchor', async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      // (a) NOTHING TO MATCH ON. A `providers` row with no linkage key, no
      // provider number and no AHPRA number is unmatchable by construction.
      const orphan = await tx.provider.create({
        data: { practiceId, name: 'Dr Unmatchable', providerType: 'general_practitioner' },
      });
      expect(await matchAffiliationsForProvider(tx, orphan)).toBeNull();
      const orphanAnchor = await anchorForLegacyProvider(tx, orphan);
      expect(orphanAnchor.affiliationId).toBeNull();
      expect(orphanAnchor.billingRoleRecorded).toBe(false);

      // (b) TWO CANDIDATES. The AHPRA number reaches the PERSON, and this
      // person holds an affiliation at each of the practice's two sites — so
      // the key says who and cannot say where.
      const practitioner = await tx.practitioner.findFirst({ where: { id: mainStreet.practitionerId } });
      const ambiguous = await tx.provider.create({
        data: {
          practiceId,
          name: 'Dr Sample Anchor',
          providerType: 'general_practitioner',
          ahpraNumber: practitioner!.ahpraNumber,
        },
      });
      const matched = await matchAffiliationsForProvider(tx, ambiguous);
      expect(matched?.matchedBy).toBe('ahpra_number');
      expect(matched?.candidates).toHaveLength(2);
      const ambiguousAnchor = await anchorForLegacyProvider(tx, ambiguous);
      expect(ambiguousAnchor.affiliationId).toBeNull();
      // The ROLE is still usable, because both sites agree on it — "this
      // person is a servicing provider wherever they work here" is a fact even
      // when "which desk" is not.
      expect(ambiguousAnchor.billingRoleRecorded).toBe(true);

      await tx.provider.deleteMany({ where: { id: { in: [orphan.id, ambiguous.id] } } });
    });

    // And the door refuses rather than picking: an unmatched legacy provider
    // cannot anchor a new agreement.
    const unmatchable = await prisma.withPractice(practiceId, (tx) =>
      tx.provider.create({
        data: { practiceId, name: 'Dr Also Unmatchable', providerType: 'general_practitioner' },
      }),
    );
    const refused = await draft({ providerId: unmatchable.id }).expect(400);
    expect(refused.body.message).toMatch(/not linked to a practitioner/i);
    expect(refused.body.message).toMatch(/nothing was guessed/i);
    await prisma.withPractice(practiceId, (tx) => tx.provider.deleteMany({ where: { id: unmatchable.id } }));
  });

  /**
   * THE SHAPE A REAL PMS IS LIKELIEST TO HOLD. A provider number is issued per
   * practitioner per location, so it names both by itself and the server does
   * the resolving — the sender never has to learn our ids.
   */
  it('arrival_resolves_provider_number_to_the_affiliation_at_the_location', async () => {
    const send = (providerNumber: string, record: string) =>
      request(app.getHttpServer())
        .post('/arrivals')
        .set('x-practice-id', practiceId)
        .send({
          pmsPatientRecordNumber: record,
          familyName: 'Anchorpatient',
          givenNames: 'Robin',
          dateOfBirth: '1961-05-06',
          address: '3 Example Street, Sampletown NSW 2000',
          providerNumber,
          arrivedAt: new Date().toISOString(),
          source: 'dev',
          idempotencyKey: `anchor-${randomUUID()}`,
        });

    const atMain = await send('1111111A', 'ANCHOR-0001').expect(201);
    const atAfterHours = await send('1111111B', 'ANCHOR-0001').expect(201);

    await prisma.withPractice(practiceId, async (tx) => {
      const main = await tx.arrival.findFirst({ where: { id: atMain.body.arrivalId } });
      expect(main?.affiliationId).toBe(mainStreet.affiliationId);
      // The deprecated column is untouched: nothing came in by that door.
      expect(main?.providerId).toBeNull();

      // SAME NUMBER FORMAT, OTHER SITE, OTHER AFFILIATION — and the same
      // practitioner behind both.
      const after = await tx.arrival.findFirst({ where: { id: atAfterHours.body.arrivalId } });
      expect(after?.affiliationId).toBe(afterHours.affiliationId);
      expect(after?.affiliationId).not.toBe(main?.affiliationId);

      const agreements = await tx.agreement.findMany({
        where: { id: { in: [atMain.body.agreementId, atAfterHours.body.agreementId] } },
      });
      expect(agreements.map((a) => a.affiliationId).sort()).toEqual(
        [mainStreet.affiliationId, afterHours.affiliationId].sort(),
      );
    });

    // A number nobody at this practice holds is a not-found, never a guess.
    await send('9999999Z', 'ANCHOR-0001').expect(404);
  });
});
