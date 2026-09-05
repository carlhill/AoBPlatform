import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PORTAL_ACTIVATION_MAX_ATTEMPTS,
  PORTAL_SESSION_MINUTES,
  type PortalActivationChallenge,
  type PortalActivationRefusalReason,
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
import { PortalActivationAttemptLimit } from './portal-activation-rate-limit';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';

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

  /**
   * The activation link's own window, shared by the challenge read and the
   * attempt. See `portal-activation-rate-limit.ts` — it stops a script
   * enumerating tokens; what stops guessing at identifiers is the three-attempt
   * lock on the invitation itself.
   */
  private readonly limiter = new PortalActivationAttemptLimit();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScope,
    private readonly verification: VerificationService,
    private readonly invitations: PortalInvitationDispatcher,
    /**
     * THE PRACTICE'S OWN QUEUE, ASKED RATHER THAN WRITTEN TO DIRECTLY
     * (CLAUDE.md §4). A locked activation raises a task there and a new
     * invitation closes it; `review_tasks` belongs to that module and this one
     * never touches the table. The module is `@Global()`, which is why
     * `PortalModule` imports nothing new for it.
     */
    private readonly reviewTasks: ReviewTasksService,
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
       * A NEW INVITATION IS THE WHOLE REMEDY FOR A LOCKED ONE (Carl, 5 Sep
       * 2026), so minting one closes the task that asked for it — in this
       * transaction, so there is never a live invitation with reception still
       * being told to send one.
       *
       * THE LOCKED TOKEN IS NOT TOUCHED AND STAYS DEAD. Superseding it means
       * this one exists, not that that one comes back: its `lockedAt` is set,
       * every activation against it is still a 423, and the count is per token
       * — so this invitation starts at three attempts, which is what makes a
       * re-invitation a remedy rather than a formality (named test
       * `activation_locks_after_three_failed_attempts`).
       */
      const reinvited = await this.reviewTasks.resolveReinvited(tx, {
        practiceId,
        patientId: agreement.patientId,
        by: mintedById,
        invitationId: row.id,
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
          // Whether this one replaced a locked invitation — a fact about the
          // invitation, not about the person or what they typed.
          ...(reinvited.length > 0 ? { replacesLockedInvitation: true } : {}),
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
  // FR-1.14 — what the page behind the link is allowed to know
  // -------------------------------------------------------------------------

  /**
   * `GET /portal/activate/:token/challenge` — which boxes to draw, and nothing
   * else.
   *
   * WHY THIS ENDPOINT HAS TO EXIST. The invitation is a link and the page
   * behind it must render the practice's OWN identifier set (REQ-VER-06, floor
   * of three): a page that guessed would ask a patient at one practice for an
   * IHI they were never verified on, and a page that asked for all six would be
   * a page that had quietly decided the configuration does not matter.
   *
   * WHAT IT REFUSES TO SAY. No name, no initials, no masked value, no patient
   * id, no agreement id. A stranger holding a forwarded link learns the
   * practice's name — which the message they were forwarded already said — and
   * WHICH KINDS of detail will be asked for, which the kiosk shows anybody
   * standing in a waiting room. Neither is a fact about a person. A masked
   * value would be, which is why there is no field here that could carry one.
   *
   * THE APPROVED-SET GUARD RUNS ON THE WAY OUT, NOT ONLY ON THE WAY IN
   * (hard rule 1, REQ-VER-02). The list comes from a practice row, and a
   * practice row is data; if one ever named a card number this answers with a
   * failure rather than with a screen that has a card-number box on it. Named
   * test: `activation_challenge_never_asks_for_a_medicare_number`.
   *
   * A DEAD LINK IS A 404 WITH A CODE, never a sentence and never a hint about
   * whose it was. The page maps the code to copy and to a next step — "ask your
   * practice for a new invitation" — because "something went wrong" on the one
   * screen a patient reached by following our own message is the generic
   * fallback the design principle calls a defect (Carl, 4 Sep 2026).
   */
  async activationChallenge(token: string, clientKey: string): Promise<PortalActivationChallenge> {
    this.assertNotRateLimited(clientKey);

    const parsed = parsePortalActivationToken(token);
    if (!parsed) throw this.refuseActivation('token_unknown', clientKey);

    const row = await this.prisma.withPractice(parsed.practiceId, (tx) =>
      tx.portalActivationToken.findFirst({ where: { tokenHash: parsed.tokenHash } }),
    );
    if (!row) throw this.refuseActivation('token_unknown', clientKey);
    if (row.lockedAt) throw this.refuseActivation('token_locked', clientKey);
    /*
     * USED AND EXPIRED ARE THE SAME ANSWER, on purpose. To the person holding
     * the link they are one fact — it no longer works, and the way back is a
     * fresh invitation. Distinguishing them would tell a stranger with a
     * forwarded message whether the patient has already made an account.
     */
    if (row.usedAt || row.expiresAt < new Date()) throw this.refuseActivation('token_expired', clientKey);

    const identifierTypes = await this.verification.identifierTypesFor(parsed.practiceId);
    try {
      assertValidIdentifierSet(identifierTypes);
    } catch (err) {
      if (err instanceof IdentifierSetError) {
        // NOT a refusal code the page maps to "ask for a new invitation": the
        // invitation is fine and the CONFIGURATION is not. Failing loudly is the
        // only honest answer — the alternative is drawing the field.
        this.logger.error(
          `Practice ${parsed.practiceId} has an identifier set that is not renderable: ${err.message}`,
        );
        throw new InternalServerErrorException('This invitation cannot be opened just now.');
      }
      throw err;
    }

    const practice = await this.prisma.withPractice(parsed.practiceId, (tx) => tx.practice.findFirst({}));

    return {
      identifierTypes,
      practiceName: practice?.name ?? 'This practice',
      expiresAt: row.expiresAt.toISOString(),
      attemptsRemaining: Math.max(0, PORTAL_ACTIVATION_MAX_ATTEMPTS - row.attempts),
    };
  }

  /**
   * A 404 CARRYING A CODE. `reason` is what the page maps to copy and a
   * destination; `message` exists for a developer reading a response body and
   * says nothing about anybody.
   *
   * EVERY REFUSAL COSTS THE CALLER A TICK OF THE WINDOW, which is the point of
   * the limiter on this route: an unknown token is exactly what enumeration
   * produces, and a patient re-opening their own valid link produces none.
   */
  private refuseActivation(reason: PortalActivationRefusalReason, clientKey: string): HttpException {
    this.limiter.recordFailure(clientKey);
    return new NotFoundException({ statusCode: 404, reason, message: 'This invitation cannot be opened.' });
  }

  private assertNotRateLimited(clientKey: string): void {
    if (!this.limiter.isLockedOut(clientKey)) return;
    throw new HttpException(
      `Too many attempts. Try again in ${this.limiter.retryAfterSeconds(clientKey)} seconds.`,
      429,
    );
  }

  /** Test seam, as on the passkey limiter. Nothing in the application calls it. */
  resetActivationRateLimit(): void {
    this.limiter.reset();
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
    /**
     * OPTIONAL. The activation page never learns one (see
     * `activationChallenge`); a caller that does send one has it checked
     * against the invitation row below.
     */
    agreementId?: string;
    activationToken: string;
    stated: Record<string, string>;
    existingAccountId: string | null;
    /**
     * The rate-limit key. `'unknown'` where a caller has no address — the
     * limiter is a brake on enumeration, never the thing that decides whether
     * an activation is allowed, so a missing address must not refuse anybody.
     */
    clientKey?: string;
  }): Promise<{ result: PortalActivationResult; sessionId: string }> {
    const clientKey = input.clientKey ?? 'unknown';
    this.assertNotRateLimited(clientKey);

    const parsed = parsePortalActivationToken(input.activationToken);
    if (!parsed) throw this.refuseActivation('token_unknown', clientKey);

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
      if (!row) throw this.refuseActivation('token_unknown', clientKey);
      if (input.agreementId !== undefined && row.agreementId !== input.agreementId) {
        // The body named a different agreement from the one the token was
        // minted for. Same refusal as an unknown token — a probe learns nothing.
        throw this.refuseActivation('token_unknown', clientKey);
      }
      /*
       * THE STATUS CODES ARE UNCHANGED AND THE BODIES NOW CARRY A `reason`.
       * 410 and 423 are what they always were; the code beside them is what
       * lets the activation page say the specific thing and offer the specific
       * next step rather than a generic apology (Carl, 4 Sep 2026 — "shortcuts
       * to the answer, not directions to a screen").
       */
      if (row.usedAt) {
        throw new GoneException({
          statusCode: 410,
          reason: 'token_expired' satisfies PortalActivationRefusalReason,
          message: 'This invitation has already been used.',
        });
      }
      if (row.lockedAt) {
        // 423 Locked: the invitation is locked, not the person and not the
        // practice's record. The patient can be re-invited at the counter.
        throw new HttpException(
          {
            statusCode: 423,
            reason: 'token_locked' satisfies PortalActivationRefusalReason,
            message: 'This invitation is locked. Ask the practice for a new one.',
          },
          423,
        );
      }
      if (row.expiresAt < new Date()) {
        throw new GoneException({
          statusCode: 410,
          reason: 'token_expired' satisfies PortalActivationRefusalReason,
          message: 'This invitation has expired.',
        });
      }
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
      await this.prisma.withPractice(parsed.practiceId, async (tx) => {
        /*
         * THE LOCK IS A ONE-TIME TRANSITION, AND THE UPDATE SAYS SO.
         * `lockedAt: null` in the WHERE is what makes it one: two requests
         * racing on the third attempt produce exactly one lock, one task and
         * one event, and the loser writes nothing. Before 5 September 2026
         * this was an unconditional update, which was harmless while nothing
         * hung off the transition and would not be now.
         */
        const { count } = await tx.portalActivationToken.updateMany({
          where: { id: invitation.id, ...(locked ? { lockedAt: null } : {}) },
          data: { attempts, ...(locked ? { lockedAt: new Date() } : {}) },
        });
        if (!locked || count === 0) return;

        /*
         * THE PRACTICE IS TOLD (Carl, 5 Sep 2026). Until now the lock was told
         * to the person who failed and to nobody else: the patient saw "ask
         * your practice for a new one" and the practice was never asked. A
         * remedy that only exists if the patient remembers to mention it at
         * their next visit is not a remedy.
         *
         * WHAT THE TASK MAY NOT SAY, AND DOES NOT. Not which identifier types
         * were offered, not which failed, not how close anybody was
         * (REQ-VER-04, REQ-SEC-07, hard rule 9). Reception does not need it —
         * the remedy is the same whichever detail was wrong, and it is to check
         * the details with the patient and send a new invitation. It names the
         * INVITATION and the AGREEMENT so the work page can offer that in one
         * press rather than sending anybody to a queue (CLAUDE.md §7,
         * "shortcuts to the answer").
         */
        const task = await this.reviewTasks.raise(tx, {
          practiceId: parsed.practiceId,
          kind: 'portal_activation_locked',
          subjectType: 'Patient',
          subjectId: invitation.patientId,
          summary:
            'A patient’s portal invitation locked after three failed attempts. Check the details you hold ' +
            'with them, then send a new invitation.',
          detail: {
            invitationId: invitation.id,
            agreementId: invitation.agreementId,
            attempts,
            lockedAt: new Date().toISOString(),
          },
          raisedBy: 'system',
        });

        /*
         * THE SUBJECT IS THE INVITATION, NOT THE PATIENT, and that is
         * deliberate twice over. It is what actually locked; and the patient's
         * own "who has looked" card is built from the events whose subject is
         * their patient id, their agreements or their sessions — a lock they
         * were already told about on screen has no business appearing there as
         * a bare action key they cannot act on.
         *
         * THE ACTOR IS THE SYSTEM. Whoever was typing was, by definition, not
         * proved to be anybody; recording the pre-minted account as the actor
         * would assert the very thing the three failures did not establish.
         */
        await enqueueVaultEvent(tx, {
          type: 'portal.activation_locked',
          actor: { principalType: 'system', id: 'portal' },
          subject: { type: 'PortalActivationToken', id: invitation.id },
          payload: {
            invitationId: invitation.id,
            agreementId: invitation.agreementId,
            attempts,
            outcome: 'locked',
            reviewTaskId: task.id,
          },
        });
      });
      this.limiter.recordFailure(clientKey);
      if (locked) {
        throw new HttpException(
          {
            statusCode: 423,
            reason: 'token_locked' satisfies PortalActivationRefusalReason,
            message: 'This invitation is locked. Ask the practice for a new one.',
          },
          423,
        );
      }
      /*
       * The verification module's own generic message — never which identifier
       * failed, never how close (REQ-SEC-07). `attemptsRemaining` is a COUNT
       * and says nothing about the answers: the patient is told how many tries
       * are left because being locked out without warning, on a page they
       * reached from our own message, is the worse failure.
       */
      throw new UnauthorizedException({
        statusCode: 401,
        attemptsRemaining: Math.max(0, PORTAL_ACTIVATION_MAX_ATTEMPTS - attempts),
        message: outcome.message ?? 'Some of those details do not match our records.',
      });
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

    // An activation that worked. The next patient behind that address starts
    // clean — a shared waiting-room connection is one address, not one person.
    this.limiter.clear(clientKey);

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
