import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { OutboundService } from '../outbound/outbound.service';
import { EmailComposer } from '../messaging/composer.service';

/**
 * Sends the patient the link that lets them approve an agreement.
 *
 * THIS DID NOT EXIST. `CaptureService.open` mints a single-use token and
 * returns it "for the message dispatcher" — and there was no dispatcher.
 * Nothing ever reached a patient from a remote capture request; the token
 * appeared once in an API response and was gone. So the whole post-
 * consultation flow was a queue entry with no message behind it.
 *
 * QUEUED, NOT SENT. Everything goes through `outbound.enqueue` in the caller's
 * transaction, which is what records it — Carl's standing rule that every
 * message the platform sends is recorded, and the thing the correspondence
 * screen (CONSULTATION-CAPTURE-PLAN.md Part 4) will read. A direct gateway
 * call here would be a message that left no trace.
 *
 * NO DOLLAR AMOUNTS, no Medicare number, no benefit figure — Rule 4 applies
 * to the message as it does to the artefact (REQ-REG-04).
 */
@Injectable()
export class CaptureLinkDispatcher {
  constructor(
    private readonly outbound: OutboundService,
    private readonly composer: EmailComposer,
    private readonly config: ConfigService,
  ) {}

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /** The patient-facing approval page — CONSULTATION-CAPTURE-PLAN.md §3.3. */
  approvalUrl(token: string): string {
    return `${this.consoleUrl()}/agree/${token}`;
  }

  async sendPostAgreementLink(
    tx: Prisma.TransactionClient,
    input: {
      practiceId: string;
      practiceName: string;
      patient: { id: string; givenNames: string; familyName: string; email: string | null; mobile: string | null };
      providerName: string;
      serviceDate: Date;
      mbsItemNumbers: readonly string[];
      captureRequestId: string;
      channel: 'email_link' | 'sms_link';
      token: string;
      expiresAt: Date | null;
    },
  ) {
    const url = this.approvalUrl(input.token);
    const patientName = `${input.patient.givenNames} ${input.patient.familyName}`;
    const when = input.serviceDate.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const closes = input.expiresAt ? input.expiresAt.toISOString().slice(0, 10) : null;
    const items = input.mbsItemNumbers.join(', ');

    if (input.channel === 'sms_link') {
      const body =
        `${input.practiceName}: please confirm your Medicare bulk-billing agreement for your visit on ${when} ` +
        `with ${input.providerName}. Open ${url}` +
        (closes ? ` (link works until ${closes}).` : '.');
      return this.outbound.enqueue(tx, {
        practiceId: input.practiceId,
        channel: 'sms',
        destination: input.patient.mobile,
        subjectType: 'CaptureRequest',
        subjectId: input.captureRequestId,
        recipientType: 'patient',
        recipientId: input.patient.id,
        recipientName: patientName,
        payload: { body },
      });
    }

    const subject = `Please confirm your bulk-billing agreement with ${input.practiceName}`;
    const composed = this.composer.compose(
      subject,
      [
        { text: `Hello ${input.patient.givenNames},` },
        {
          text:
            `You saw ${input.providerName} at ${input.practiceName} on ${when}. For Medicare to pay the practice ` +
            'directly for that visit — so that you do not have to pay and claim it back — you need to agree to ' +
            'assign your Medicare benefit to the practice.',
        },
        { text: `The Medicare item number${input.mbsItemNumbers.length === 1 ? '' : 's'} for the visit: ${items}.` },
        { heading: 'Review and approve' },
        { button: { label: 'Open the agreement', url } },
        { url },
        ...(closes
          ? [
              {
                small:
                  `The link works until ${closes}. You will be asked to confirm a few details about yourself ` +
                  'first, so that nobody else can approve this in your name.',
              },
            ]
          : []),
        { rule: true },
        {
          small:
            'If you did not attend this practice on that date, do nothing — the link expires on its own — and ' +
            'let the practice know.',
        },
      ],
      this.composer.footerFor(
        `You received this because ${input.practiceName} asked us to record your agreement for a Medicare ` +
          'bulk-billed service.',
      ),
    );

    return this.outbound.enqueue(tx, {
      practiceId: input.practiceId,
      channel: 'email',
      destination: input.patient.email,
      subjectType: 'CaptureRequest',
      subjectId: input.captureRequestId,
      recipientType: 'patient',
      recipientId: input.patient.id,
      recipientName: patientName,
      payload: { subject, ...composed },
    });
  }
}
