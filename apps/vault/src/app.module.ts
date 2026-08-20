import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';

/**
 * Evidence Vault service (M11). Append-only: this service's API will expose
 * append and read — there is NO update and NO delete endpoint, by design
 * (rule 11, ADR A-02). Deletion is crypto-shredding + tombstone only.
 * Separate trust domain: own credentials, own datastore, no delete grants.
 *
 * ⚠ HUMAN-AUTHORED ZONE (CLAUDE.md §7): the hash chain, immudb integration,
 * external anchoring, and anything touching key management are written and
 * reviewed by humans. Agents may assist with tests, review, and refactors —
 * not author them wholesale. The event contract callers use is
 * @aobplatform/contracts (vault.ts).
 */
import { EventsModule } from './events/events.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule, EventsModule],
})
export class AppModule {}
