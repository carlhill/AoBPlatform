import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AffiliationsService } from '../src/affiliations/affiliations.service';

/**
 * A provider number never leaves the practice it belongs to — including to us.
 *
 * WHY THIS TEST EXISTS, and it is not a hypothetical. `listForPractice` carried
 * a comment saying "this is the only place it is ever returned", which was true
 * when the practice was its only caller. The read-only platform view became a
 * second caller and the sentence quietly stopped being true: provider numbers
 * appeared on screen to an operator who is not the practice.
 *
 * A comment cannot notice a new caller. This can.
 *
 * WHY IT MATTERS. A provider number is the practice-and-place key that Medicare
 * benefit claims are made against. "Never crosses a practice boundary" has to
 * include the platform, or the rule only ever meant "not to OTHER practices" —
 * and the platform is the single party that can see every practice at once.
 */
describe('a provider number does not cross the practice boundary (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let affiliations: AffiliationsService;
  let practiceId: string;
  let practitionerId: string;
  let locationId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    affiliations = app.get(AffiliationsService);

    /*
     * ITS OWN FIXTURE, rather than whatever the dev database happens to hold.
     *
     * Two suites were already made flaky today by depending on rows another
     * suite created and deleted. A test about a boundary should build both
     * sides of it and own them.
     *
     * The id is chosen first so the RLS scope can be set to it before the row
     * exists -- `withPractice` sets the transaction-local claim, and the
     * practice's own WITH CHECK requires the row being written to match it.
     */
    practiceId = randomUUID();
    practitionerId = randomUUID();

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({
        data: { id: practiceId, name: 'Provider Number Boundary Test', validationState: 'validated' },
      });
      const location = await tx.practiceLocation.create({
        data: {
          practiceId,
          address: '1 Boundary Street, Testville NSW 2000',
          // An ACTIVE location needs a structured address by CHECK constraint,
          // because a place patients are seen at has to be a real place.
          addressLine1: '1 Boundary Street',
          suburb: 'Testville',
          state: 'NSW',
          postcode: '2000',
          code: 'BOUNDARY',
          active: true,
          addressValidated: true,
        },
      });
      locationId = location.id;
    });

    await prisma.practitioner.create({
      data: {
        id: practitionerId,
        ahpraNumber: `BND${Date.now().toString().slice(-10)}`,
        familyName: 'Boundary',
        givenNames: 'Test',
        providerType: 'general_practitioner',
      },
    });

    await prisma.withPractice(practiceId, (tx) =>
      tx.affiliation.create({
        data: {
          practiceId,
          practitionerId,
          locationId,
          status: 'active',
          startedAt: new Date(),
          // The thing under test.
          providerNumber: '1234567A',
        },
      }),
    );
  });

  afterAll(async () => {
    if (practiceId) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.affiliation.deleteMany({ where: { practiceId } });
        await tx.practiceLocation.deleteMany({ where: { practiceId } });
        await tx.practice.deleteMany({ where: { id: practiceId } });
      });
      await prisma.practitioner.deleteMany({ where: { id: practitionerId } });
    }
    await app?.close();
  });

  it('gives the practice its own provider numbers', async () => {
    const list = await affiliations.listForPractice(practiceId, { asPractice: true });
    expect(list.some((a) => a.providerNumber)).toBe(true);
  });

  it('GIVES THE PLATFORM NONE OF THEM, only whether one exists', async () => {
    const list = await affiliations.listForPractice(practiceId, { asPractice: false });

    // Not one, anywhere in the response.
    expect(list.every((a) => a.providerNumber === null)).toBe(true);

    /*
     * WHETHER ONE EXISTS IS STILL ANSWERED, because that is what the readiness
     * question actually needs: an affiliation without a provider number cannot
     * capture consent, and an operator helping a practice has to be able to see
     * which ones are missing. Knowing one exists is not knowing what it is.
     */
    expect(list.some((a) => a.hasProviderNumber)).toBe(true);
  });

  it('defaults to the practice, so a caller must ASK to be treated as the platform', async () => {
    /*
     * The default is the stricter thing to get wrong. A new caller that forgets
     * the option gets the practice's own view — which is only ever served to
     * somebody who already holds the practice's claim, because the controller
     * decides `asPractice` from the token rather than from the request.
     */
    const list = await affiliations.listForPractice(practiceId);
    expect(list.some((a) => a.providerNumber)).toBe(true);
  });
});
