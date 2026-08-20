import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma-client';

/**
 * Vault bookkeeping store (schema `vault`). Holds the chain-entry INDEX only
 * — the evidence itself lives in immudb. No practice scoping here: the vault
 * is its own trust domain and its rows carry IDs, never content.
 */
@Injectable()
export class VaultPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
