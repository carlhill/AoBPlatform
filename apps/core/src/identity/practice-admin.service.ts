import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeycloakAdminClient, KeycloakAdminError } from '@aobplatform/auth-client';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { KEYCLOAK_ADMIN } from './identity.tokens';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../messaging/gateway';

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
@Injectable()
export class PracticeAdminService {
  private readonly logger = new Logger(PracticeAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(KEYCLOAK_ADMIN) private readonly keycloak: KeycloakAdminClient | null,
    @Inject(MESSAGING_GATEWAY) private readonly messaging: MessagingGateway,
  ) {}

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /**
   * Called immediately after an organisation is APPROVED.
   *
   * Deliberately does not throw on failure. The approval is already recorded
   * and must not be rolled back because an email bounced — but a silent
   * failure would leave an approved practice with no way in, so every path
   * returns a status the caller surfaces.
   */
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

    const username = `admin.${input.organisationId.slice(0, 8)}`;
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
      });

      const invitedAt = new Date();
      await this.prisma.withPractice(input.organisationId, async (tx) => {
        await tx.practice.update({
          where: { id: input.organisationId },
          data: { adminKeycloakUserId: user.id, adminInvitedAt: invitedAt },
        });
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

      return {
        accountCreated: true,
        invited: true,
        detail: `A passkey enrolment invitation was sent to the practice admin. There is no password to set.`,
      };
    } catch (err) {
      const message = err instanceof KeycloakAdminError ? err.message : (err as Error).message;
      this.logger.error(`Could not create the practice-admin account for ${input.organisationName}: ${message}`);
      return {
        accountCreated: false,
        invited: false,
        detail: `The approval is recorded, but the admin account could not be created: ${message}`,
      };
    }
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
      lines.push(`  · Check the status: ${input.statusUrl}`);
    }
    if (input.supportPhone) {
      lines.push(`  · Call us: ${input.supportPhone}`);
    }
    lines.push('  · Or reply to this message, quoting the reference above.');
    lines.push('');
    lines.push('You will hear from us either way.');

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
