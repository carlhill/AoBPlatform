import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeycloakAdminClient, KeycloakAdminError } from '@aobplatform/auth-client';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';
import { KEYCLOAK_ADMIN } from './identity.tokens';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../messaging/gateway';
import { PLATFORM_ADMIN } from '../auth/roles.decorator';
import { renderHtml, renderText, type EmailBlock, type EmailFooter } from '../messaging/template';

/**
 * Step 3 of the onboarding sequence: the approved practice admin gets an
 * account and a passkey invitation.
 *
 * THE CEREMONY QUESTION, ANSWERED. REQ-PKI-01 says no key is bound without a
 * ceremony, and the practitioner ceremony checks an AHPRA number, a provider
 * number and its location. A practice administrator has none of those. Forcing
 * the practitioner shape on them would mean inventing a registration number to
 * satisfy a form — a fabricated identifier in permanent evidence, which is
 * worse than the gap it papers over.
 *
 * So an admin's ceremony is `practice_admin` and cites the ORGANISATION
 * APPROVAL: a named human checked the ABN, the registered name, the address,
 * and — the part that actually matters — that this applicant is entitled to
 * act for the entity. That is a stronger attestation than the practitioner
 * one, of different facts.
 *
 * Which means the ceremony cannot be created before approval, and the account
 * cannot exist before the ceremony. The ordering is not incidental; it is the
 * control.
 */
/**
 * How long an enrolment link lives.
 *
 * ONE HOUR, DOWN FROM KEYCLOAK'S TWELVE. The link is a BEARER CREDENTIAL, and
 * a stronger one than it looks: the action token is a signed JWT carrying the
 * user id, so whoever opens it is treated as that account. You do not need to
 * know the username — the link IS the username, and the password, and the
 * second factor.
 *
 * Twelve hours of that sitting in an inbox is a long time, and longer still
 * when the inbox is a shared practice mailbox. An hour is comfortable for
 * somebody who asked for it and short enough that a forwarded message goes
 * stale before it reaches anywhere it should not; re-sending is one click.
 *
 * This does NOT make the link safe on its own. It bounds the window. What
 * carries the assurance is the REQ-PKI-01 ceremony performed before it was
 * sent, and the fact that additional devices are added from a signed-in
 * session rather than from another emailed link.
 */
const ENROLMENT_LINK_SECONDS = 60 * 60;

@Injectable()
export class PracticeAdminService {
  private readonly logger = new Logger(PracticeAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(KEYCLOAK_ADMIN) private readonly keycloak: KeycloakAdminClient | null,
    @Inject(MESSAGING_GATEWAY) private readonly messaging: MessagingGateway,
    // Global module: an approval that cannot invite anybody is work, and work
    // belongs in the queue rather than in a log line.
    private readonly reviewTasks: ReviewTasksService,
  ) {}

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /**
   * The footer every outbound message carries.
   *
   * Not decoration. A message about somebody's Medicare-related application
   * that arrives with no sender identity, no reason-you-got-this and no way to
   * reply is indistinguishable from a phishing attempt — and we are asking
   * people to click links and type codes, which is precisely the behaviour a
   * phishing email asks for. Saying who we are, why they received it, and what
   * we will never ask for is what separates the two.
   *
   * The "we will never ask" line is the important one: it gives the recipient a
   * rule they can apply to the NEXT message, including one we did not send.
   */
  private footerData(): EmailFooter {
    const organisation = this.config.get<string>('ORGANISATION_NAME', 'AoBPlatform');
    return {
      organisation,
      tagline: 'Consent and compliance records for Medicare assignment of benefit.',
      whyReceived: `You received this because this address was given on an application to ${organisation}.`,
      neverAsk: 'We will never ask you for a password, a Medicare number, or bank details by email.',
      supportEmail: this.config.get<string>('SUPPORT_EMAIL') || undefined,
      supportPhone: this.config.get<string>('SUPPORT_PHONE') || undefined,
      website: this.config.get<string>('PUBLIC_WEB_URL') || undefined,
    };
  }

  /**
   * The footer, as plain-text lines, for messages not yet converted to blocks.
   *
   * Not decoration. A message about somebody's Medicare-related application
   * that arrives with no sender identity, no reason-you-got-this and no reply
   * route is indistinguishable from a phishing attempt — and we ask people to
   * open links and type codes, which is exactly what phishing asks for. Saying
   * who we are, why they received it, and what we will never ask for is what
   * separates the two.
   *
   * The "we will never ask" line is the one that does real work: it hands the
   * reader a rule they can apply to the NEXT message, including one we did not
   * send.
   */
  private footer(): string[] {
    const f = this.footerData();
    const lines = ['', '—', f.organisation, f.tagline, '', f.whyReceived, f.neverAsk];
    if (f.supportEmail) lines.push(`Reply to this message, or write to ${f.supportEmail}.`);
    if (f.supportPhone) lines.push(`Telephone ${f.supportPhone}.`);
    if (f.website) lines.push(f.website);
    return lines;
  }

