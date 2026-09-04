import { Injectable } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { PortalRelyingParty } from './portal-passkey-config';

/**
 * THE FOUR CRYPTOGRAPHIC PRIMITIVES, BEHIND ONE INTERFACE.
 *
 * WHY A SEAM RATHER THAN CALLING THE LIBRARY DIRECTLY. Two reasons, and the
 * second is the important one.
 *
 * The first is testability. Everything about this feature that can be got
 * WRONG is ours, not the library's: whether a challenge is spent, whether it
 * has expired, whether a registration challenge can be presented to the sign-in
 * verifier, whether a counter that went backwards is refused, whether one
 * account's credential can open another's record. None of that is a signature
 * check. Testing it end to end through a real authenticator would mean building
 * a software authenticator in the e2e suite — a large amount of code whose bugs
 * would look like ours — and the payoff would be re-testing
 * `@simplewebauthn/server`'s own test suite. With this interface the e2e suite
 * overrides one provider and every rule above is exercised for real, against
 * real Postgres, real RLS and the real service.
 *
 * The second is that a cryptographic dependency in an authentication path
 * should be replaceable without touching the authentication logic. This regime
 * runs to 2027 and beyond; WebAuthn libraries are not forever. One file
 * imports `@simplewebauthn/server` and one file would change.
 *
 * WHAT THE SEAM DELIBERATELY DOES NOT DO. It does not decide anything. It has
 * no access to the database, it stores nothing, and it never says whether a
 * sign-in should be allowed — it answers "did these bytes verify, and what
 * counter did the authenticator report". Every policy question is next door in
 * `PortalPasskeyService`, where it can be read in one sitting.
 *
 * NO NETWORK CALLS AT RUNTIME. `@simplewebauthn/server` reaches the network
 * only through its optional FIDO Metadata Service, which nothing here touches
 * (D-2026-09-04-02). Attestation is `none`: we are not deciding which models of
 * phone a patient may own.
 */

export const PORTAL_WEBAUTHN = Symbol('PORTAL_WEBAUTHN');

/** A credential as the verifier needs it. Public key, id and counter — nothing else. */
export interface PortalStoredCredential {
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: readonly string[];
}

export interface PortalRegistrationVerification {
  readonly verified: boolean;
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: readonly string[];
  /** Authenticator MODEL id. A device type, never a device instance. */
  readonly aaguid: string;
}

export interface PortalAuthenticationVerification {
  readonly verified: boolean;
  /**
   * What the authenticator says its counter is NOW. The comparison against the
   * stored value is the service's decision, not this interface's — a seam that
   * refused on its own would be a policy hidden inside a crypto helper.
   */
  readonly newCounter: number;
}

export interface PortalWebAuthn {
  registrationOptions(input: {
    readonly rp: PortalRelyingParty;
    /** The WebAuthn user handle. The account id — never a name, never an email. */
    readonly accountId: string;
    /** Credentials this account already has, so the same device is not enrolled twice. */
    readonly excludeCredentialIds: readonly string[];
  }): Promise<Record<string, unknown>>;

  verifyRegistration(input: {
    readonly rp: PortalRelyingParty;
    readonly expectedChallenge: string;
    readonly response: Record<string, unknown>;
  }): Promise<PortalRegistrationVerification>;

  authenticationOptions(input: { readonly rp: PortalRelyingParty }): Promise<Record<string, unknown>>;

  verifyAuthentication(input: {
    readonly rp: PortalRelyingParty;
    readonly expectedChallenge: string;
    readonly response: Record<string, unknown>;
    readonly credential: PortalStoredCredential;
  }): Promise<PortalAuthenticationVerification>;
}

/**
 * The real one. A thin translation and nothing else — if a method here starts
 * making a decision, it belongs in the service.
 */
