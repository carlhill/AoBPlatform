import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { renderPatientMessage, telehealthTransports, type TelehealthChannel } from '@aobplatform/domain';
import { OutboundService } from '../outbound/outbound.service';
import { EmailComposer } from '../messaging/composer.service';
import type { EmailBlock } from '../messaging/template';

/** The template the link message is rendered from (versioned content). */
export const TELEHEALTH_LINK_TEMPLATE_KEY = 'telehealth_link_v1';
/** Appended only when the provider's Ahpra registration was sighted and is current (D-2026-10-12-03 item 10). */
export const TELEHEALTH_AHPRA_LINE_TEMPLATE_KEY = 'telehealth_ahpra_line_v1';
/** Appended to every telehealth link: the reference the patient quotes to the practice (D-2026-10-12-03 item 11). */
export const TELEHEALTH_CONSULTATION_ID_LINE_TEMPLATE_KEY = 'telehealth_consultation_id_line_v1';

/**
 * SENDS THE LINK TO THE ONE PAGE FOR A TELEHEALTH CONSULTATION
 * (TELEHEALTH-PLAN.md §3 step 5).
 *
 * THE CONTACT ON THE RECORD, ONLY (D-2026-09-11-03; decision 3). There is no
 * parameter for an address: the caller hands over the patient row the PMS sync
 * wrote, and this reads `mobile` / `email` off it. A wrong number is corrected
 * in PracSoft and syncs through.
 *
 * THE CODE IS NOT A PARAMETER EITHER. It cannot reach a message from here
 * because nothing here is given it, and the template has no placeholder for it
 * (`telehealth_code_never_in_the_message`).
 *
 * QUEUED, NOT SENT, through `OutboundService.enqueue` in the caller's
 * transaction, exactly as `CaptureLinkDispatcher` does: every message is
 * recorded, and delivery goes through the configured gateway, which in
 * development is the sandbox that never opens a socket (CLAUDE.md §7c: no real
 * SMS or email without Carl's go-ahead).
 *
 * WORDS FROM CONTENT (`patient-message-templates.json`), neutral until G10 is
 * answered: nothing about bulk billing, Medicare, the assignment or the DB4.
 */
@Injectable()
export class TelehealthLinkDispatcher {
  constructor(
    private readonly outbound: OutboundService,
    private readonly composer: EmailComposer,
    private readonly config: ConfigService,
  ) {}

  /** The patient page, under /patient like every patient page. */
  pageUrl(token: string): string {
    return `${this.config.get<string>('CONSOLE_URL', 'http://localhost:21100')}/patient/telehealth/${token}`;
  }

  async send(
    tx: Prisma.TransactionClient,
    input: {
      practiceId: string;
      practiceName: string;
      providerName: string;
      /** The provider's Ahpra number, ONLY when sighted and current; null leaves the line out. */
      ahpraNumber: string | null;
      /** The TH-XXXX-XXXX reference; always shown. */
      consultationId: string;
      sessionId: string;
      /** Which send of this session this is. Each is its own message, never a retry of the last. */
      sendNumber: number;
      patient: { id: string; givenNames: string; familyName: string; mobile: string | null; email: string | null };
      channel: TelehealthChannel;
      token: string;
      expiresOn: string;
    },
  ): Promise<('sms' | 'email')[]> {
    const url = this.pageUrl(input.token);
    const message = renderPatientMessage(TELEHEALTH_LINK_TEMPLATE_KEY, {
      practiceName: input.practiceName,
      providerName: input.providerName,
      telehealthUrl: url,
      expiresOn: input.expiresOn,
    });
    const ahpra = input.ahpraNumber
      ? renderPatientMessage(TELEHEALTH_AHPRA_LINE_TEMPLATE_KEY, {
          providerName: input.providerName,
          ahpraNumber: input.ahpraNumber,
        })
      : null;
    const reference = renderPatientMessage(TELEHEALTH_CONSULTATION_ID_LINE_TEMPLATE_KEY, {
      practiceName: input.practiceName,
      consultationId: input.consultationId,
    });
    const common = {
      practiceId: input.practiceId,
      subjectType: 'TelehealthSession',
      subjectId: input.sessionId,
      recipientType: 'patient',
      recipientId: input.patient.id,
      recipientName: `${input.patient.givenNames} ${input.patient.familyName}`,
      /*
       * A FRESH LINK IS A NEW MESSAGE. Without its own attempt group the
       * outbound queue's idempotency key (practice, channel, subject) makes a
       * resend an empty upsert onto the first send, and the patient would get
       * nothing (found by the e2e spec, 12 Oct 2026).
       */
      attemptGroup: `telehealth-link-${input.sendNumber}`,
    };
    const queued: ('sms' | 'email')[] = [];

    for (const transport of telehealthTransports(input.channel)) {
      if (transport === 'sms') {
        await this.outbound.enqueue(tx, {
          ...common,
          channel: 'sms',
          destination: input.patient.mobile,
          payload: {
            body: [message.sms, ahpra?.sms, reference.sms].filter(Boolean).join(' '),
            templateKey: message.templateKey,
            templateVersion: message.templateVersion,
          },
        });
      } else {
        const blocks: EmailBlock[] = [
          ...message.paragraphs.map((text) => ({ text })),
          ...(ahpra?.paragraphs ?? []).map((text) => ({ text })),
          ...reference.paragraphs.map((text) => ({ text })),
          { button: { label: message.actionLabel ?? 'Open the page', url } },
          { url },
          ...message.smallPrint.map((small) => ({ small })),
        ];
        /*
         * THE FOOTER IS NEUTRAL TOO. The shared footer's tagline names
         * "Medicare assignment of benefit" and its never-ask line names a
         * Medicare number; before the consultation that is exactly the
         * wording G10 asks us to keep out (TELEHEALTH-PLAN.md §9). The
         * anti-phishing rule stays, without the word. FLAGGED for Carl: these
         * two lines are code literals here, as they are in the composer.
         */
        const composed = this.composer.compose(message.subject ?? '', blocks, {
          ...this.composer.footerFor(
            `You received this because ${input.practiceName} sent it to the contact details on your record ` +
              'while you were on a call with them.',
          ),
          tagline: 'Records for your practice.',
          neverAsk: 'We will never ask you for a password, a card number or bank details by email.',
        });
        await this.outbound.enqueue(tx, {
          ...common,
          channel: 'email',
          destination: input.patient.email,
          payload: {
            subject: message.subject,
            ...composed,
            templateKey: message.templateKey,
            templateVersion: message.templateVersion,
          },
        });
      }
      queued.push(transport);
    }
    return queued;
  }
}
