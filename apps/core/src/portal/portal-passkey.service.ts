import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PORTAL_PASSKEY_CHALLENGE_MINUTES,
  type PortalPasskey,
  type PortalPasskeyChallenge,
  type PortalPasskeyRegistrationResult,
  type PortalPasskeyRevocationResult,
  type PortalPasskeySignInResult,
} from '@aobplatform/contracts';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PortalScope } from './portal-scope';
import { PortalService } from './portal.service';
import { portalRelyingParty } from './portal-passkey-config';
import { PortalPasskeyAttemptLimit } from './portal-passkey-rate-limit';
import { PORTAL_WEBAUTHN, type PortalWebAuthn } from './portal-webauthn';

/**
 * FR-8.2's PASSKEY HALF — "Implement" (Carl, 4 September 2026). D-2026-09-04-02.
 *
 * FOUR RULES SHAPE EVERY METHOD BELOW, and they are the ones to read before
 * changing anything here.
 *
 *  1. THE BOOTSTRAP COMES FIRST, ALWAYS. Registration is reachable only inside
 *     a live portal session — one issued by the three-identifier check against
 *     a practice that verified the patient across its own counter, or by a
 *     passkey that was itself enrolled that way. A credential enrolled without
 *     that is bound to whoever was holding the phone, which is the family-phone
 *     failure (REQ-VUL, addendum v4) with a cryptographic key on the end of it.
 *     `passkey_registration_requires_a_bootstrapped_session` is the named test.
 *  2. A CHALLENGE IS SPENT ONCE. Single use is enforced by a conditional
 *     UPDATE, not by a read-then-write: two requests racing on one challenge
 *     produce one winner and one refusal. Five minutes on top, which is the
 *     belt to that braces. `passkey_challenge_cannot_be_replayed`.
 *  3. A COUNTER THAT GOES BACKWARDS IS A CLONED AUTHENTICATOR. The signature
 *     verifies — that is what makes it worth refusing. We refuse, we write
 *     `portal.passkey_rejected`, and we do NOT update the stored counter.
 *     `passkey_counter_regression_is_refused`.
 *  4. NONE OF IT IS EVER A PRECONDITION (REQ-PORT-08). Revoking the last
 *     passkey is allowed. Losing every device costs a fresh invitation at the
 *     practice and nothing else, because signing an agreement has never
 *     required this page.
 *
 * WHAT IS DELIBERATELY NOT HERE. No password path and no recovery question
 * (hard rule 15 is about practitioners and admins; a patient portal with a
 * password would be worse than that rule contemplates, not exempt from it). No
 * Keycloak (D-2026-09-04-02). No identifier values anywhere: a credential row
 * holds a public key, a counter, a transport hint, a device MODEL id and — if
 * the patient typed one — their own word for their own phone.
 */
@Injectable()
export class PortalPasskeyService {
  /** See `portal-passkey-rate-limit.ts` — in memory, per process, and TODO Redis. */
  private readonly limiter = new PortalPasskeyAttemptLimit();

  constructor(
    private readonly scope: PortalScope,
    private readonly portal: PortalService,
    @Inject(PORTAL_WEBAUTHN) private readonly webauthn: PortalWebAuthn,
  ) {}

  // -------------------------------------------------------------------------
  // Registration — only ever inside a live session
  // -------------------------------------------------------------------------

  /**
   * `POST /portal/passkeys/registration/options`.
   *
   * THE CALLER MUST ALREADY BE SIGNED IN, and the controller has proved it
   * before this is reached — `accountId` and `sessionId` here came from the
   * cookie, never from a body. The challenge is bound to BOTH, so a
   * registration begun in one session cannot be finished in another, or after
   * the patient signed out.
   *
   * ALREADY-ENROLLED CREDENTIALS ARE EXCLUDED, so a patient who taps "add a
   * passkey" twice on the same phone is told by their own browser that it is
   * already there, rather than quietly accumulating duplicates that all say
   * "iPhone" in the list.
   */
  async registrationOptions(accountId: string, sessionId: string): Promise<PortalPasskeyChallenge> {
    const existing = await this.scope.withAccount(accountId, (tx) =>
      tx.portalCredential.findMany({
        where: { accountId, revokedAt: null },
        select: { credentialId: true },
      }),
    );

    const options = await this.webauthn.registrationOptions({
      rp: portalRelyingParty(),
      accountId,
      excludeCredentialIds: existing.map((row) => row.credentialId),
    });

    const challengeId = await this.storeChallenge({
      purpose: 'registration',
      challenge: String(options.challenge),
      accountId,
      sessionId,
    });

    return { challengeId, options };
  }

