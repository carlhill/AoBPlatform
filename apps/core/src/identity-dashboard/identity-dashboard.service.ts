import { Injectable } from '@nestjs/common';
import {
  AFFILIATION_VELOCITY_WINDOW_DAYS,
  assessAdmission,
  isAffiliationVelocityAnomalous,
  practitionerStrength,
  summariseChecks,
  type CheckRecord,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The two identity dashboards (IDENTITY-STRENGTH-DESIGN.md §7).
 *
 * PLATFORM-OPERATOR SURFACES, and cross-tenant by definition. They answer
 * questions no single practice can ask:
 *
 *   - which applications are stuck, and on what?
 *   - whose verification is going stale, and who is moving unusually?
 *
 * THE SCORING IS NOT DONE HERE. It is done in the domain, where it has tests,
 * and this service only assembles the inputs. That division matters more than
 * it looks: a score is a claim about whether somebody should be trusted, and a
 * claim like that gets ONE implementation. A second one in a service — or in
 * SQL — would drift, and the drift would be invisible until two screens
 * disagreed about the same practitioner.
 *
 * THE "WOULD HAVE FAILED" COLUMN IS THE POINT OF SOFT MODE. It shows, live,
 * what hard enforcement would have cost: how many real practices we would be
 * turning away today. That is the number that decides when the threshold is
 * safe to switch on, and it is invisible unless soft mode runs first — you
 * cannot calibrate a threshold you are already enforcing, because you never
 * see the outcomes of the applications you rejected.
 */
@Injectable()
export class IdentityDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Which applications are stuck, and on what. */
  async practices() {
    const [rows, checks] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM practice_identity_rows()`,
      this.prisma.$queryRaw<
        Array<{
          practiceId: string;
          checkKey: string;
          outcome: string;
          performedAt: Date;
          performedByName: string;
          reasonCode: string | null;
          note: string | null;
        }>
      >`SELECT * FROM practice_identity_checks()`,
    ]);

    const byPractice = new Map<string, CheckRecord[]>();
    for (const check of checks) {
      const list = byPractice.get(check.practiceId) ?? [];
      list.push({
        checkKey: check.checkKey,
        outcome: check.outcome as CheckRecord['outcome'],
        performedByName: check.performedByName,
        reasonCode: check.reasonCode ?? undefined,
      } as CheckRecord);
      byPractice.set(check.practiceId, list);
    }

    const now = Date.now();

    return rows.map((row) => {
      const practiceId = String(row.id);
      const records = byPractice.get(practiceId) ?? [];
      const summary = summariseChecks(records);
      const admission = assessAdmission(summary);

      const createdAt = row.createdAt as Date;
      const validatedAt = row.validatedAt as Date | null;
      // Time in queue: how long it WAITED if decided, how long it has been
      // waiting if not. One number, and the second is the one that matters.
      const decidedAt = validatedAt ? validatedAt.getTime() : now;
      // Clamped at zero. Sub-second differences between creation and a
      // decision made in the same transaction round to -1, and "waited -1
      // days" reads as a bug in the dashboard rather than as a fast decision.
      const daysInQueue = Math.max(0, Math.floor((decidedAt - createdAt.getTime()) / 86_400_000));

      return {
        id: practiceId,
        name: row.name,
        legalName: row.legalName,
        abn: row.abn,
        abnStatus: row.abnStatus,
        entityType: row.entityType,
        state: row.state,
        validationState: row.validationState,
        validatedByName: row.validatedByName,
        validatedAt,
        createdAt,
        daysInQueue,
        /** Still waiting, as against decided. The queue question. */
        stillWaiting: row.validationState === 'pending',
        emailVerified: Boolean(row.adminEmailVerifiedAt),

        score: summary.score,
        summary,
        /** What HARD enforcement would decide, computed while it is SOFT. */
        wouldPass: admission.wouldPass,
        wouldFailBecause: admission.reasons,

        /*
         * The weakest link, which is the operational answer to "on what". A
         * dashboard that shows a score and leaves the reader to work out what
         * to do about it has moved the work rather than done it.
         */
        weakestLink: admission.reasons[0] ?? null,

        artefactCount: Number(row.artefactCount ?? 0),
        locationCount: Number(row.locationCount ?? 0),
        activeLocationCount: Number(row.activeLocationCount ?? 0),
        credentialCount: Number(row.credentialCount ?? 0),
        verifiedCredentialCount: Number(row.verifiedCredentialCount ?? 0),
        affiliationCount: Number(row.affiliationCount ?? 0),
        activeAffiliationCount: Number(row.activeAffiliationCount ?? 0),
      };
    });
  }

  /** Whose verification is going stale, and who is moving unusually. */
  async practitioners() {
    const since = new Date(Date.now() - AFFILIATION_VELOCITY_WINDOW_DAYS * 86_400_000);
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM practitioner_identity_rows(${since})`;

    const now = new Date();

    return rows.map((row) => {
      const addedInWindow = Number(row.affiliationsInWindow ?? 0);
      const activeCount = Number(row.activeAffiliationCount ?? 0);

      const velocityAnomalous = isAffiliationVelocityAnomalous({
        activeCount,
        addedInLastDays: addedInWindow,
        windowDays: AFFILIATION_VELOCITY_WINDOW_DAYS,
      });

      /*
       * The email is counted as PROVEN only when the practitioner answered at
       * it — which today means accepting an invitation by the emailed code.
       * An address the practice typed in is the practice's claim, not the
       * practitioner's, and scoring it would be scoring data entry.
       */
      const emailProven = Number(row.acceptedByEmail ?? 0) > 0 || Number(row.acceptedByPasskey ?? 0) > 0;

      const strength = practitionerStrength(
        {
          registrationStatus: row.registrationStatus as string | null,
          registrationSightedAt: row.registrationSightedAt as Date | null,
          registrationSightedByName: row.registrationSightedByName as string | null,
          registrationSource: row.registrationSource as string | null,
          verifiedAt: row.verifiedAt as Date | null,
          passkeyEnrolledAt: row.passkeyEnrolledAt as Date | null,
          hasEmail: Boolean(row.hasEmail),
          emailProvenAt: emailProven ? (row.createdAt as Date) : null,
          hasRestrictions: Boolean(row.hasRestrictions),
          affiliationVelocityAnomalous: velocityAnomalous,
          deregisteredAt: row.deregisteredAt as Date | null,
          // Locality and name comparison need the affiliating location, which
          // is per-affiliation rather than per-practitioner. Left UNCOMPARED
          // rather than guessed: `null` means nobody has established it, and
          // that is a different thing from a comparison that failed.
          localityMatches: null,
          nameMatches: null,
          providerNumberFormatValid: null,
        },
        now,
      );

      return {
        id: String(row.id),
        ahpraNumber: row.ahpraNumber,
        familyName: row.familyName,
        givenNames: row.givenNames,
        providerType: row.providerType,
        profession: row.profession,
        registrationStatus: row.registrationStatus,
        registrationSightedAt: row.registrationSightedAt,
        registrationSightedByName: row.registrationSightedByName,
        principalSuburb: row.principalSuburb,
        principalState: row.principalState,
        deregisteredAt: row.deregisteredAt,

        score: strength.score,
        potentialScore: strength.potentialScore,
        freshness: strength.freshness,
        sightingAgeDays: strength.sightingAgeDays,
        blocking: strength.blocking,
        negatives: strength.negatives,
        weakestLink: strength.weakestLink,
        lines: strength.lines,

        affiliationCount: Number(row.affiliationCount ?? 0),
        activeAffiliationCount: activeCount,
        addedInWindow,
        velocityAnomalous,
        velocityWindowDays: AFFILIATION_VELOCITY_WINDOW_DAYS,

        /*
         * HOW their affiliations were accepted, in aggregate. A practitioner
         * with three affiliations all accepted by emailed code has three
         * records resting on access to one inbox — which is a fact about the
         * whole set, not about any one of them, and only visible here.
         */
        acceptedByPasskey: Number(row.acceptedByPasskey ?? 0),
        acceptedByEmail: Number(row.acceptedByEmail ?? 0),
      };
    });
  }
}
