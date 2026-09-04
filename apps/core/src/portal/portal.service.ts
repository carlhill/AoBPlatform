import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PORTAL_ACTIVATION_MAX_ATTEMPTS,
  PORTAL_SESSION_MINUTES,
  type PortalActivationResult,
  type PortalInvitationResult,
  type PortalLink,
  type PortalSession,
} from '@aobplatform/contracts';
import { assertValidIdentifierSet, IdentifierSetError } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { PortalScope } from './portal-scope';
import {
  PORTAL_ACTIVATION_EXPIRY_HOURS,
  mintPortalActivationToken,
  parsePortalActivationToken,
} from './portal-token';
import { PORTAL_AUTHENTICATOR, type PortalAuthenticator } from './portal-authenticator';
import { PortalInvitationDispatcher } from './portal-invitation.dispatcher';

/**
 * WHO THE PATIENT IS, AND WHAT THEY MAY SEE — the identity half of C8.
 *
 * The reads live next door in `PortalReadsService`; everything about proving a
 * person and holding a session is here, because it is the part with the
 * statutory exposure and it should be readable in one sitting.
 *
 * THREE RULES SHAPE ALL OF IT.
 *
 *  1. A TOKEN ALONE NEVER OPENS THE PORTAL. The invitation names an agreement;
 *     the three approved identifiers name the person. Both, or nothing. This is
 *     the family-phone rule (REQ-VUL, addendum v4): a parent and a 14+ child
 *     sharing one mobile must not be able to open each other's records by
 *     forwarding a message, and a message token stays single-purpose.
 *  2. THE PATIENT LINKS THEIR OWN PRACTICES. Each link comes from an agreement
 *     signed at that practice, after that practice verified them across its own
 *     counter. So the account is the hub, no practice learns another exists,
 *     and there is no cross-practice identifier anywhere in this file.
 *  3. NONE OF IT IS EVER A PRECONDITION OF SIGNING (REQ-PORT-08). Minting an
 *     invitation is offered after a completed signature and its failure is
 *     logged, never raised into the signing path.
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScope,
    private readonly verification: VerificationService,
    private readonly invitations: PortalInvitationDispatcher,
    @Inject(PORTAL_AUTHENTICATOR) private readonly authenticator: PortalAuthenticator,
  ) {}

  // -------------------------------------------------------------------------
  // FR-1.14 — the invitation
  // -------------------------------------------------------------------------

  /**
   * Mint one activation invitation for a signed agreement, and send it.
   *
   * ONLY FOR AN AGREEMENT THAT HAS BEEN SIGNED, and the reason is that the
   * invitation's whole authority comes from the verification that preceded the
   * signature. An invitation minted against a draft would be an offer to link a
   * record that nobody has yet proved belongs to the person holding it.
   *
   * THE TOKEN IS RETURNED ONCE AND NEVER AGAIN — only its hash is stored. Since
   * 4 September 2026 it is also DELIVERED: the message goes through the
   * outbound queue in this same transaction, composed from the versioned
   * template `portal_invitation_v1`, so an invitation is no longer a secret
   * that appeared once in an API response and was gone.
   *
   * THE ACCOUNT IS MINTED HERE, NOT AT ACTIVATION (Carl, 4 Sep 2026). The
   * record id `AoBPlatform-PatientId-<accountId>` is what a patient checks a
   * message, a page and a passkey against, and the check is worthless unless
   * the FIRST message quotes the id they will actually see. So the id exists
   * before the message does. LINKING STILL HAPPENS AT ACTIVATION and only
   * after the three-identifier check: the account row carries no patient data,
   * and an account with no `portal_account_patients` row can read nothing.
   *
   * ONE PATIENT, ONE ID. A second invitation reuses the account this patient
   * already has — from a live link, or from an earlier invitation — because two
   * messages quoting two different ids would be exactly the confusion the id
   * exists to remove.
   */
  async mintInvitation(
    practiceId: string,
    agreementId: string,
    mintedById: string,
  ): Promise<PortalInvitationResult> {
    const minted = mintPortalActivationToken(practiceId);
    const expiresAt = new Date(Date.now() + PORTAL_ACTIVATION_EXPIRY_HOURS * 3600_000);
    /*
     * RESERVED BEFORE THE TRANSACTION OPENS, because `portal_accounts` is
     * fenced on `app.portal_account_id` — a row may only be written by a
     * transaction that already names it. Discarded unhesitatingly below if
     * this patient already has an account.
     */
    const candidateAccountId = randomUUID();

    return this.scope.withAccountAtPractice(candidateAccountId, practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found in this practice.');
      if (!agreement.signatureEventId) {
        throw new BadRequestException(
          'A portal invitation is offered after a completed signature (FR-1.14). This agreement has not been signed.',
        );
      }

      /*
       * THE ID THIS PATIENT ALREADY HAS, if they have one: an activated link
       * first, then the most recent earlier invitation. Both are visible under
       * the practice key, and neither discloses anything about another
       * practice — the link row read here is this practice's own.
       */
      const existingLink = await tx.portalAccountPatient.findFirst({
        where: { patientId: agreement.patientId, practiceId },
        orderBy: { linkedAt: 'asc' },
      });
      const earlierInvitation = existingLink
        ? null
        : await tx.portalActivationToken.findFirst({
            where: { patientId: agreement.patientId, accountId: { not: null } },
            orderBy: { createdAt: 'desc' },
          });
      const accountId = existingLink?.accountId ?? earlierInvitation?.accountId ?? candidateAccountId;
      if (accountId === candidateAccountId) {
        await tx.portalAccount.create({ data: { id: accountId } });
      }

      const row = await tx.portalActivationToken.create({
        data: {
          practiceId,
          agreementId,
          patientId: agreement.patientId,
          accountId,
          tokenHash: minted.tokenHash,
          mintedById,
          expiresAt,
        },
      });

      /*
       * THE MESSAGE, IN THIS TRANSACTION. The enqueue writes its correspondence
       * twin beside it, so there is never an invitation nobody was told about
       * or a message with no invitation behind it. A patient with no email and
       * no mobile gets no message and the mint still succeeds — the portal is
       * never a precondition of anything (REQ-PORT-08).
       */
      const [practice, patient] = await Promise.all([
        tx.practice.findFirst({ where: { id: practiceId } }),
        tx.patient.findFirst({ where: { id: agreement.patientId } }),
      ]);
      let sent: { channel: string; templateKey: string } | null = null;
      if (practice && patient) {
        sent = await this.invitations.sendInvitation(tx, {
          practiceId,
          practiceName: practice.name,
          patient: {
            id: patient.id,
            givenNames: patient.givenNames,
            familyName: patient.familyName,
            email: patient.email,
            mobile: patient.mobile,
          },
          invitationId: row.id,
          accountId,
          token: minted.token,
          expiresAt,
        });
      }

      /*
       * THE EVENT CARRIES NO TOKEN, NO HASH AND NO CONTACT DETAIL. An outbox
       * row is not a secret store; what is evidential is that an invitation was
       * offered for this agreement, by whom, on which channel, under which
       * template version, and when it dies (REQ-LOG-08). The account id is the
       * patient's own record id and is not a patient detail.
       */
      await enqueueVaultEvent(tx, {
        type: 'portal.invitation_minted',
        actor: { principalType: mintedById === 'system' ? 'system' : 'staff', id: mintedById },
        subject: { type: 'Agreement', id: agreementId },
        payload: {
          invitationId: row.id,
          expiresAt: expiresAt.toISOString(),
          offered: true,
          accountId,
          deliveredBy: sent?.channel ?? 'none',
          ...(sent ? { templateKey: sent.templateKey } : {}),
        },
      });

      return {
        invitationId: row.id,
        agreementId,
        expiresAt: expiresAt.toISOString(),
        activationToken: minted.token,
      };
    });
  }

  // -------------------------------------------------------------------------
  // The activation itself
  // -------------------------------------------------------------------------

  /**
   * The token, plus three approved identifiers, against THAT agreement's
   * practice and patient.
   *
   * THE ORDER MATTERS AND IS NOT AN ACCIDENT. The token is resolved first
   * because it is what establishes the practice scope — but it discloses
   * nothing: every failure below returns the same refusal, so a caller holding
   * a stolen link learns neither whose it is nor whether they were close.
   *
   * `existingAccountId` IS THE SECOND-PRACTICE PATH. A patient who already has
   * a session and activates an invitation from another practice adds a link to
   * the account they are signed in to. Without it every practice would produce
   * a separate account and the hub would not be a hub.
   */
  async activate(input: {
    agreementId: string;
    activationToken: string;
    stated: Record<string, string>;
    existingAccountId: string | null;
  }): Promise<{ result: PortalActivationResult; sessionId: string }> {
    const parsed = parsePortalActivationToken(input.activationToken);
    if (!parsed) throw new NotFoundException('This invitation is not valid.');

    /*
     * HARD RULE 1, ENFORCED ON THE WAY IN AND NOT ONLY DEEPER DOWN.
     *
     * The challenge types come from the practice's configuration, so a
     * `medicare_number` key in `stated` would otherwise be silently IGNORED —
     * the check would pass on the three real identifiers and a client would
     * have learned that sending a card number is harmless. That is how a
     * "helpful" second factor gets added to a portal login six months later.
     * A card number offered as an identifier is refused outright, with the
     * domain's own words, before anything is compared.
     */
    try {
      assertValidIdentifierSet(Object.keys(input.stated));
    } catch (err) {
      if (err instanceof IdentifierSetError) throw new BadRequestException(err.message);
      throw err;
    }

    const invitation = await this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const row = await tx.portalActivationToken.findFirst({ where: { tokenHash: parsed.tokenHash } });
      if (!row) throw new NotFoundException('This invitation is not valid.');
      if (row.agreementId !== input.agreementId) {
        // The body named a different agreement from the one the token was
        // minted for. Same refusal as an unknown token — a probe learns nothing.
        throw new NotFoundException('This invitation is not valid.');
      }
      if (row.usedAt) throw new GoneException('This invitation has already been used.');
      if (row.lockedAt) {
        // 423 Locked: the invitation is locked, not the person and not the
        // practice's record. The patient can be re-invited at the counter.
        throw new HttpException('This invitation is locked. Ask the practice for a new one.', 423);
      }
      if (row.expiresAt < new Date()) throw new GoneException('This invitation has expired.');
      return row;
    });

    const identifierTypes = await this.verification.identifierTypesFor(parsed.practiceId);

    /*
     * THE CHECK ITSELF IS THE VERIFICATION MODULE'S, NOT A SECOND COPY.
     * `startChallenge` + `attempt` gives the whole existing apparatus: the
     * approved-set guard, the ADR A-08 comparison against PMS-held values where
     * the adapter allows, constant-time matching, the verification event, and
     * the vault event carrying TYPES and an outcome and never a value
     * (REQ-VER-04). A portal-local re-implementation would be a second place
     * for the Medicare rule to be got wrong.
     */
    const challenge = await this.verification.startChallenge(parsed.practiceId, {
      patientId: invitation.patientId,
      channel: 'portal',
      identifierTypes,
    });
    const outcome = await this.verification.attempt(parsed.practiceId, challenge.challengeId, {
      stated: input.stated,
    });

    if (outcome.outcome !== 'passed') {
      const attempts = invitation.attempts + 1;
      const locked = attempts >= PORTAL_ACTIVATION_MAX_ATTEMPTS;
      await this.prisma.withPractice(parsed.practiceId, (tx) =>
        tx.portalActivationToken.update({
          where: { id: invitation.id },
          data: { attempts, lockedAt: locked ? new Date() : null },
        }),
      );
      if (locked) throw new HttpException('This invitation is locked. Ask the practice for a new one.', 423);
      // The verification module's own generic message — never which identifier
      // failed, never how close (REQ-SEC-07).
      throw new UnauthorizedException(outcome.message ?? 'Some of those details do not match our records.');
    }

    /*
     * THE PASSKEY SEAM. Today the bootstrap satisfies it; when FR-8.2's passkey
     * half lands this is where a session is withheld until the assertion comes
     * back. Deliberately AFTER the identifier check: the bootstrap is what
     * BINDS a credential to a verified person, and a passkey enrolled before it
     * would be bound to whoever was holding the phone.
     */
    const authenticated = await this.authenticator.authenticate({
      accountId: input.existingAccountId,
      practiceId: parsed.practiceId,
      identifierTypes,
    });
    if (!authenticated.satisfied) {
      throw new ForbiddenException(authenticated.nextStepKey ?? 'portal_additional_factor_required');
    }

    /*
     * WHICH ACCOUNT THIS LINK JOINS, in the order that keeps the record id
     * true (Carl, 4 Sep 2026):
     *
     *  1. THE SIGNED-IN ACCOUNT WINS. A patient activating a second practice's
     *     invitation while already signed in is adding a practice to the hub
     *     they already have; sending them to the invitation's own account would
     *     split one person across two, and neither would hold everything.
     *  2. OTHERWISE THE ACCOUNT THE INVITATION NAMED — the one whose id the
     *     patient has been reading in our messages since the invitation went
     *     out. Its row already exists; only the LINK is new, and it is written
     *     here because this is the first moment three identifiers have passed.
     *  3. AND FOR AN INVITATION MINTED BEFORE ANY OF THIS EXISTED, the old
     *     behaviour: a fresh account, created below.
     */
    const preMintedAccountId = invitation.accountId ?? null;
    const accountId = input.existingAccountId ?? preMintedAccountId ?? randomUUID();
    const accountExists = input.existingAccountId !== null || preMintedAccountId !== null;
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PORTAL_SESSION_MINUTES * 60_000);

    /*
     * ONE TRANSACTION: the account, the link, the session and both vault events
     * (hard rule 11). A link with no record of the check that made it — or a
     * session with no link behind it — is precisely the evidence gap this
     * product exists to close. The account id is generated here rather than by
     * the database so the row can be written under its own RLS scope.
     */
    await this.scope.withAccountAtPractice(accountId, parsed.practiceId, async (tx) => {
      if (!accountExists) {
        await tx.portalAccount.create({ data: { id: accountId, lastSeenAt: now } });
      } else {
        await tx.portalAccount.update({ where: { id: accountId }, data: { lastSeenAt: now } });
      }

      /*
       * A SECOND ACTIVATION FROM THE SAME PRACTICE CHANGES NOTHING. The unique
       * key is (account, patient); re-activating is idempotent rather than an
       * error, because from the patient's side it is the same act done twice.
       */
      await tx.portalAccountPatient.upsert({
        where: { accountId_patientId: { accountId, patientId: invitation.patientId } },
        create: {
          accountId,
          patientId: invitation.patientId,
          practiceId: parsed.practiceId,
          linkedByAgreementId: invitation.agreementId,
        },
        update: {},
      });

      await tx.portalActivationToken.update({
        where: { id: invitation.id },
        data: { usedAt: now, attempts: invitation.attempts + 1 },
      });

      await tx.portalSession.create({ data: { id: sessionId, accountId, expiresAt } });

      await enqueueVaultEvent(tx, {
        type: 'portal.activated',
        actor: { principalType: 'patient', id: accountId },
        subject: { type: 'Agreement', id: invitation.agreementId },
        payload: {
          // TYPES, sorted so two identical checks compare equal, and a count.
          // Never a value, never the token (REQ-VER-04, REQ-LOG-08).
          identifierTypes: [...identifierTypes].sort().join(','),
          identifierTypeCount: identifierTypes.length,
          outcome: 'passed',
          channel: 'portal',
          authenticationMethod: authenticated.methodKey,
          firstPractice: input.existingAccountId === null,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'portal.accessed',
        actor: { principalType: 'patient', id: accountId },
        subject: { type: 'PortalSession', id: sessionId },
        payload: { reason: 'activation', expiresAt: expiresAt.toISOString() },
      });
    });

    const links = await this.linksFor(accountId);
    return { result: { activated: true, accountId, links }, sessionId };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * The cookie, resolved. Returns the account id or throws 401 — a caller never
   * learns whether a session id existed, expired or was revoked.
   */
  async accountForSession(sessionId: string | null): Promise<string> {
    if (!sessionId) throw new UnauthorizedException('Sign in to see your records.');
    const session = await this.scope.withSession(sessionId, (tx) =>
      tx.portalSession.findFirst({ where: { id: sessionId } }),
    );
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Sign in to see your records.');
    }
    return session.accountId;
  }

  /**
   * A session issued without an activation — the dev seam, and later the
   * passkey path. Writes the same `portal.accessed` event, because a session
   * that leaves no trace is exactly what the access log must not have.
   */
  async issueSession(accountId: string, reason: string): Promise<string> {
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PORTAL_SESSION_MINUTES * 60_000);
    await this.scope.withAccount(accountId, async (tx) => {
      await tx.portalSession.create({ data: { id: sessionId, accountId, expiresAt } });
      await tx.portalAccount.update({ where: { id: accountId }, data: { lastSeenAt: now } });
      await enqueueVaultEvent(tx, {
        type: 'portal.accessed',
        actor: { principalType: 'patient', id: accountId },
        subject: { type: 'PortalSession', id: sessionId },
        payload: { reason, expiresAt: expiresAt.toISOString() },
      });
    });
    return sessionId;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.scope.withSession(sessionId, (tx) =>
      tx.portalSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } }),
    );
  }

  // -------------------------------------------------------------------------
  // The links — the filter every read in this module runs through
  // -------------------------------------------------------------------------

  /**
   * The (practice, patient) pairs this account may see, with practice names.
   *
   * EVERY READ IN THE PORTAL STARTS HERE. There is no endpoint that takes a
   * practice id or a patient id from the caller and trusts it: the account's
   * own links are the entire universe of what it can ask about, which is what
   * makes cross-account access fail closed at the application layer as well as
   * at the RLS floor.
   */
  async linksFor(accountId: string): Promise<PortalLink[]> {
    const rows = await this.scope.withAccount(accountId, (tx) =>
      tx.portalAccountPatient.findMany({ where: { accountId }, orderBy: { linkedAt: 'asc' } }),
    );

    const links: PortalLink[] = [];
    for (const row of rows) {
      // Per link, under that practice's own scope — RLS stays the floor even
      // for a name (hard rule: practice scoping at the DB layer).
      const practice = await this.prisma.withPractice(row.practiceId, (tx) => tx.practice.findFirst({}));
      links.push({
        practiceId: row.practiceId,
        practiceName: practice?.name ?? 'This practice',
        patientId: row.patientId,
      });
    }
    return links;
  }

  async session(accountId: string): Promise<PortalSession> {
    return { accountId, links: await this.linksFor(accountId) };
  }

  /**
   * Resolve one link the caller named, or refuse.
   *
   * The one place a practice id from a request body is turned into something
   * trusted, and it is turned by looking it up in the account's own links.
   */
  async requireLink(accountId: string, practiceId: string): Promise<PortalLink> {
    const link = (await this.linksFor(accountId)).find((l) => l.practiceId === practiceId);
    if (!link) throw new NotFoundException('That practice is not linked to your account.');
    return link;
  }
}
