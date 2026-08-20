import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { VaultClient } from '@aobplatform/contracts';
import { relayPendingVaultEvents } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { VAULT_CLIENT } from './vault.tokens';

export const RELAY_INTERVAL_MS = 5_000;

/**
 * Thin NestJS wrapper around the framework-agnostic relay (vault-client):
 * scheduling + the skip-if-already-running guard live here; the retry policy
 * (exponential backoff, no permanent give-up) lives in the package.
 */
@Injectable()
export class VaultRelayService {
  private readonly logger = new Logger(VaultRelayService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VAULT_CLIENT) private readonly vaultClient: VaultClient,
  ) {}

  @Interval(RELAY_INTERVAL_MS)
  async relay(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await relayPendingVaultEvents({
        prisma: this.prisma,
        vaultClient: this.vaultClient,
        logger: this.logger,
      });
    } finally {
      this.running = false;
    }
  }
}
