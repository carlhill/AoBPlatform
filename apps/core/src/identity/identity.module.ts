import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeycloakAdminClient } from '@aobplatform/auth-client';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { PracticeAdminService } from './practice-admin.service';
import { PractitionerAccessService } from './practitioner-access.service';
import { KEYCLOAK_ADMIN } from './identity.tokens';

/**
 * FR-1.9 / FR-1.5 — practitioner and staff onboarding into the identity
 * provider. Absent Keycloak config the provider resolves to null and the
 * invite endpoints return a clear 501 rather than half-creating an account.
 */
@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    PracticeAdminService,
    PractitionerAccessService,
    {
      provide: KEYCLOAK_ADMIN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const baseUrl = config.get<string>('KEYCLOAK_BASE_URL');
        const password = config.get<string>('KEYCLOAK_ADMIN_PASSWORD');
        if (!baseUrl || !password) return null;
        return new KeycloakAdminClient({
          baseUrl,
          realm: config.get<string>('KEYCLOAK_REALM', 'aobplatform'),
          username: config.get<string>('KEYCLOAK_ADMIN_USER', 'admin'),
          password,
        });
      },
    },
  ],
  exports: [IdentityService, PracticeAdminService, PractitionerAccessService, KEYCLOAK_ADMIN],
})
export class IdentityModule {}
