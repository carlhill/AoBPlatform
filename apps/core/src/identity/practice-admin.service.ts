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
  private footer(): string[] {
    const org = this.config.get<string>('ORGANISATION_NAME', 'AoBPlatform');
    const support = this.config.get<string>('SUPPORT_EMAIL', '');
    const phone = this.config.get<string>('SUPPORT_PHONE', '');
    const site = this.config.get<string>('PUBLIC_WEB_URL', '');

    const lines = [
      '',
      '—',
      org,
      'Consent and compliance records for Medicare assignment of benefit.',
      '',
      'You received this because this address was given on an application to ' + org + '.',
      'We will never ask you for a password, a Medicare number, or bank details by email.',
    ];
    if (support) lines.push(`Reply to this message, or write to ${support}.`);
    if (phone) lines.push(`Telephone ${phone}.`);
    if (site) lines.push(site);
    return lines;
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
    const result = await this.messaging.dispatch({
      channel: 'email',
      to: input.adminEmail,
      subject: `Confirm your email for the ${input.organisationName} application`,
      body: [
        input.adminName ? `${input.adminName},` : 'Hello,',
        '',
        `Please confirm we can reach you at this address for the ${input.organisationName} application.`,
        '',
        `  1. Open  ${input.verifyUrl}`,
        `  2. Enter this code:  ${input.code}`,
        '',
        `Both work until ${input.expiresAt.toISOString().slice(0, 10)}, and once only. The code is what ` +
          'confirms it, so a scanner opening the link cannot confirm it on your behalf.',
        '',
        'This does not move your application along by itself — a person still reads it. What it does is make ' +
          'sure that when we do have something to tell you, it reaches you.',
        '',
        'If you did not apply to AoBPlatform, you can ignore this message. Nothing happens unless the code is ' +
          'entered — opening the link alone does nothing at all.',
        ...this.footer(),
      ].join('\n'),
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
