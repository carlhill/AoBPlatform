import { Injectable } from '@nestjs/common';

/**
 * WHERE THE PASSKEY GOES — a named seam, and deliberately nothing more.
 *
 * FR-8.2 says portal authentication is "passkey-first, with the three-identifier
 * bootstrap". Today only the bootstrap exists: a person proves three approved
 * identifiers against ONE practice's record and gets a thirty-minute session.
 * The passkey half is a FOLLOW-ON, because registering one touches auth flows
 * and the Keycloak realm — and CLAUDE.md §7 says ask before touching auth
 * flows. So nothing here talks to Keycloak, nothing here registers a
 * credential, and this file adds no dependency.
 *
 * WHY A SEAM AT ALL RATHER THAN NOTHING. The alternative was to write the
 * three-identifier check inline in the activation path and let a later passkey
 * change unpick it. That is how a bootstrap becomes the permanent front door:
 * once fifteen call sites assume "activation means identifiers", adding a
 * factor stops being a change and starts being a migration. One injected
 * interface with one implementation costs nothing now and is the difference
 * later.
 *
 * WHAT ACTUALLY HAPPENED, 4 SEPTEMBER 2026 (Carl: "Implement";
 * D-2026-09-04-02). The passkey half landed — `portal-passkey.service.ts`,
 * `portal-passkey.controller.ts`, `@simplewebauthn/server` behind the
 * `PORTAL_WEBAUTHN` seam — and IT DID NOT ARRIVE THROUGH THIS INTERFACE. That
 * is worth writing down, because the note above predicted it would.
 *
 * The prediction was that this authenticator would return `satisfied: false`
 * with `nextStepKey: 'passkey_required'` for an account that had enrolled one,
 * so the bootstrap alone would stop being enough. Building it made clear that
 * would be wrong. A patient who has enrolled a passkey and then lost, sold or
 * broken the phone would be locked out of the identifier path — the only path
 * that does not need the phone — and re-entry would depend on us noticing and
 * clearing a flag. REQ-PORT-08 says the portal is never a precondition of
 * anything; a second factor that can strand a patient behind a lost device is
 * exactly that, one layer down. So the two doors stay independent: three
 * approved identifiers against a practice's own record, or a signature from a
 * credential that door itself enrolled.
 *
 * WHAT THE SEAM IS STILL FOR. It is where a factor that must be satisfied
 * IN ADDITION to the identifier check would go — a practice-level policy, say,
 * or a step-up for an account flagged in a dispute. That is a real possibility
 * and it is not this one, so the interface stays and the implementation stays
 * honest about being the only one.
 *
 * WHAT THE BOOTSTRAP DOES FOR PASSKEYS, WHICH IS THE WHOLE POINT: registration
 * is reachable only INSIDE a live portal session. So every credential is
 * enrolled by somebody a practice verified across its own counter, and a
 * passkey enrolled before that check would be bound to whoever was holding the
 * phone. The bootstrap is not the fallback to the passkey; it is what makes the
 * passkey mean anything.
 *
 * WHAT IT MUST NEVER DO. No password path (hard rule 15 is about practitioners
 * and admins; a patient portal with a password would be worse, not exempt), and
 * no second identity interview — FR-1.14 is explicit that activation re-uses
 * the verification that has just passed.
 */
export const PORTAL_AUTHENTICATOR = Symbol('PORTAL_AUTHENTICATOR');

export interface PortalAuthenticationContext {
  /** The account being signed in to, or null when activation is creating one. */
  readonly accountId: string | null;
  /** The practice whose record the three-identifier check just passed against. */
  readonly practiceId: string;
  /** The identifier TYPES that were checked. Never their values. */
  readonly identifierTypes: readonly string[];
}

export interface PortalAuthenticationOutcome {
  /** May a session be issued now? */
  readonly satisfied: boolean;
  /** How the person was authenticated, as a key. Recorded on the vault event. */
  readonly methodKey: string;
  /** When not satisfied, what the client must do next. A key, never prose. */
  readonly nextStepKey: string | null;
}

export interface PortalAuthenticator {
  /**
   * Called AFTER the three-identifier check has passed and BEFORE a session is
   * issued. Returning `satisfied: false` withholds the session.
   */
  authenticate(context: PortalAuthenticationContext): Promise<PortalAuthenticationOutcome>;
}

/**
 * The only implementation today: the bootstrap IS the authentication.
 *
 * Named for what it is rather than `NoopAuthenticator`, because it is not a
 * no-op — three approved identifiers against a practice that verified the
 * person across its own counter is a real check, and it is the one REQ-PORT-08
 * and FR-1.14 describe. It is simply not the whole of FR-8.2 yet.
 */
@Injectable()
export class ThreeIdentifierBootstrapAuthenticator implements PortalAuthenticator {
  // The context is unread TODAY and the parameter stays: the passkey
  // implementation needs every field of it, and a seam whose signature has to
  // change to be used is not a seam.
  async authenticate(_context: PortalAuthenticationContext): Promise<PortalAuthenticationOutcome> {
    return {
      satisfied: true,
      // The types are already on the verification event; this key says which
      // FACTOR let the person in, which is the question a later passkey rollout
      // will want answered about every session issued before it.
      methodKey: 'three_identifier_bootstrap',
      nextStepKey: null,
    };
  }
}
