import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AffiliationsService } from './affiliations.service';

/**
 * Ends affiliations whose agreed end date has arrived.
 *
 * THIS IS NOT HOUSEKEEPING. An affiliation ending is the event that ceases
 * enduring agreements at that location under reg 65CA(8). If the sweep does
 * not run, the platform keeps accepting consent under an affiliation that has
 * expired — the silent-invalidation failure mode, which is the one the design
 * docs return to repeatedly.
 *
 * It runs hourly rather than daily because "the end date has arrived" should
 * become true within an hour of midnight, not at whatever hour a daily job
 * happens to be scheduled for.
 */
@Injectable()
export class AffiliationSweepService {
  private readonly logger = new Logger(AffiliationSweepService.name);

  constructor(private readonly affiliations: AffiliationsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    try {
      const { ended } = await this.affiliations.endDueAffiliations();
      if (ended > 0) {
        this.logger.log(
          `${ended} affiliation(s) reached their end date. Enduring agreements at those locations have ` +
            'ceased under reg 65CA(8); evidence is retained in full.',
        );
      }
    } catch (err) {
      // Never let a sweep failure take the process down, but never let it pass
      // silently either — an unswept affiliation is a correctness problem.
      this.logger.error(`Affiliation sweep failed: ${(err as Error).message}`);
    }
  }
}