  /** Render one message in both parts, from a single set of blocks. */
  private compose(subject: string, blocks: readonly EmailBlock[]) {
    const footer = this.footerData();
    return { body: renderText(blocks, footer), html: renderHtml(subject, blocks, footer) };
  }

  /**
   * Called immediately after an organisation is APPROVED.
   *
   * Deliberately does not throw on failure. The approval is already recorded
   * and must not be rolled back because an email bounced — but a silent
   * failure would leave an approved practice with no way in, so every path
   * returns a status the caller surfaces.
   */
  /**
   * Disable an outgoing practice administrator's account.
   *
   * WHY THIS IS ITS OWN METHOD WITH ITS OWN GUARD. Practice-admin succession is
   * ordinary — people leave, and often at short notice — so this will be used,
   * and it disables the ability to sign in. That is exactly the kind of
   * operation that should refuse rather than proceed when anything looks wrong.
   *
   * IT WILL NOT TOUCH A PLATFORM ADMINISTRATOR. The realistic accident is not
   * malice: a practice is registered with an address that already belongs to
   * somebody at AoBPlatform — which has already happened, on XLEVELUP — and a
   * handover then reaches for the account behind that address. The caller
   * already restricts this to the account WE created for that practice; this is
   * the second belt, checked here because it is the last point before the
   * account is switched off.
   */
  /**
   * The username for a practice's administrator account.
   *
   * IT USES THE WHOLE PRACTICE ID, and the reason is arithmetic. The first
   * version used the first eight hex characters — 32 bits — and
   * `createPasskeyOnlyUser` RETURNS an existing account when the username
   * matches. So a collision would not fail: practice B would be silently handed
   * practice A's admin account, an account carrying `practice_id: A` as its
   * token claim. That is a cross-tenant breach, arriving quietly, as a
   * successful invitation.
   *
   * The birthday bound on 32 bits is not comfortable:
   *
   *     10,000 practices  ~1.2% chance of at least one collision
   *     50,000 practices  ~25%
   *    100,000 practices  ~69%
   *
   * A full UUID is unique by construction, so there is nothing to probe for and
   * no collision path to get right.
   *
   * LEGACY SHORT NAMES ARE STILL HONOURED, because accounts already exist with
   * them — but only after checking that the account really is this practice's.
   * That check is what the short form never had.
   */
  private async adminUsernameFor(organisationId: string): Promise<string> {
    const full = `admin.${organisationId}`;
    if (!this.keycloak) return full;

    if (await this.keycloak.findByUsername(full)) return full;

    const legacy = `admin.${organisationId.slice(0, 8)}`;
    const existing = await this.keycloak.findByUsername(legacy);
    if (!existing) return full;

    const claimed = existing.attributes?.practice_id?.[0];
    if (claimed === organisationId) return legacy;

    // Somebody else's account wearing a name that looks like ours. Never reuse
    // it; the full form cannot collide.
    this.logger.warn(
      `Username "${legacy}" belongs to practice ${claimed ?? 'unknown'}, not ${organisationId}. Using the ` +
        'full-id form instead. This is the eight-character collision the short name allowed.',
    );
    return full;
  }

  /**
   * Hand the practice-admin account to somebody new.
   *
   * THE ACCOUNT BELONGS TO THE PRACTICE, NOT TO A PERSON — `admin.<practiceId>`,
   * and its address is normally a shared mailbox (aobplatform@practice.com.au)
   * chosen precisely so that somebody leaving does not lock the practice out.
   *
   * What belongs to a PERSON is the passkey: it is bound to their device and
   * their fingerprint. So a handover revokes the CREDENTIAL and keeps the
   * ACCOUNT. Disabling the account would take a practice offline to punish a
   * departure; leaving the passkey would let somebody who has left carry on
   * signing in from their own laptop.
   *
   * An earlier version of this disabled the account instead. It was wrong in
   * both directions and it is worth saying why: the practice was orphaned, and
   * the next invitation then failed with Keycloak's `400 User is disabled`,
   * which explains nothing to whoever is trying to get a new administrator in.
   */
  async handOverPracticeAdminAccount(
    userId: string,
    to: { email?: string | null; name?: string | null },
  ): Promise<{ passkeysRevoked: number; note: string }> {
    if (!this.keycloak) {
      return { passkeysRevoked: 0, note: 'Keycloak is not configured, so no credentials were revoked.' };
    }

    // The same guard as everywhere else that touches an account: never a
    // platform operator. A practice registered with an address that already
    // belongs to somebody here is the ordinary way that would happen.
    const roles = await this.keycloak.realmRolesOf(userId);
    if (roles.includes(PLATFORM_ADMIN)) {
      throw new Error(
        `Refusing to touch ${userId}: it holds ${PLATFORM_ADMIN}. A practice-admin handover must never ` +
          'revoke a platform operator\u2019s credentials.',
      );
    }

    const passkeysRevoked = await this.keycloak.revokePasskeys(userId);

    const [firstName, ...rest] = (to.name ?? '').trim().split(/\s+/).filter(Boolean);
    await this.keycloak.updateUser(userId, {
      ...(to.email ? { email: to.email } : {}),
      ...(firstName ? { firstName, lastName: rest.join(' ') || firstName } : {}),
      // Re-enabled deliberately: a handover is somebody arriving, not the
      // practice being switched off.
      enabled: true,
    });

    this.logger.log(
      `Practice-admin account ${userId} handed over: ${passkeysRevoked} passkey(s) revoked, account kept.`,
    );

    return {
      passkeysRevoked,
      note:
        passkeysRevoked > 0
          ? `${passkeysRevoked} passkey(s) revoked, so the previous administrator can no longer sign in. The ` +
            'account itself is kept — it belongs to the practice.'
          : 'There were no passkeys to revoke; nobody had enrolled one yet.',
    };
  }

