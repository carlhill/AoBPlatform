import { Module } from '@nestjs/common';
import { AffiliationsController } from './affiliations.controller';
import { AffiliationsService } from './affiliations.service';
import { AffiliationSweepService } from './affiliation-sweep.service';
import { InvitationService } from './invitation.service';
import { OrganisationsModule } from '../organisations/organisations.module';
import { IdentityModule } from '../identity/identity.module';
import { PractitionerSelfController } from './practitioner-self.controller';

/**
 * Practitioners and affiliations. Depends on OrganisationsModule for the
 * "is this practice actually validated" gate — module API only, no
 * cross-module table access (CLAUDE.md §4).
 */
@Module({
  // IdentityModule for PractitionerAccessService: accepting an affiliation
  // is the ceremony that issues a practitioner their sign-in.
  imports: [OrganisationsModule, IdentityModule],
  controllers: [AffiliationsController, PractitionerSelfController],
  providers: [AffiliationsService, AffiliationSweepService, InvitationService],
  exports: [AffiliationsService],
})
export class AffiliationsModule {}
