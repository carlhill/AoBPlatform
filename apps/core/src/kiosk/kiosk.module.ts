import { Module } from '@nestjs/common';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';

/**
 * The server half of the kiosk (CONSULTATION-CAPTURE-PLAN.md item 7). The
 * Expo client is a separate decision and is not built here; this module is
 * the read a waiting-room device needs and the freshness contract it polls
 * against. Everything else in the ceremony — verify, render, sign, complete —
 * is already served by `verification`, `agreements` and `capture`.
 */
@Module({
  controllers: [KioskController],
  providers: [KioskService],
  exports: [KioskService],
})
export class KioskModule {}