  /**
   * `POST /portal/passkeys/registration/verify`.
   *
   * ORDER: spend the challenge, THEN verify. A challenge that is verified first
   * and spent afterwards is a challenge that can be replayed while the first
   * verification is still running — the window is small and the property is
   * absolute, so it is bought in the cheap direction.
   */
  async verifyRegistration(input: {
    accountId: string;
    sessionId: string;
    challengeId: string;
    response: Record<string, unknown>;
    label?: string;
  }): Promise<PortalPasskeyRegistrationResult> {
    const challenge = await this.spendChallenge(input.challengeId, 'registration');

    /*
     * THE CHALLENGE MUST BELONG TO THIS SESSION, not merely to this account.
     * Binding to the account alone would let a challenge minted in a session
     * that has since been revoked still enrol a credential — which is exactly
     * the state a patient creates when they sign out because they think
     * something is wrong.
     */
    if (challenge.accountId !== input.accountId || challenge.sessionId !== input.sessionId) {
      throw new UnauthorizedException('Start again from your own record.');
    }

    const verification = await this.webauthn
      .verifyRegistration({
        rp: portalRelyingParty(),
        expectedChallenge: challenge.challenge,
        response: input.response,
      })
      .catch(() => null);

    if (!verification || !verification.verified) {
      // No event: a registration that did not verify is a browser or a device
      // saying no, not an act on a patient's record.
      throw new BadRequestException('That passkey could not be set up. Please try again.');
    }

    /*
     * A LABEL IS THE PATIENT'S OWN WORDS OR IT IS NOTHING. Never derived from a
     * user agent — a device fingerprint is not made acceptable by being
     * displayed as a convenience. Trimmed, capped, and null when blank, which
     * the DB check also insists on.
     */
    const label = input.label?.trim().slice(0, 60) || null;
    const passkeyId = randomUUID();

    await this.scope.withAccount(input.accountId, async (tx) => {
      await tx.portalCredential.create({
        data: {
          id: passkeyId,
          accountId: input.accountId,
          credentialId: verification.credentialId,
          publicKey: Buffer.from(verification.publicKey),
          counter: BigInt(verification.counter),
          transports: [...verification.transports],
          aaguid: verification.aaguid,
          label,
        },
      });

      /*
       * THE EVENT CARRIES NO CREDENTIAL ID, NO PUBLIC KEY AND NO LABEL. What is
       * evidential is that an authentication factor was added to this account,
       * from a session whose own `portal.activated` or `portal.passkey_signed_in`
       * event sits earlier in the same chain — so "which verified session bound
       * this credential" is answerable without any of the above (REQ-LOG-08).
       */
      await enqueueVaultEvent(tx, {
        type: 'portal.passkey_registered',
        actor: { principalType: 'patient', id: input.accountId },
        subject: { type: 'PortalCredential', id: passkeyId },
        payload: {
          // A device MODEL, never a device. Blank when the authenticator gave none.
          authenticatorModel: verification.aaguid,
          transports: [...verification.transports].sort().join(','),
          labelled: label !== null,
          sessionId: input.sessionId,
        },
      });
    });

    const [passkey] = await this.list(input.accountId, passkeyId);
    return { registered: true, passkey };
  }

  // -------------------------------------------------------------------------
  // Sign-in — no session, no username
  // -------------------------------------------------------------------------

  /**
   * `POST /portal/passkeys/authentication/options`.
   *
   * NOBODY IS NAMED, AND NOTHING IS LOOKED UP. The options carry a challenge
   * and an RP ID and no credential list at all (see `portal-webauthn.ts`), so
   * this endpoint cannot be used to ask "does this person have an account
   * here" — there is nothing to ask it about.
   */
  async authenticationOptions(clientKey: string): Promise<PortalPasskeyChallenge> {
    this.refuseIfLockedOut(clientKey);

    const options = await this.webauthn.authenticationOptions({ rp: portalRelyingParty() });
    const challengeId = await this.storeChallenge({
      purpose: 'authentication',
      challenge: String(options.challenge),
      accountId: null,
      sessionId: null,
    });

    return { challengeId, options };
  }

