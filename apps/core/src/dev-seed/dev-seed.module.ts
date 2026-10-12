import { Module } from '@nestjs/common';
import { DevSeedController } from './dev-seed.controller';
import { DevicesModule } from '../devices/devices.module';
import { ServiceDescriptionsModule } from '../service-descriptions/service-descriptions.module';

/**
 * Dev-only fixtures. The controller refuses to run outside development —
 * there is no production seed path, and fixture identities are obviously
 * fake with no Medicare-format numbers anywhere (CLAUDE.md §7).
 * Replaced by real practice onboarding (M1.A) in a later slice.
 */
@Module({ imports: [DevicesModule, ServiceDescriptionsModule], controllers: [DevSeedController] })
export class DevSeedModule {}