  /**
   * The same handover, found by practice rather than by account id.
   *
   * The confirmation arrives from an emailed token with no session, so the
   * caller knows which practice it is about and nothing about which Keycloak
   * account belongs to it.
   */
  async handOverPracticeAdminAccountFor(
    practiceId: string,
    to: { email?: string | null; name?: string | null },
  ): Promise<{ passkeysRevoked: number; note: string }> {
    const practice = await this.prisma.withPractice(practiceId, (tx) =>
      tx.practice.findFirst({ where: { id: practiceId } }),
    );
    if (!practice?.adminKeycloakUserId) {
      return {
        passkeysRevoked: 0,
        note: 'This practice has no administrator account yet, so there was nothing to hand over.',
      };
    }

    const result = await this.handOverPracticeAdminAccount(practice.adminKeycloakUserId, {
      email: to.email,
      name: to.name ?? practice.adminName,
    });

    /*
     * AND THE WAY BACK IN. The handover revokes the passkeys, which is the
     * point -- but revoking without issuing a replacement is what left an
     * administrator holding an account they could not sign into and no link to
     * fix it. The two belong together.
     */
    if (this.keycloak) {
      await this.keycloak
        .sendPasskeyEnrolment(practice.adminKeycloakUserId, {
          clientId: this.config.get<string>('KEYCLOAK_WEB_CLIENT_ID', 'web'),
          redirectUri: this.consoleUrl(),
          lifespanSeconds: ENROLMENT_LINK_SECONDS,
        })
        .catch((err: Error) => {
          this.logger.error(`Handover succeeded but the enrolment link failed for ${practiceId}: ${err.message}`);
        });
    }

    return result;
  }

  /**
   * "Confirm this is you" — to the NEW address, and the only message of the
   * three that can move anything.
   */
  async onAdminEmailChangeRequested(input: {
    to: string;
    requestedByName: string;
    confirmUrl: string;
    code: string;
    expiresAt: Date;
  }): Promise<{ notified: boolean; detail: string }> {
    const subject = 'Confirm your new AoBPlatform administrator address';
    const closes = input.expiresAt.toISOString().slice(0, 10);

    const { body, html } = this.compose(subject, [
      { text: 'Hello,' },
      {
        text:
          `${input.requestedByName} asked us to make this address the administrator address for their ` +
          'practice on AoBPlatform. Nothing has changed yet, and nothing will until you confirm it here.',
      },
      { heading: 'Step 1 — open this page' },
      { button: { label: 'Confirm the address', url: input.confirmUrl } },
      { url: input.confirmUrl },
      { heading: 'Step 2 — enter this code' },
      { code: input.code },
      {
        small:
          `Both work until ${closes}. The code is what confirms it — a scanner opening the link cannot ` +
          'confirm it on your behalf.',
      },
      { rule: true },
      {
        text:
          'Once confirmed, this address becomes where we send everything about the practice, and the ' +
          'passkeys enrolled against the old address stop working. We will send you a link to set up your own.',
      },
      {
        small:
          'If you were not expecting this, do nothing. The request expires by itself, and we have also told ' +
          'the address it would be replacing.',
      },
    ]);

    const result = await this.messaging.dispatch({ channel: 'email', to: input.to, subject, body, html });
    return {
      notified: result.accepted,
      detail: result.accepted
        ? `A confirmation was sent (${this.messaging.mode}).`
        : `The confirmation could NOT be sent: ${result.failureReason ?? 'unknown error'}.`,
    };
  }

