import { Logger, Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ConfigService } from '@nestjs/config';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
import { PendingEmailService } from './pending-email.service';
import { PendingEmailController } from './pending-email.controller';
import { ChecksService } from './checks.service';
import { ApplicantController } from './applicant.controller';
import { ApplicantService } from './applicant.service';
import { AuditService } from './audit.service';
import { SetupService } from './setup.service';
import { ABR_CLIENT, ADDRESS_VALIDATOR } from './organisations.tokens';
import { AbrWebServicesClient, OfflineAbrClient } from './abr';
import { createAddressValidator } from './address-validator';

/**
 * Organisation onboarding (FR-1.1).
 *
 * Both external-data adapters default to the SAFE option and must be turned
 * on deliberately:
 *   - ABR   defaults offline. No ABR_API_GUID means no network call, and an
 *           unverifiable ABN is refused rather than waved through.
 *   - G-NAF defaults to manual. A validator that always says yes is worse
 *           than none, because it writes addressValidated = true.
 */
@Module({
  imports: [IdentityModule],
  controllers: [OrganisationsController, ApplicantController, PendingEmailController],
  providers: [
    OrganisationsService,
    PendingEmailService,
    ChecksService,
    ApplicantService,
    AuditService,
    SetupService,
    {
      provide: ABR_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('OrganisationsModule');
        /*
         * WHICH CLIENT IS RUNNING IS SAID AT STARTUP, EVERY TIME, in both
         * branches. "Is this environment actually talking to the register?" is
         * the first question anyone asks about an onboarding that behaved
         * oddly, and until now only the offline branch answered it — so a live
         * environment looked exactly like a broken one in the log.
         *
         * THE GUID IS NEVER LOGGED. Not its value, not a prefix of it, not its
         * length. What is logged is the base URL, which is public.
         */
        const guid = (config.get<string>('ABR_API_GUID') ?? config.get<string>('ABR_GUID') ?? '').trim();
        if (!guid) {
          logger.log(
            'ABR_API_GUID is not set — ABN lookup runs OFFLINE against fixtures. No network calls are made, ' +
              'and any ABN outside the fixtures routes onboarding to manual attestation.',
          );
          return new OfflineAbrClient();
        }
        const baseUrl = config.get<string>('ABR_BASE_URL', 'https://abr.business.gov.au/json');
        logger.log(`ABN lookup is LIVE against ${baseUrl} (method AbnDetails). The GUID is configured and is never logged.`);
        return new AbrWebServicesClient(guid, baseUrl);
      },
    },
    {
      provide: ADDRESS_VALIDATOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createAddressValidator(
          config.get<string>('ADDRESS_VALIDATION_MODE', 'manual'),
          config.get<string>('GNAF_DATASET_VERSION'),
        ),
    },
  ],
  exports: [OrganisationsService, ChecksService],
})
export class OrganisationsModule {}
