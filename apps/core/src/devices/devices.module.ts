import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceCredentialGuard } from './device.guard';

/**
 * Device pairing — the one credential a tablet may hold (CLAUDE.md §7).
 *
 * THE GUARD IS GLOBAL AND REGISTERED HERE, which puts it after `AuthGuard`
 * (AuthModule is `@Global` and imported first, and Nest runs global guards in
 * registration order). That order is load-bearing: a verified token's practice
 * claim is on the request before this looks, and a token wins over a device.
 *
 * EXPORTED because `KioskModule` asks it whether a tablet's build is below the
 * practice's floor — behaviour through a module API, never another module
 * reaching into these tables.
 */
@Module({
  controllers: [DevicesController],
  providers: [DevicesService, { provide: APP_GUARD, useClass: DeviceCredentialGuard }],
  exports: [DevicesService],
})
export class DevicesModule {}