  /**
   * "This is happening — stop it if it should not be" — to the OLD address and
   * the group address.
   *
   * THE ONE THAT MATTERS. The new address belongs to whoever asked for the
   * change, so telling them checks nothing. This message goes to the channel
   * the requester does not control by having made the request, which is what
   * makes it capable of raising the alarm.
   */
  async onAdminEmailChangeNotified(input: {
    to: string;
    requestedEmail: string;
    previousEmail: string | null;
    requestedByName: string;
    requestedAt: Date;
    stopUrl: string;
    addressedToFormerHolder: boolean;
  }): Promise<{ notified: boolean; detail: string }> {
    const subject = 'Somebody asked to change your practice’s administrator address';
    const when = input.requestedAt.toISOString().replace('T', ' ').slice(0, 16);

    const { body, html } = this.compose(subject, [
      { text: 'Hello,' },
      {
        text: input.addressedToFormerHolder
          ? `${input.requestedByName} asked us to move your practice’s administrator address away from this ` +
            `one, to ${input.requestedEmail}, at ${when} UTC.`
          : `${input.requestedByName} asked us to change your practice’s administrator address to ` +
            `${input.requestedEmail}, at ${when} UTC.`,
      },
      {
        text:
          'Nothing has changed yet. It only takes effect if somebody confirms it from the new address, and ' +
          'we are telling you first so that you can stop it if it should not happen.',
      },
      { heading: 'If this was not asked for by your practice' },
      { button: { label: 'Stop this change', url: input.stopUrl } },
      { url: input.stopUrl },
      {
        small:
          'This works even after the request expires, and pressing it always puts the account in front of ' +
          'somebody here.',
      },
      { rule: true },
      {
        text:
          'If your practice did ask for this, you do not need to do anything. The change goes through when ' +
          'the new address confirms it.',
      },
      {
        small:
          'We are telling you because changing where our messages go is the first step somebody would take ' +
          'to take over a practice account — so we never do it quietly.',
      },
    ]);

    const result = await this.messaging.dispatch({ channel: 'email', to: input.to, subject, body, html });
    return {
      notified: result.accepted,
      detail: result.accepted ? `Notified (${this.messaging.mode}).` : `NOT notified: ${result.failureReason ?? '?'}.`,
    };
  }

  /**
   * "Confirm this is you" for the SHARED address — the groupEmail mirror of
   * {@link onAdminEmailChangeRequested}, with the one paragraph that differs:
   * nothing here is a handover, because nobody signs in as groupEmail.
   */
  async onGroupEmailChangeRequested(input: {
    to: string;
    requestedByName: string;
    confirmUrl: string;
    code: string;
    expiresAt: Date;
  }): Promise<{ notified: boolean; detail: string }> {
    const subject = 'Confirm your practice’s shared email address';
    const closes = input.expiresAt.toISOString().slice(0, 10);

    const { body, html } = this.compose(subject, [
      { text: 'Hello,' },
      {
        text:
          `${input.requestedByName} asked us to make this address the shared practice address on ` +
          'AoBPlatform — where notices meant for the practice, rather than for one person, are sent. ' +
          'Nothing has changed yet, and nothing will until you confirm it here.',
      },
      { heading: 'Step 1 — open this page' },
      { button: { label: 'Confirm the address', url: input.confirmUrl } },
      { url: input.confirmUrl },
      { heading: 'Step 2 — enter this code' },
      { code: input.code },
      {
        small:
          `Both work until ${closes}. The code is what confirms it — a scanner opening the link cannot ` +
          'confirm it on your behalf.',
      },
      { rule: true },
      {
        small:
          'If you were not expecting this, do nothing. The request expires by itself, and we have also told ' +
          'the address it would be replacing.',
      },
    ]);

    const result = await this.messaging.dispatch({ channel: 'email', to: input.to, subject, body, html });
    return {
      notified: result.accepted,
      detail: result.accepted
        ? `A confirmation was sent (${this.messaging.mode}).`
        : `The confirmation could NOT be sent: ${result.failureReason ?? 'unknown error'}.`,
    };
  }

  /**
   * "This is happening — stop it if it should not be", to the address it
   * replaces or to the administrator — the groupEmail mirror of {@link
   * onAdminEmailChangeNotified}.
   */
  async onGroupEmailChangeNotified(input: {
    to: string;
    requestedEmail: string;
    previousEmail: string | null;
    requestedByName: string;
    requestedAt: Date;
    stopUrl: string;
    addressedToFormerHolder: boolean;
  }): Promise<{ notified: boolean; detail: string }> {
    const subject = 'Somebody asked to change your practice’s shared email address';
    const when = input.requestedAt.toISOString().replace('T', ' ').slice(0, 16);

    const { body, html } = this.compose(subject, [
      { text: 'Hello,' },
      {
        text: input.addressedToFormerHolder
          ? `${input.requestedByName} asked us to move your practice’s shared email address away from this ` +
            `one, to ${input.requestedEmail}, at ${when} UTC.`
          : `${input.requestedByName} asked us to change your practice’s shared email address to ` +
            `${input.requestedEmail}, at ${when} UTC.`,
      },
      {
        text:
          'Nothing has changed yet. It only takes effect if somebody confirms it from the new address, and ' +
          'we are telling you first so that you can stop it if it should not happen.',
      },
      { heading: 'If this was not asked for by your practice' },
      { button: { label: 'Stop this change', url: input.stopUrl } },
      { url: input.stopUrl },
      {
        small:
          'This works even after the request expires, and pressing it always puts the account in front of ' +
          'somebody here.',
      },
      { rule: true },
      {
        text:
          'If your practice did ask for this, you do not need to do anything. The change goes through when ' +
          'the new address confirms it.',
      },
      {
        small:
          'We are telling you because the shared address is where we send notices meant for the whole ' +
          'practice, so we never change it quietly.',
      },
    ]);

    const result = await this.messaging.dispatch({ channel: 'email', to: input.to, subject, body, html });
    return {
      notified: result.accepted,
      detail: result.accepted ? `Notified (${this.messaging.mode}).` : `NOT notified: ${result.failureReason ?? '?'}.`,
    };
  }

