import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VaultHttpClient } from '@aobplatform/vault-client';
import { ServiceTokenProvider } from '@aobplatform/auth-client';
import { VaultRelayService } from './vault-relay.service';
import { VAULT_CLIENT } from './vault.tokens';

export { VAULT_CLIENT } from './vault.tokens';

@Module({
  providers: [
    {
      provide: VAULT_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const issuer = config.get<string>('KEYCLOAK_ISSUER');
        const clientSecret = config.get<string>('KEYCLOAK_CLIENT_SECRET');
        // Real client-credentials tokens once Keycloak is configured; a dev
        // placeholder otherwise. The vault's inbound auth guard (verifying
        // these) is the enforcement half — staged with the login surfaces.
        const tokens =
          issuer && clientSecret
            ? new ServiceTokenProvider({
                issuer,
                clientId: config.get<string>('KEYCLOAK_CLIENT_ID', 'core-service'),
                clientSecret,
              })
            : null;
        return new VaultHttpClient({
          baseUrl: config.get<string>('VAULT_SERVICE_URL', 'http://localhost:3003'),
          getServiceToken: () => (tokens ? tokens.getToken() : 'dev-service-token'),
        });
      },
    },
    VaultRelayService,
  ],
  exports: [VAULT_CLIENT],
})
export class VaultModule {}
