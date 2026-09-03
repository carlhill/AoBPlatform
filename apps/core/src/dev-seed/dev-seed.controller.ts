import { Controller, ForbiddenException, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('dev')
export class DevSeedController {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates one sample practice with a GP, a patient and a self-assignor. Dev only. */
  @Post('seed')
  async seed() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev seeding does not exist in production.');
    }
    const practiceId = randomUUID();
    return this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.create({
        data: {
          id: practiceId,
          name: `Sample Practice ${practiceId.slice(0, 8)}`,
          // Marked validated by the seed itself, so the org/affiliation
          // endpoints work against a seeded practice. Named honestly: the
          // record says a seed did this, not that a reviewer did.
          validationState: 'validated',
          validatedByName: 'dev seed (not a human review)',
          validatedAt: new Date(),
        },
      });
      /*
       * LINKED TO THE MOCK ADAPTER'S FIXTURES, on purpose. Without
       * `pmsLinkageKey` the seeded patient looked complete and two things
       * silently did not happen in the running stack: write-back
       * (`WriteBackService.attempt` leaves an unlinked patient unwritten —
       * "cannot land the artefact where an auditor looks") and verification
       * against the live PMS record (ADR A-08). The values match
       * apps/connector/src/mock-adapter.ts exactly, so the seeded practice
       * behaves like a connected one end to end. Email and mobile are what
       * let the capture cascade actually send this patient a link.
       */
      const provider = await tx.provider.create({
        data: {
          practiceId,
          name: 'Dr Example Provider',
          providerType: 'general_practitioner',
          placeOfPracticeAddress: '1 Example Street, Sampletown NSW 2000',
          pmsLinkageKey: 'mock-prov-001',
        },
      });
      const patient = await tx.patient.create({
        data: {
          practiceId,
          familyName: 'Testpatient',
          givenNames: 'Alex',
          dateOfBirth: new Date('1957-03-14'),
          genderAsIdentified: 'male',
          address: '1 Example Street, Sampletown NSW 2000',
          patientRecordNumber: 'SAMPLE-0001',
          pmsLinkageKey: 'mock-pat-001',
          email: 'alex.testpatient@example.invalid',
          mobile: '+61400000000',
        },
      });
      const assignor = await tx.assignor.create({
        data: { practiceId, name: 'Alex Testpatient', authorityBasis: 'self' },
      });
      return {
        practiceId: practice.id,
        providerId: provider.id,
        patientId: patient.id,
        assignorId: assignor.id,
      };
    });
  }
}