  async disablePracticeAdminAccount(userId: string): Promise<{ disabled: boolean; note: string }> {
    if (!this.keycloak) {
      return { disabled: false, note: 'Keycloak is not configured, so no account could be disabled.' };
    }

    const roles = await this.keycloak.realmRolesOf(userId);
    if (roles.includes(PLATFORM_ADMIN)) {
      throw new Error(
        `Refusing to disable ${userId}: it holds ${PLATFORM_ADMIN}. A practice-admin handover must never ` +
          'switch off a platform operator, and an address shared between the two is the ordinary way that ' +
          'would happen.',
      );
    }

    await this.keycloak.setEnabled(userId, false);
    this.logger.log(`Practice-admin account ${userId} disabled on handover. Not deleted — it is evidence.`);
    return {
      disabled: true,
      note: 'The previous administrator can no longer sign in. The account is disabled, not deleted.',
    };
  }

  async onApproved(input: {
    organisationId: string;
    organisationName: string;
    adminName: string | null;
    adminEmail: string | null;
    approvedByName: string;
    entitlementMethod?: string | null;
  }): Promise<{ accountCreated: boolean; invited: boolean; detail: string }> {
    if (!input.adminEmail) {
      return {
        accountCreated: false,
        invited: false,
        detail: 'No admin email is on record for this practice, so nobody could be invited.',
      };
    }

    // The ceremony first — a key must never be bound without one.
    const ceremony = await this.prisma.withPractice(input.organisationId, (tx) =>
      tx.enrolmentCeremony.create({
        data: {
          practiceId: input.organisationId,
          subjectKind: 'practice_admin',
          approvedOrganisationId: input.organisationId,
          // An independently-obtained callback verifies a practice admin: the
          // applicant did not choose the number, so answering it is evidence.
          // That reasoning does not transfer to a practitioner, where the
          // thing being defended is a provider number.
          personVerificationMethod: input.entitlementMethod === 'phone_call' ? 'independent_callback' : 'in_person',
          verifiedByName: input.approvedByName,
          evidenceNote: `Organisation approval for ${input.organisationName}.`,
          performedAt: new Date(),
        },
      }),
    );

    if (!this.keycloak) {
      this.logger.warn(
        `Keycloak is not configured, so no account was created for ${input.organisationName}. The ceremony ` +
          `(${ceremony.id}) stands and the invitation can be sent once it is.`,
      );
      return {
        accountCreated: false,
        invited: false,
        detail: 'Keycloak is not configured in this environment; the approval and ceremony are recorded.',
      };
    }

    const username = await this.adminUsernameFor(input.organisationId);
    const [firstName, ...rest] = (input.adminName ?? 'Practice Admin').trim().split(/\s+/);
    try {
      const user = await this.keycloak.createPasskeyOnlyUser({
        username,
        email: input.adminEmail,
        firstName,
        lastName: rest.join(' ') || firstName,
        realmRoles: ['practice_principal'],
        // The claim that replaces the dev x-practice-id header once
        // AUTH_ENFORCE is switched on.
        attributes: { practice_id: input.organisationId },
      });

      await this.keycloak.sendPasskeyEnrolment(user.id, {
        clientId: this.config.get<string>('KEYCLOAK_WEB_CLIENT_ID', 'web'),
        redirectUri: this.consoleUrl(),
        lifespanSeconds: ENROLMENT_LINK_SECONDS,
      });

      const invitedAt = new Date();
      await this.prisma.withPractice(input.organisationId, async (tx) => {
        await tx.practice.update({
          where: { id: input.organisationId },
          data: { adminKeycloakUserId: user.id, adminInvitedAt: invitedAt },
        });

        /*
         * THE ADMINISTRATOR IS ALSO A PERSON ON THE LIST.
         *
         * Without this row the practice has an administrator account in
         * Keycloak and nothing on /practice/users saying so — the screen
         * reported "no administrator" for a practice that plainly had one,
         * which is a screen contradicting the system it is a view of.
         *
         * It carries consoleRole `admin`, which the domain caps at exactly
         * one per practice — so this row is also what makes that cap mean
         * anything. Before it, the rule was counting rows that never existed.
         *
         * `keycloakUserId` is the join back to the account, so a later
         * handover can find both halves.
         */
        const existing = await tx.staffMember.findFirst({
          where: { practiceId: input.organisationId, consoleRole: 'admin' },
        });
        if (existing) {
          await tx.staffMember.update({
            where: { id: existing.id },
            data: {
              name: input.adminName ?? existing.name,
              email: input.adminEmail ?? existing.email,
              keycloakUserId: user.id,
              invitedAt,
              // A re-invitation restores access: the account is the
              // practice's, and issuing a fresh credential is the point.
              deactivatedAt: null,
              deactivatedReason: null,
              active: true,
            },
          });
        } else {
          await tx.staffMember.create({
            data: {
              practiceId: input.organisationId,
              name: input.adminName ?? 'Practice administrator',
              email: input.adminEmail,
              // What they DO at the practice. Separate from consoleRole, so
              // console access is never granted by describing somebody.
              role: 'practice_manager',
              consoleRole: 'admin',
              keycloakUserId: user.id,
              invitedAt,
            },
          });
        }
        await tx.enrolmentCeremony.update({ where: { id: ceremony.id }, data: { consumedAt: invitedAt } });
        await enqueueVaultEvent(tx, {
          type: 'nomination.changed',
          actor: { principalType: 'staff', id: input.organisationId },
          subject: { type: 'Practice', id: input.organisationId },
          payload: {
            action: 'practice_admin_invited',
            ceremonyId: ceremony.id,
            attestedBy: input.approvedByName,
            subjectKind: 'practice_admin',
          },
        });
      });

      /*
       * A PAST FAILURE IS CLEARED BY A SUCCESS. Leaving it set would keep a
       * practice on the rescue list forever after somebody had already rescued
       * it, and a list with permanent residents is a list people stop reading.
       */
      await this.prisma.withPractice(input.organisationId, (tx) =>
        tx.practice.update({
          where: { id: input.organisationId },
          data: { adminInviteFailedAt: null, adminInviteError: null },
        }),
      );

      return {
        accountCreated: true,
        invited: true,
        detail: `A passkey enrolment invitation was sent to the practice admin. There is no password to set.`,
      };
    } catch (err) {
      const message = err instanceof KeycloakAdminError ? err.message : (err as Error).message;
      this.logger.error(`Could not create the practice-admin account for ${input.organisationName}: ${message}`);

      /*
       * WRITTEN DOWN, not merely returned.
       *
       * The approval stands -- it must, an identity provider being unreachable
       * is not a reason to un-approve a practice that passed its checks. But
       * until this was recorded the failure existed only in the response to a
       * request nobody re-reads and in a log line nobody is watching, and the
       * practice sat approved with nobody able to sign in.
       *
       * Best-effort, and deliberately so: if we cannot even record the failure
       * we must still return the failure rather than throw over the top of it.
       */
      await this.prisma
        .withPractice(input.organisationId, async (tx) => {
          await tx.practice.update({
            where: { id: input.organisationId },
            data: {
              adminInviteFailedAt: new Date(),
              adminInviteError: message,
              adminInviteAttempts: { increment: 1 },
            },
          });

          /*
           * AND RAISED AS WORK, because a column nobody queries is only a
           * better log line.
           *
           * The queue is where somebody actually looks. An approved practice
           * with nobody able to sign in is not a delivery failure to be
           * shrugged at -- it is entitled to capture consent and cannot, and
           * every day it sits there is a day it is either working without
           * consent records or has gone elsewhere. From inside our console it
           * looks like a practice that simply has not got started.
           */
          await this.reviewTasks.raise(tx, {
            practiceId: input.organisationId,
            kind: 'admin_invite_failed',
            subjectType: 'Practice',
            subjectId: input.organisationId,
            summary: `${input.organisationName} was approved, but the administrator could not be invited`,
            detail: {
              reason:
                'The approval stands and is correct -- an identity provider being unreachable is no reason ' +
                'to un-approve a practice that passed its checks. But nobody at this practice can sign in ' +
                'until an invitation succeeds.',
              // Verbatim. The commonest of these is actionable precisely
              // because it is specific.
              error: message,
              adminEmail: input.adminEmail,
              approvedBy: input.approvedByName,
            },
            raisedBy: input.approvedByName,
          });
        })
        .catch(() => this.logger.error(`Could not even record the invitation failure for ${input.organisationId}.`));

      return {
        accountCreated: false,
        invited: false,
        detail: `The approval is recorded, but the admin account could not be created: ${message}`,
      };
    }
  }

