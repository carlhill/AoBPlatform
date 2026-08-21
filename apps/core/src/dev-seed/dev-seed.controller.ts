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
      const provider = await tx.provider.create({
        data: {
          practiceId,
          name: 'Dr Example Provider',
          providerType: 'general_practitioner',
          placeOfPracticeAddress: '1 Example Street, Sampletown NSW 2000',
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