  /**
   * `POST /portal/passkeys/authentication/verify` — the sign-in itself.
   *
   * EVERY REFUSAL BELOW IS THE SAME SENTENCE AND THE SAME STATUS. A caller
   * learns nothing about whether the credential existed, whether it was
   * revoked, whether the challenge was stale or whether the signature was
   * wrong — the same discipline `PortalService.activate` applies to the
   * bootstrap, and for the same reason (REQ-SEC-07).
   */
  async signIn(input: {
    clientKey: string;
    challengeId: string;
    response: Record<string, unknown>;
  }): Promise<{ result: PortalPasskeySignInResult; sessionId: string }> {
    this.refuseIfLockedOut(input.clientKey);

    const refuse = (): never => {
      this.limiter.recordFailure(input.clientKey);
      throw new UnauthorizedException('That did not work. Please try again.');
    };

    const challenge = await this.spendChallenge(input.challengeId, 'authentication').catch(() => null);
    if (!challenge) return refuse();

    /*
     * THE CREDENTIAL ID IS THE ONLY THING THE BROWSER SENDS THAT NAMES ANYBODY,
     * and it is resolved under its own RLS scope (`withCredential`) because
     * there is no account yet. Shape-checked first: the value is interpolated
     * into a `set_config`, and a malformed one must be a 401 rather than a
     * database error with a query in it — the same care `readPortalCookie`
     * takes with the session id.
     */
    const credentialId = typeof input.response.id === 'string' ? input.response.id : '';
    if (!/^[A-Za-z0-9_-]{16,1024}$/.test(credentialId)) return refuse();

    const stored = await this.scope.withCredential(credentialId, (tx) =>
      tx.portalCredential.findFirst({ where: { credentialId } }),
    );
    if (!stored || stored.revokedAt) return refuse();

    const verification = await this.webauthn
      .verifyAuthentication({
        rp: portalRelyingParty(),
        expectedChallenge: challenge.challenge,
        response: input.response,
        credential: {
          credentialId: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: Number(stored.counter),
          transports: stored.transports,
        },
      })
      .catch(() => null);

    if (!verification || !verification.verified) return refuse();

    /*
     * THE COUNTER REGRESSION CHECK — RULE 3, AND THE ONLY REFUSAL HERE THAT
     * WRITES AN EVENT.
     *
     * The signature verified. That is precisely what makes this worth
     * refusing: a valid signature whose counter has gone BACKWARDS or stood
     * still after having moved is the signature of a cloned authenticator, and
     * it is the one event in this whole feature that says somebody may be
     * attacking a patient rather than using their phone.
     *
     * `stored.counter > 0` GUARDS THE COMMON CASE. Most platform authenticators
     * (Apple, Google, Windows Hello on a synced credential) pin their counter
     * at zero forever, precisely because a synced passkey lives on several
     * devices and an increasing counter would be meaningless. Refusing "no
     * increase" would refuse every iPhone; refusing "went backwards, having
     * previously moved" refuses a clone. The stored counter is NOT updated on
     * this path — a rejected assertion must not be able to advance the state it
     * was rejected against.
     */
    if (Number(stored.counter) > 0 && verification.newCounter <= Number(stored.counter)) {
      await this.scope.withAccount(stored.accountId, async (tx) => {
        await enqueueVaultEvent(tx, {
          type: 'portal.passkey_rejected',
          actor: { principalType: 'patient', id: stored.accountId },
          subject: { type: 'PortalCredential', id: stored.id },
          payload: {
            reason: 'counter_regression',
            storedCounter: Number(stored.counter),
            presentedCounter: verification.newCounter,
          },
        });
      });
      return refuse();
    }

    const sessionId = await this.portal.issueSession(stored.accountId, 'passkey');

    await this.scope.withAccount(stored.accountId, async (tx) => {
      await tx.portalCredential.update({
        where: { id: stored.id },
        data: { counter: BigInt(verification.newCounter), lastUsedAt: new Date() },
      });
      /*
       * BESIDE `portal.accessed`, NOT INSTEAD OF IT. `issueSession` writes the
       * access event every session gets, whatever door it came through; this
       * one says WHICH door, which is the question an auditor asks about a
       * session that preceded a disputed act.
       */
      await enqueueVaultEvent(tx, {
        type: 'portal.passkey_signed_in',
        actor: { principalType: 'patient', id: stored.accountId },
        subject: { type: 'PortalCredential', id: stored.id },
        payload: { sessionId, counter: verification.newCounter },
      });
    });

    this.limiter.clear(input.clientKey);
    const links = await this.portal.linksFor(stored.accountId);
    return { result: { signedIn: true, accountId: stored.accountId, links }, sessionId };
  }

  // -------------------------------------------------------------------------
  // The list, and taking one away
  // -------------------------------------------------------------------------