  /**
   * Ask the applicant to confirm their email address.
   *
   * Sent on its own rather than folded into another message, because it has one
   * job and a message with one job gets acted on. It carries no other link and
   * asks for nothing else.
   *
   * Note what it must NOT do: imply that confirming the address advances the
   * application. It does not. It only means we can reach them — which matters
   * precisely because everything that follows arrives this way.
   */
  async onEmailVerificationRequested(input: {
    organisationName: string;
    adminName: string | null;
    adminEmail: string;
    verifyUrl: string;
    code: string;
    expiresAt: Date;
  }): Promise<{ notified: boolean; detail: string }> {
    const subject = `Confirm your email address — ${input.organisationName}`;
    const closes = input.expiresAt.toISOString().slice(0, 10);

    /*
     * The CODE is the centrepiece, because it is the reason the message exists.
     * The link is a step towards it, not the point — which is also the security
     * story: opening the link does nothing at all.
     */
    const { body, html } = this.compose(subject, [
      { text: input.adminName ? `${input.adminName},` : 'Hello,' },
      {
        text:
          `Please confirm we can reach you at this address for the ${input.organisationName} application. ` +
          'It takes two steps.',
      },
      { heading: 'Step 1 — open this page' },
      { button: { label: 'Open the confirmation page', url: input.verifyUrl } },
      { url: input.verifyUrl },
      { heading: 'Step 2 — enter this code' },
      { code: input.code },
      {
        small:
          `Both work until ${closes}, and once only. The code is what confirms it — a scanner opening the ` +
          'link cannot confirm it on your behalf.',
      },
      { rule: true },
      {
        text:
          'This does not move your application along by itself; a person still reads it. What it does is make ' +
          'sure that when we have something to tell you, it reaches you.',
      },
      {
        small:
          'If you did not apply to AoBPlatform you can ignore this message. Nothing happens unless the code ' +
          'is entered.',
      },
    ]);

    const result = await this.messaging.dispatch({
      channel: 'email',
      to: input.adminEmail,
      subject,
      body,
      html,
    });

    return {
      notified: result.accepted,
      detail: result.accepted
        ? `A confirmation link was sent (${this.messaging.mode}).`
        : `The confirmation link could NOT be sent: ${result.failureReason ?? 'unknown error'}.`,
    };
  }