@Injectable()
export class SimpleWebAuthnAdapter implements PortalWebAuthn {
  async registrationOptions(input: {
    rp: PortalRelyingParty;
    accountId: string;
    excludeCredentialIds: readonly string[];
  }): Promise<Record<string, unknown>> {
    const options = await generateRegistrationOptions({
      rpName: input.rp.rpName,
      rpID: input.rp.rpID,
      /*
       * THE USER HANDLE AND USER NAME ARE BOTH THE ACCOUNT ID, and that is a
       * privacy decision rather than laziness. WebAuthn's `userName` is shown
       * by the patient's own passkey manager and is stored on their device, so
       * putting a name, an email or a mobile there would copy patient identity
       * out of our encrypted store and into a keychain we do not control. The
       * portal account holds none of those anyway (by design — the practice's
       * patient row is the master), so the honest value is the opaque id. What
       * the patient actually reads in the prompt is `rpName`.
       */
      userName: input.accountId,
      userID: new Uint8Array(Buffer.from(input.accountId, 'utf8')),
      /*
       * `residentKey: 'required'` IS WHAT MAKES SIGN-IN POSSIBLE WITHOUT A
       * USERNAME. A discoverable credential lets the patient tap "sign in with
       * a passkey" and have the phone offer the right one. The alternative
       * would be asking a patient for an identifier before they are signed in,
       * which is the thing this whole design avoids.
       *
       * `userVerification: 'preferred'` rather than 'required': the face,
       * fingerprint or PIN is asked for on every mainstream platform
       * authenticator anyway, and REQUIRING it turns an older hardware key into
       * a support call for no gain against the threat that matters here — a
       * forwarded link on a shared family phone, which the bootstrap already
       * handles.
       */
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      /*
       * ATTESTATION `none`. We are not in the business of deciding which models
       * of phone a patient may own, and an attestation statement is an
       * identifier for the device that produced it. Asking for one would collect
       * something we would then have to justify holding.
       */
      attestationType: 'none',
      excludeCredentials: input.excludeCredentialIds.map((id) => ({ id })),
    });
    return options as unknown as Record<string, unknown>;
  }

  async verifyRegistration(input: {
    rp: PortalRelyingParty;
    expectedChallenge: string;
    response: Record<string, unknown>;
  }): Promise<PortalRegistrationVerification> {
    const verification = await verifyRegistrationResponse({
      response: input.response as never,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: [...input.rp.origins],
      expectedRPID: input.rp.rpID,
      // Matches the 'preferred' asked for above. The counter, the origin and
      // the RP ID are what actually bind this credential to us.
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false, credentialId: '', publicKey: new Uint8Array(), counter: 0, transports: [], aaguid: '' };
    }

    const { credential, aaguid } = verification.registrationInfo;
    return {
      verified: true,
      credentialId: credential.id,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      aaguid,
    };
  }

  async authenticationOptions(input: { rp: PortalRelyingParty }): Promise<Record<string, unknown>> {
    const options = await generateAuthenticationOptions({
      rpID: input.rp.rpID,
      /*
       * NO `allowCredentials`, AND THAT IS THE POINT. Listing an account's
       * credentials would mean knowing which account is signing in before they
       * have signed in — which would mean asking for an identifier first, and
       * would also turn this endpoint into an oracle for "does this person have
       * an account here". Discoverable credentials let the phone answer.
       */
      userVerification: 'preferred',
    });
    return options as unknown as Record<string, unknown>;
  }

  async verifyAuthentication(input: {
    rp: PortalRelyingParty;
    expectedChallenge: string;
    response: Record<string, unknown>;
    credential: PortalStoredCredential;
  }): Promise<PortalAuthenticationVerification> {
    /*
     * COPIED INTO A FRESH BUFFER RATHER THAN CAST. The library's type is
     * `Uint8Array<ArrayBuffer>` and a view over a `SharedArrayBuffer` is not
     * that; a Prisma `Bytes` column arrives as the wider `ArrayBufferLike`. A
     * cast would silence the compiler about a real distinction — a copy is a few
     * dozen bytes and is correct whatever the caller handed us.
     */
    const publicKey = new Uint8Array(input.credential.publicKey.length);
    publicKey.set(input.credential.publicKey);

    const verification = await verifyAuthenticationResponse({
      response: input.response as never,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: [...input.rp.origins],
      expectedRPID: input.rp.rpID,
      credential: {
        id: input.credential.credentialId,
        publicKey,
        counter: input.credential.counter,
        transports: input.credential.transports as never,
      },
      requireUserVerification: false,
    });

    return {
      verified: verification.verified,
      newCounter: verification.authenticationInfo.newCounter,
    };
  }
}
