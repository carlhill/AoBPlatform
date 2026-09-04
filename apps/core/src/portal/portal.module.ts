import { Module } from '@nestjs/common';
import { VerificationModule } from '../verification/verification.module';
import { EnduringModule } from '../enduring/enduring.module';
import { RenderModule } from '../render/render.module';
import { PortalController } from './portal.controller';
import { PortalInvitationController } from './portal-invitation.controller';
import { PortalDevController } from './portal-dev.controller';
import { PortalService } from './portal.service';
import { PortalReadsService } from './portal-reads.service';
import { PortalScope } from './portal-scope';
import { PORTAL_AUTHENTICATOR, ThreeIdentifierBootstrapAuthenticator } from './portal-authenticator';

/**
 * M8 — the patient portal (C8; REQ-PORT-01..08, FR-8.1/8.2, FR-1.14,
 * FR-1.19/-1.23, FR-5.3).
 *
 * THREE MODULES ARE IMPORTED FOR BEHAVIOUR, NEVER FOR TABLES — module APIs
 * only, no cross-module table access (CLAUDE.md §4):
 *
 *  - `VerificationModule`, because the three-identifier bootstrap IS the
 *    existing check. Activation calls `startChallenge` and `attempt` and gets
 *    the approved-set guard, the ADR A-08 comparison against PMS-held values,
 *    constant-time matching, the verification event and its vault event.
 *    Re-implementing any of that here would be a second place for the Medicare
 *    rule to be got wrong (hard rule 1).
 *  - `EnduringModule`, because FR-5.3's two BUSINESS days is already computed
 *    there against the practice's own state calendar, public holidays and all,
 *    and records which dataset produced the date. A portal-local "+2 weekdays"
 *    would be a second answer to a question with a statutory effect.
 *  - `RenderModule`, because rule 13 says the artefact is re-rendered under the
 *    version recorded on the agreement and the hash re-verified before display.
 *    The registry is the only thing that knows which renderer that is.
 *
 * `ReviewTasksModule` IS NOT LISTED because it is `@Global()` — correction
 * requests and terminations both raise tasks that land on the practice's own
 * queue.
 *
 * THE AUTHENTICATOR IS INJECTED, not called directly, so FR-8.2's passkey half
 * has a named place to arrive. See `portal-authenticator.ts`: wiring Keycloak
 * touches auth flows and needs Carl's go (CLAUDE.md §7), and nothing here does
 * it.
 */
@Module({
  imports: [VerificationModule, EnduringModule, RenderModule],
  controllers: [PortalController, PortalInvitationController, PortalDevController],
  providers: [
    PortalScope,
    PortalService,
    PortalReadsService,
    { provide: PORTAL_AUTHENTICATOR, useClass: ThreeIdentifierBootstrapAuthenticator },
  ],
  exports: [PortalService],
})
export class PortalModule {}