  /**
   * Ask the applicant to correct something.
   *
   * Sent by a named reviewer who has looked at the application and found
   * something the applicant can fix — most often a contact detail that would
   * otherwise cost them a rejection for a typo.
   *
   * The link is time-boxed. A correction link with no expiry is a standing
   * credential sitting in an inbox indefinitely: forwarded, archived,
   * searchable, and still live months later when whoever received it has left
   * the practice. Five days is long enough to act on and short enough that a
   * stale copy is worth nothing.
   *
   * It carries NO passkey and NO sign-in, and that is deliberate rather than a
   * shortcut. The practice admin has no account here until the practice is
   * approved, so requiring one would deadlock: no passkey until approval, no
   * approval until the correction is made.
   *
   * What it must not say: whether the ABN is already registered here. The same
   * rule as rejection reasons — otherwise a correction request becomes a way to
   * enumerate our customers.
   */
  async onCorrectionRequested(input: {
    organisationName: string;
    adminName: string | null;
    adminEmail: string | null;
    reason: string;
    requestedByName: string;
    correctUrl: string;
    expiresAt: Date;
    windowDays: number;
  }): Promise<{ notified: boolean; detail: string }> {
    if (!input.adminEmail) {
      return { notified: false, detail: 'No admin email is on record, so nobody could be asked.' };
    }
    if (/already registered/i.test(input.reason)) {
      throw new BadRequestException(
        'A correction request must not disclose whether an ABN is already registered here — that turns it ' +
          'into a way to enumerate our customers.',
      );
    }

    const closes = input.expiresAt.toISOString().slice(0, 10);

    const result = await this.messaging.dispatch({
      channel: 'email',
      to: input.adminEmail,
      subject: `Please correct your AoBPlatform application for ${input.organisationName}`,
      body: [
        input.adminName ? `${input.adminName},` : 'Hello,',
        '',
        `We have looked at your application for ${input.organisationName} and there is something we need you ` +
          'to correct before it can go further.',
        '',
        `What needs correcting: ${input.reason}`,
        '',
        'You can fix it here:',
        `  ${input.correctUrl}`,
        '',
        `This link stops working after ${input.windowDays} days, on ${closes}. If it has expired by the time ` +
          'you read this, reply to this message and we will send another.',
        '',
        'You do not need a password or a sign-in. There is no account to create yet — that comes after the ' +
          'application is approved.',
        '',
        'You cannot change the ABN, because every check runs against one legal entity. If the ABN itself is ' +
          'wrong, that is a new application rather than a correction.',
        '',
        `Asked by: ${input.requestedByName}`,
        ...this.footer(),
      ].join('\n'),
    });

    return {
      notified: result.accepted,
      detail: result.accepted
        ? `The applicant was asked to correct the application (${this.messaging.mode}).`
        : `The applicant could NOT be asked: ${result.failureReason ?? 'unknown error'}.`,
    };
  }

  /**
   * The rejection email.
   *
   * Note what it must NOT say: whether this ABN is already registered on the
   * platform. That would turn a rejection into a lookup for "which practices
   * are AoBPlatform customers", which is our customer list.
   */
  async onRejected(input: {
    organisationName: string;
    adminEmail: string | null;
    reason: string;
    rejectedByName: string;
  }): Promise<{ notified: boolean; detail: string }> {
    if (!input.adminEmail) {
      return { notified: false, detail: 'No admin email is on record, so nobody could be notified.' };
    }
    if (/already registered/i.test(input.reason)) {
      throw new BadRequestException(
        'A rejection reason must not disclose whether an ABN is already registered here — that turns a ' +
          'rejection into a way to enumerate our customers. Say that the application could not be verified.',
      );
    }

    const result = await this.messaging.dispatch({
      channel: 'email',
      to: input.adminEmail,
      subject: `Your AoBPlatform application for ${input.organisationName}`,
      body: [
        `We were unable to approve the application for ${input.organisationName}.`,
        '',
        `Reason: ${input.reason}`,
        '',
        'If you believe this is wrong, reply to this message and we will look again.',
        '',
        `Reviewed by: ${input.rejectedByName}`,
        ...this.footer(),
      ].join('\n'),
    });

    return {
      notified: result.accepted,
      detail: result.accepted
        ? `The applicant was notified (${this.messaging.mode}).`
        : `The applicant could NOT be notified: ${result.failureReason ?? 'unknown error'}.`,
    };
  }

