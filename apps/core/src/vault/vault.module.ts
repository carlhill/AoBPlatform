import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VaultHttpClient } from '@aobplatform/vault-client';
import { VaultRelayService } from './vault-relay.service';
import { VAULT_CLIENT } from './vault.tokens';

export { VAULT_CLIENT } from './vault.tokens';

@Module({
  providers: [
    {
      provide: VAULT_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new VaultHttpClient({
          baseUrl: config.get<string>('VAULT_SERVICE_URL', 'http://localhost:3003'),
          // TODO: Keycloak client-credentials token once identity work starts
          // (infra/keycloak). Local dev sends a placeholder; the vault's own
          // auth guard is a TODO(HUMAN) in its controller.
          getServiceToken: () => 'dev-service-token',
        }),
    },
    VaultRelayService,
  ],
  exports: [VAULT_CLIENT],
})
export class VaultModule {}
