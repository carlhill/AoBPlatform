import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
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
  controllers: [OrganisationsController],
  providers: [
    OrganisationsService,
    {
      provide: ABR_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const guid = config.get<string>('ABR_API_GUID');
        if (!guid) {
          new Logger('OrganisationsModule').log(
            'ABR_API_GUID is not set — ABN lookup runs offline against fixtures. No network calls are made.',
          );
          return new OfflineAbrClient();
        }
        return new AbrWebServicesClient(guid, config.get<string>('ABR_BASE_URL', 'https://abr.business.gov.au/json'));
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
  exports: [OrganisationsService],
})
export class OrganisationsModule {}
