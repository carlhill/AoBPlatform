import { Module } from '@nestjs/common';
import { VerificationModule } from '../verification/verification.module';
import { EnduringModule } from '../enduring/enduring.module';
import { RenderModule } from '../render/render.module';
import { PortalController } from './portal.controller';
import { PortalInvitationController } from './portal-invitation.controller';
import { PortalDevController } from './portal-dev.controller';
import { PortalPasskeyController } from './portal-passkey.controller';
import { PortalService } from './portal.service';
import { PortalReadsService } from './portal-reads.service';
import { PortalPasskeyService } from './portal-passkey.service';
import { PortalScope } from './portal-scope';
import { PORTAL_AUTHENTICATOR, ThreeIdentifierBootstrapAuthenticator } from './portal-authenticator';
import { PORTAL_WEBAUTHN, SimpleWebAuthnAdapter } from './portal-webauthn';

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
 * FR-8.2's PASSKEY HALF LANDED ON 4 SEPTEMBER 2026 (Carl: "Implement";
 * D-2026-09-04-02) — `PortalPasskeyController` and `PortalPasskeyService`, with
 * `@simplewebauthn/server` behind the `PORTAL_WEBAUTHN` seam. IT IS NOT
 * KEYCLOAK, and that was the decision rather than an omission: patients are not
 * staff, the portal already owns the account and the session, and the thing
 * that binds a credential to a verified person is the three-identifier
 * bootstrap this module performs. A second realm for patients would put patient
 * PII in Keycloak for no gain.
 *
 * `PORTAL_WEBAUTHN` IS A SEAM FOR THE SAME REASON `PORTAL_AUTHENTICATOR` IS.
 * Everything about passkeys that can be got wrong — challenge single use,
 * expiry, purpose, counter regression, cross-account isolation — is ours, not
 * the library's. Overriding one provider lets the e2e suite exercise all of it
 * against real Postgres and real RLS without building a software authenticator
 * whose own bugs would look like ours.
 *
 * THE BOOTSTRAP AUTHENTICATOR IS UNCHANGED, deliberately. See the long note in
 * `portal-authenticator.ts`: gating the identifier path behind an enrolled
 * passkey would lock out the patient who lost the phone, and REQ-PORT-08 says
 * the portal is never a precondition of anything.
 */
@Module({
  imports: [VerificationModule, EnduringModule, RenderModule],
  controllers: [PortalController, PortalInvitationController, PortalDevController, PortalPasskeyController],
  providers: [
    PortalScope,
    PortalService,
    PortalReadsService,
    PortalPasskeyService,
    { provide: PORTAL_AUTHENTICATOR, useClass: ThreeIdentifierBootstrapAuthenticator },
    { provide: PORTAL_WEBAUTHN, useClass: SimpleWebAuthnAdapter },
  ],
  exports: [PortalService, PortalPasskeyService],
})
export class PortalModule {}
