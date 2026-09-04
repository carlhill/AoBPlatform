import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { portalRecordId } from '@aobplatform/contracts';
import { PORTAL_INVITATION_TEMPLATE_KEY, renderPatientMessage } from '@aobplatform/domain';
import { OutboundService } from '../outbound/outbound.service';
import { EmailComposer } from '../messaging/composer.service';
import type { EmailBlock } from '../messaging/template';

/**
 * THE INVITATION ACTUALLY REACHES THE PATIENT (Carl, 4 Sep 2026).
 *
 * WHAT WAS WRONG. `POST /agreements/:id/portal-invitation` minted a token,
 * recorded it and handed it back in the response — and nothing sent it. The
 * same gap `CaptureLinkDispatcher` was written to close for capture links: a
 * one-time secret that appears once in an API response and is gone is not an
 * offer to anybody.
 *
 * QUEUED, NOT SENT, IN THE CALLER'S TRANSACTION. Everything goes through
 * `outbound.enqueue`, which writes the correspondence twin in the same
 * transaction — so there is never an invitation with no record of the message,
 * or a message with no invitation behind it (hard rule 11's shape, applied to
 * transport). The sandbox gateway is what dev drains it with; nothing leaves
 * the machine and no real send happens without a registered sender
 * (CLAUDE.md §7).
 *
 * THE WORDS ARE CONTENT, NOT CODE. `portal_invitation_v1` lives in
 * `packages/domain/content/patient-message-templates.json`, validated at load
 * against hard rules 1, 4 and 12, and the version it was sent under is
 * recorded on the queued item. Nothing here writes a sentence.
 *
 * THE RECORD ID IS THE POINT OF THE MESSAGE. `AoBPlatform-PatientId-<account>`
 * appears in the invitation, on the portal page and as the passkey's user
 * name; a patient who can compare the three has a check no forger can pass
 * without knowing an id we never publish. That is why the account is minted
 * with the invitation rather than at activation — the FIRST message has to be
 * able to quote the real one.
 *
 * NO AMOUNT, NO MEDICARE NUMBER, NO CLAIM THAT ANYTHING IS APPROVED — the
 * template loader refuses a file that breaks any of those, so this cannot.
 */
@Injectable()
export class PortalInvitationDispatcher {
  private readonly logger = new Logger(PortalInvitationDispatcher.name);

  constructor(
    private readonly outbound: OutboundService,
    private readonly composer: EmailComposer,
    private readonly config: ConfigService,
  ) {}

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /**
   * Where the invitation lands.
   *
   * UNDER `/patient`, like every other patient-facing page, and carrying the
   * token in the PATH rather than a query string — the same shape the capture
   * link uses, and for the same reason: a query string is the part of a URL
   * that leaks into referrers, logs and analytics.
   */
  activationUrl(token: string): string {
    return `${this.consoleUrl()}/patient/portal/activate/${token}`;
  }

  /**
   * Queue the invitation. Returns what was queued, or null when there is
   * nowhere to send it.
   *
   * NO CONTACT DETAIL IS NOT AN ERROR. Portal access is never a precondition
   * of anything (REQ-PORT-08), so a patient we hold no address for simply does
   * not get the offer — the invitation is still minted and can still be handed
   * over at the counter. Failing the mint would make an OFFER into a
   * requirement, which is the rule inverted.
   */
  async sendInvitation(
    tx: Prisma.TransactionClient,
    input: {
      practiceId: string;
      practiceName: string;
      patient: {
        id: string;
        givenNames: string;
        familyName: string;
        email: string | null;
        mobile: string | null;
      };
      invitationId: string;
      accountId: string;
      token: string;
      expiresAt: Date;
    },
  ): Promise<{ channel: 'email' | 'sms'; templateKey: string; templateVersion: string } | null> {
    const url = this.activationUrl(input.token);
    const recordId = portalRecordId(input.accountId);
    const expiresOn = input.expiresAt.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Australia/Sydney',
    });

    const message = renderPatientMessage(PORTAL_INVITATION_TEMPLATE_KEY, {
      givenNames: input.patient.givenNames,
      practiceName: input.practiceName,
      activationUrl: url,
      expiresOn,
      recordId,
    });

    const patientName = `${input.patient.givenNames} ${input.patient.familyName}`;
    const common = {
      practiceId: input.practiceId,
      subjectType: 'PortalActivationToken',
      subjectId: input.invitationId,
      recipientType: 'patient',
      recipientId: input.patient.id,
      recipientName: patientName,
    } as const;

    /*
     * EMAIL WHERE WE HAVE ONE, TEXT OTHERWISE. An invitation is not urgent —
     * it is an offer with a seven-day life — and the email carries the small
     * print that makes the link safe to read: what will be asked at the other
     * end, and the record id sentence. The SMS says the same things in one
     * line because it must.
     */
    if (input.patient.email) {
      const blocks: EmailBlock[] = [
        ...message.paragraphs.map((text) => ({ text })),
        ...(message.actionLabel ? [{ button: { label: message.actionLabel, url } }, { url }] : [{ url }]),
        ...message.smallPrint.map((small) => ({ small })),
      ];
      await this.outbound.enqueue(tx, {
        ...common,
        channel: 'email',
        destination: input.patient.email,
        payload: {
          subject: message.subject,
          ...this.composer.compose(
            message.subject ?? '',
            blocks,
            this.composer.footerFor(
              `You received this because ${input.practiceName} offered you a way to see your own ` +
                'bulk-billing record with them.',
            ),
          ),
          templateKey: message.templateKey,
          templateVersion: message.templateVersion,
        },
      });
      return { channel: 'email', templateKey: message.templateKey, templateVersion: message.templateVersion };
    }

    if (input.patient.mobile && message.sms) {
      await this.outbound.enqueue(tx, {
        ...common,
        channel: 'sms',
        destination: input.patient.mobile,
        payload: {
          body: message.sms,
          templateKey: message.templateKey,
          templateVersion: message.templateVersion,
        },
      });
      return { channel: 'sms', templateKey: message.templateKey, templateVersion: message.templateVersion };
    }

    // No address and no mobile. Said once, with no patient detail in it.
    this.logger.log(
      `Portal invitation ${input.invitationId} was minted with no contact detail to send it to. ` +
        'It can still be handed over at the counter (REQ-PORT-08 — the portal is never a precondition).',
    );
    return null;
  }
}