  /**
   * `GET /portal/passkeys`. Revoked credentials are not listed — the patient
   * asked for them to be gone, and a list that still showed them would read as
   * "we did not do it". The row survives (`revokedAt`) because the HISTORY is
   * evidence; the list is not the history.
   */
  async list(accountId: string, onlyId?: string): Promise<PortalPasskey[]> {
    const rows = await this.scope.withAccount(accountId, (tx) =>
      tx.portalCredential.findMany({
        where: { accountId, revokedAt: null, ...(onlyId ? { id: onlyId } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /**
   * `POST /portal/passkeys/:id/revoke`.
   *
   * REVOKING THE LAST ONE IS ALLOWED, and that is REQ-PORT-08 rather than an
   * oversight. The portal is never a precondition of anything: a patient who
   * wants every credential off a phone they are selling should not have to keep
   * one to be permitted to remove the others. If they later want back in, the
   * practice mints a fresh invitation and the three-identifier bootstrap runs
   * again — the same door they came in through.
   *
   * The result says whether that was the last one so the screen can SAY so
   * before the patient taps, not so it can refuse.
   */
  async revoke(accountId: string, passkeyId: string): Promise<PortalPasskeyRevocationResult> {
    return this.scope.withAccount(accountId, async (tx) => {
      /*
       * SCOPED BY ACCOUNT AS WELL AS BY ID. RLS would already refuse another
       * account's row, but a 404 from the application layer is the answer a
       * caller should get, and "the fence caught it" is not a design.
       */
      const updated = await tx.portalCredential.updateMany({
        where: { id: passkeyId, accountId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (updated.count === 0) throw new NotFoundException('That passkey is not on your account.');

      const remaining = await tx.portalCredential.count({ where: { accountId, revokedAt: null } });

      await enqueueVaultEvent(tx, {
        type: 'portal.passkey_revoked',
        actor: { principalType: 'patient', id: accountId },
        subject: { type: 'PortalCredential', id: passkeyId },
        payload: { remaining, lastOne: remaining === 0 },
      });

      return { revoked: true as const, passkeyId, noPasskeysRemain: remaining === 0 };
    });
  }

  // -------------------------------------------------------------------------
  // Challenges
  // -------------------------------------------------------------------------

  private async storeChallenge(input: {
    purpose: 'registration' | 'authentication';
    challenge: string;
    accountId: string | null;
    sessionId: string | null;
  }): Promise<string> {
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + PORTAL_PASSKEY_CHALLENGE_MINUTES * 60_000);

    await this.scope.withChallenge(challengeId, (tx) =>
      tx.portalPasskeyChallenge.create({
        data: {
          id: challengeId,
          purpose: input.purpose,
          challenge: input.challenge,
          accountId: input.accountId,
          sessionId: input.sessionId,
          expiresAt,
        },
      }),
    );

    return challengeId;
  }

  /**
   * SPEND ONE CHALLENGE, OR REFUSE — the single-use property, bought with a
   * conditional update rather than a read followed by a write.
   *
   * `updateMany` WITH `consumedAt: null` IN THE WHERE CLAUSE IS THE WHOLE
   * MECHANISM. Postgres serialises the two writers; the loser updates zero rows
   * and is refused. A read-then-write would let two concurrent verifications of
   * the same captured challenge both pass, which is the replay this exists to
   * stop.
   *
   * EXPIRY IS CHECKED IN THE SAME PREDICATE, so a challenge cannot be spent one
   * millisecond after it died because the read happened first.
   */
  private async spendChallenge(
    challengeId: string,
    purpose: 'registration' | 'authentication',
  ): Promise<{ challenge: string; accountId: string | null; sessionId: string | null }> {
    if (!/^[0-9a-f-]{36}$/i.test(challengeId)) {
      throw new UnauthorizedException('Start again — that request has expired.');
    }

    return this.scope.withChallenge(challengeId, async (tx) => {
      const spent = await tx.portalPasskeyChallenge.updateMany({
        where: { id: challengeId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (spent.count === 0) {
        // One sentence for used, expired, wrong purpose and never existed. A
        // caller learns which only by being the person who made it.
        throw new UnauthorizedException('Start again — that request has expired.');
      }

      const row = await tx.portalPasskeyChallenge.findFirst({ where: { id: challengeId } });
      if (!row) throw new UnauthorizedException('Start again — that request has expired.');
      return { challenge: row.challenge, accountId: row.accountId, sessionId: row.sessionId };
    });
  }

  private refuseIfLockedOut(clientKey: string): void {
    if (!this.limiter.isLockedOut(clientKey)) return;
    // 429 with a wait, and never a lockout that outlives the window. Nothing
    // about this blocks care (hard rule 8) or signing (REQ-PORT-08).
    throw new HttpException(
      `Too many attempts. Try again in ${this.limiter.retryAfterSeconds(clientKey)} seconds.`,
      429,
    );
  }

  /** Test seam, so one suite's failures do not lock out the next. */
  resetRateLimit(): void {
    this.limiter.reset();
  }
}