  /**
   * Acknowledge an application the moment it arrives.
   *
   * Until this existed, an applicant submitted a form that promised "you will
   * hear from us either way" and then heard nothing at all until a decision.
   * The wait is genuinely open-ended — gate 3 is a person ringing a practice —
   * so silence reads as a form that went nowhere, and the predictable response
   * is to submit again, which is how one practice becomes three applications.
   *
   * Three deliberate constraints on what this may say:
   *
   *   1. It gives a REFERENCE and a route to ask, never an estimate. We do not
   *      control how long a phone call takes to return, and a missed estimate
   *      is worse than none.
   *   2. It never states or implies an outcome. An acknowledgement that reads
   *      as encouragement is the beginning of "but your email said".
   *   3. It reveals nothing that was not already on the applicant's own screen.
   *      Email is not an authenticated channel, and an acknowledgement that
   *      confirmed anything about the entity would be a disclosure to whoever
   *      received it — including whoever received it by mistake.
   *
   * A failure to send is REPORTED, never thrown: the application has already
   * been accepted and recorded, and losing it because a mail server hiccuped
   * would be the wrong trade entirely.
   */
  async onApplicationReceived(input: {
    organisationId: string;
    organisationName: string;
    adminName: string | null;
    adminEmail: string | null;
    statusUrl?: string;
    supportPhone?: string;
    verifyUrl?: string;
    verifyCode?: string;
    verifyExpiresAt?: Date;
  }): Promise<{ notified: boolean; detail: string }> {
    if (!input.adminEmail) {
      return { notified: false, detail: 'No admin email was given, so no acknowledgement could be sent.' };
    }

    const lines = [
      input.adminName ? `${input.adminName},` : 'Hello,',
      '',
      `We have your application for ${input.organisationName}. Nothing further is needed from you now.`,
      '',
      `Your reference is ${input.organisationId}.`,
      '',
      'What happens next: a person reads the application. An active ABN and a matching name are necessary ' +
        'and not sufficient, so somebody here checks that you are entitled to act for this practice. That ' +
        'usually means a phone call to the practice on a number we find ourselves.',
      '',
      'If you want to check where it has got to, or if anything has changed:',
    ];

    if (input.statusUrl) {
      lines.push(`  · Check where it has got to: ${input.statusUrl}`);
      // The correction link, because the commonest reason an application
      // stalls is a mistyped contact detail — and the applicant has no account
      // here yet, so this cannot be behind a sign-in. Requiring one would
      // deadlock: no passkey until approval, no approval until the typo is
      // fixed.
      lines.push(`  · Correct a mistake in it: ${input.statusUrl}/correct`);
    }
    if (input.supportPhone) {
      lines.push(`  · Call us: ${input.supportPhone}`);
    }
    lines.push('  · Or reply to this message, quoting the reference above.');

    if (input.verifyUrl) {
      lines.push('');
      lines.push('ONE THING TO DO NOW: confirm this is your address.');
      lines.push('');
      lines.push(`  1. Open  ${input.verifyUrl}`);
      lines.push(`  2. Enter this code:  ${input.verifyCode ?? ''}`);
      lines.push('');
      lines.push(
        'The code is what confirms it, not the link — so an automated scanner opening the link on your behalf ' +
          'cannot confirm it for you. Everything after this, including the decision and your sign-in ' +
          'invitation if it is approved, comes to this address.',
      );
      if (input.verifyExpiresAt) {
        lines.push(`That link works until ${input.verifyExpiresAt.toISOString().slice(0, 10)}.`);
      }
    }

    lines.push('');
    lines.push('You will hear from us either way.');
    lines.push(...this.footer());

    const result = await this.messaging.dispatch({
      channel: 'email',
      to: input.adminEmail,
      subject: `We have your application for ${input.organisationName} — reference ${input.organisationId}`,
      body: lines.join('\n'),
    });

    if (!result.accepted) {
      this.logger.warn(
        `The acknowledgement for ${input.organisationId} was NOT sent: ` +
          `${result.failureReason ?? 'unknown error'}. The application itself is recorded and unaffected.`,
      );
    }

    return {
      notified: result.accepted,
      detail: result.accepted
        ? `The applicant was acknowledged (${this.messaging.mode}).`
        : `The acknowledgement could NOT be sent: ${result.failureReason ?? 'unknown error'}.`,
    };
  }
}
