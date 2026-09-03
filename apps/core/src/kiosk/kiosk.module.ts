import { Module } from '@nestjs/common';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { DevicesModule } from '../devices/devices.module';

/**
 * The server half of the kiosk (CONSULTATION-CAPTURE-PLAN.md item 7): the
 * read a waiting-room device needs and the freshness contract it polls
 * against. Everything else in the ceremony — verify, render, sign, complete —
 * is already served by `verification`, `agreements` and `capture`.
 *
 * WHO THE TABLET IS is `DevicesModule`'s question, not this one's. These
 * routes answer only a paired device (`@RequiresDevice()`), and the practice
 * scope arrives resolved from the credential rather than asserted by the
 * caller — which is what makes a public `/kiosk` route safe to deploy.
 */
@Module({
  // Device pairing: the tablet's practice scope, and the build floor behind
  // the forced reload. Behaviour through a module API, never another module
  // reaching into the `devices` tables.
  imports: [DevicesModule],
  controllers: [KioskController],
  providers: [KioskService],
  exports: [KioskService],
})
export class KioskModule {}
