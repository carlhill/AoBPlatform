import { Module } from '@nestjs/common';
import { TabletSessionsController } from './tablet-sessions.controller';
import { KioskSessionController } from './kiosk-session.controller';
import { TabletSessionsService } from './tablet-sessions.service';
import { AgreementsModule } from '../agreements/agreements.module';
import { CaptureModule } from '../capture/capture.module';
import { VerificationModule } from '../verification/verification.module';
import { DevicesModule } from '../devices/devices.module';
import { ServiceDescriptionsModule } from '../service-descriptions/service-descriptions.module';

/**
 * PUSH-TO-DEVICE CAPTURE — reception hands the patient a locked screen
 * (TODO.md "Push-to-device capture" and "Two front doors", Carl 4 Sep 2026).
 *
 * FOUR MODULES IMPORTED, AND EVERY ONE OF THEM FOR A WRITE THIS MODULE MUST
 * NOT MAKE ITSELF (CLAUDE.md §4 — module APIs for behaviour, never another
 * module's tables):
 *
 *   - `AgreementsModule` — validates, renders, locks, and records the
 *     verification event id and the move to `awaiting_signature`. The push
 *     supplies the reason; the agreements module owns the contract.
 *   - `CaptureModule` — opens the `in_practice` channel the signature closes
 *     (FR-2.7), inside the push's transaction.
 *   - `VerificationModule` — writes the staff-verified event: identifier
 *     TYPES, an outcome, a channel and the staff member's identity, and never
 *     a value (REQ-VER-04).
 *   - `DevicesModule` — answers whether a tablet exists, is paired, and
 *     belongs to this practice. Pairing, revoking and rotating stay entirely
 *     that module's, and this one gains no way to hand out a credential.
 *
 * THIS MODULE OWNS EXACTLY ONE TABLE, `tablet_sessions`, and every write it
 * makes outside that table goes through one of the calls above — which is what
 * lets the whole push commit in a single transaction (hard rule 11) without
 * any module reaching into another's rows.
 *
 * IT DOES NOT TOUCH THE WALK-UP KIOSK. `KioskModule` is untouched and
 * `/kiosk/waiting-list` behaves exactly as it did: the walk-up kiosk stays as
 * built, and this is a second use case on the same paired tablet.
 */
@Module({
  imports: [
    AgreementsModule,
    CaptureModule,
    VerificationModule,
    DevicesModule,
    /*
     * D6a IS THE SERVICE-DESCRIPTIONS MODULE'S WRITE (Carl, 4 Sep 2026). When
     * a patient declines an ongoing agreement, reception's one-press reply
     * creates an episodic draft and carries the description of the service
     * onto it — through that module's own API, which checks the value against
     * the CURRENT versioned list (hard rule 14) and records who set it.
     */
    ServiceDescriptionsModule,
  ],
  controllers: [TabletSessionsController, KioskSessionController],
  providers: [TabletSessionsService],
  exports: [TabletSessionsService],
})
export class TabletSessionsModule {}
