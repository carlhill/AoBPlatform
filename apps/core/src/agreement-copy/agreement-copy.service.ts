import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AGREEMENT_COPY_TEMPLATE_KEY,
  COPY_DELIVERY_VERSION,
  COPY_LINK_EXPIRY_HOURS,
  copyDestinationFor,
  copyOfferFor,
  renderPatientMessage,
  type CopyOffer,
  type CopyOfferInput,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundService } from '../outbound/outbound.service';
import { EmailComposer } from '../messaging/composer.service';
import type { EmailBlock } from '../messaging/template';
import { RendererRegistry } from '../render/renderer-registry';
import { verifiedArtefactOf } from '../render/verified-artefact';
import { mintAgreementCopyToken, parseAgreementCopyToken } from './copy-token';

/**
 * W6 — "SEND ME A COPY". REQ-PORT-02, which automates the s 65C
 * copy-on-request obligation.
 *
 * WHAT IT DOES, in one line: after the signature, offer the person who signed
 * a copy of what they signed, at an address the record already holds, and
 * serve that copy from the one deterministic render path.
 *
 * NO ADDRESS IS EVER TYPED ON THE TABLET (D-2026-09-11-03). `offerFor` answers
 * with MASKED contacts and a channel type; `send` takes a channel KEY and
 * resolves the address server-side from the record. There is no parameter on
 * any method here that a typed address could arrive in, which is the rule
 * enforced by the type system rather than by a comment.
 *
 * WHOSE ADDRESS (ASSIGNOR-RULES rules 5–6): the patient record's when the
 * patient signed for themselves, that assignor's own when somebody else did.
 * `assignorIsPatient` decides, it is an explicit column (D7), and the other
 * record is never consulted.
 *
 * QUEUED, NOT SENT, IN ONE TRANSACTION. The copy link, the queued message, its
 * correspondence twin and the vault event all commit together — one without
 * the others is structurally impossible (hard rule 11, ADR A-02). Nothing
 * leaves the process on this path; the outbound worker drains the queue, and
 * in development that is MailHog and nothing reaches a real person.
 *
 * IT BLOCKS NOTHING (hard rule 8). No contact on file, the patient declining,
 * the provider failing later — the ceremony is complete in all three, because
 * the signature completed it. A send that cannot go surfaces at the DESK, in
 * the practice's own message log, and never on the patient's screen.
 */
@Injectable()
export class AgreementCopyService {
  private readonly logger = new Logger(AgreementCopyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: OutboundService,
    private readonly composer: EmailComposer,
    private readonly renderers: RendererRegistry,
    private readonly config: ConfigService,
  ) {}

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /**
   * Where the copy lands.
   *
   * UNDER `/patient`, like every other patient-facing page, and carrying the
   * token in the PATH rather than a query string — the same shape the capture
   * link and the activation invitation use, and the same reason: a query
   * string is the part of a URL that leaks into referrers, logs and analytics.
   */
  copyUrl(token: string): string {
    return `${this.consoleUrl()}/patient/agreement-copy/${token}`;
  }

  /* -----------------------------------------------------------------------
   * The offer
   * -------------------------------------------------------------------- */

  /**
   * What may be offered to the person who just signed this agreement.
   *
   * MASKED, ALWAYS. The return type has no field a real address could sit in
   * (`packages/domain/src/agreement-copy.ts` keeps the two apart on purpose),
   * so the value cannot reach a tablet even by mistake.
   *
   * AN UNSIGNED AGREEMENT HAS NOTHING TO COPY. 404 rather than an empty offer:
   * "there is no copy yet" and "we have nowhere to send your copy" are
   * different answers and the screen says different things to each.
   */
  async offerFor(practiceId: string, agreementId: string): Promise<CopyOffer> {
    const input = await this.signerContactFor(practiceId, agreementId);
    return copyOfferFor(input.offer);
  }

  /**
   * Read the agreement and whichever ONE record holds the signer's contact.
   *
   * Returns the pieces every caller needs and nothing else. The address itself
   * is inside `offer` and is never returned to a controller — only `send`
   * reaches for it, through `copyDestinationFor`, on its way to the queue.
   */
  private async signerContactFor(practiceId: string, agreementId: string) {
    const found = await this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) return null;
      const patient = await tx.patient.findFirst({ where: { id: agreement.patientId } });
      const assignor = agreement.assignorIsPatient
        ? null
        : await tx.assignor.findFirst({ where: { id: agreement.assignorId } });
      const practice = await tx.practice.findFirst({});
      const signature = agreement.signatureEventId
        ? await tx.signatureEvent.findFirst({ where: { id: agreement.signatureEventId } })
        : null;
      return { agreement, patient, assignor, practice, signature };
    });

    if (!found || !found.agreement) throw new NotFoundException('That agreement is not at this practice.');
    const { agreement, patient, assignor, practice, signature } = found;

    if (!agreement.particularsLockedAt || !agreement.renderedArtefactHash) {
      // Nothing has been signed, so there is nothing to copy. Not an empty
      // offer — a different answer, and the screen says something different.
      throw new NotFoundException('This agreement has no signed copy yet.');
    }

    const offer: CopyOfferInput = {
      assignorIsPatient: agreement.assignorIsPatient,
      patient: { email: patient?.email ?? null, mobile: patient?.mobile ?? null },
      assignor: assignor ? { email: assignor.contactEmail, mobile: assignor.contactMobile } : null,
    };

    return {
      agreement,
      offer,
      practiceName: practice?.name ?? '',
      givenNames: patient?.givenNames ?? '',
      /** WHICH RECORD the address came from — a type, never the address (hard rule 9). */
      recipientType: agreement.assignorIsPatient ? ('patient' as const) : ('assignor' as const),
      recipientId: agreement.assignorIsPatient ? agreement.patientId : agreement.assignorId,
      recipientName: agreement.assignorIsPatient
        ? `${patient?.givenNames ?? ''} ${patient?.familyName ?? ''}`.trim()
        : (assignor?.name ?? ''),
      signedAt: signature?.createdAt ?? agreement.particularsLockedAt,
    };
  }

  /* -----------------------------------------------------------------------
   * The send
   * -------------------------------------------------------------------- */

  /**
   * The person who signed asked for a copy on `optionKey`.
   *
   * ONE TRANSACTION, FOUR WRITES (hard rule 11). The copy link, the outbound
   * item, its correspondence twin — written by `outbound.enqueue` itself — and
   * the vault event commit together or not at all. A copy link with no message
   * behind it would be a promise nobody kept; a message with no link in it
   * would be a dead URL in a patient's inbox.
   *
   * THE OPTION KEY IS CONTENT, NOT A LITERAL. It is looked up in
   * `content/copy-delivery-channels.json` and the version of that file is
   * recorded on the link, so a record made today still says what it was
   * offered from after the list changes (hard rule 14).
   *
   * THE RETURN VALUE IS A TYPE AND AN OUTCOME. `{ channel, queued }` — no
   * address, not even masked. The tablet already knows the mask it showed.
   */
  async requestCopy(
    practiceId: string,
    agreementId: string,
    optionKey: string,
    actor: { principalType: string; id: string },
  ): Promise<{ channel: 'email' | 'sms'; queued: true }> {
    const context = await this.signerContactFor(practiceId, agreementId);

    const destination = copyDestinationFor(context.offer, optionKey);
    if (!destination) {
      /*
       * The option is unknown, sends nothing, or the record holds no contact
       * for it. All three are "nothing to send", and the reason code is what
       * the tablet maps to copy and a destination — see reception
       * (D-2026-09-11-03). It is never a box to type an address into, and it
       * is never a generic message ("Shortcuts to the answer", 4 Sep 2026).
       */
      throw new BadRequestException('no_contact_on_file');
    }

    const { token, tokenHash } = mintAgreementCopyToken(practiceId);
    const expiresAt = new Date(Date.now() + COPY_LINK_EXPIRY_HOURS * 3600_000);
    const url = this.copyUrl(token);

    const message = renderPatientMessage(AGREEMENT_COPY_TEMPLATE_KEY, {
      givenNames: context.givenNames,
      practiceName: context.practiceName,
      copyUrl: url,
      expiresOn: formatSydneyDate(expiresAt),
      signedOn: formatSydneyDate(context.signedAt),
    });

    await this.prisma.withPractice(practiceId, async (tx) => {
      const link = await tx.agreementCopyLink.create({
        data: {
          practiceId,
          agreementId,
          tokenHash,
          channel: destination.channel,
          optionKey,
          optionsVersion: COPY_DELIVERY_VERSION,
          recipientType: context.recipientType,
          recipientId: context.recipientId,
          expiresAt,
        },
      });

      const common = {
        practiceId,
        subjectType: 'AgreementCopyLink',
        subjectId: link.id,
        recipientType: context.recipientType,
        recipientId: context.recipientId,
        recipientName: context.recipientName,
      } as const;

      const item =
        destination.channel === 'email'
          ? await this.outbound.enqueue(tx, {
              ...common,
              channel: 'email',
              destination: destination.destination,
              payload: {
                kind: 'agreement_copy',
                subject: message.subject,
                ...this.composer.compose(
                  message.subject ?? '',
                  emailBlocksFor(message, url),
                  this.composer.footerFor(
                    `You received this because you asked ${context.practiceName} for a copy of an agreement ` +
                      'you signed there.',
                  ),
                ),
                templateKey: message.templateKey,
                templateVersion: message.templateVersion,
              },
            })
          : await this.outbound.enqueue(tx, {
              ...common,
              channel: 'sms',
              destination: destination.destination,
              payload: {
                kind: 'agreement_copy',
                /*
                 * A LABEL FOR THE DESK'S MESSAGE LOG, not part of the text
                 * message. `recordForOutbound` takes the correspondence row's
                 * subject from here, and without it an SMS row reads as a
                 * blank line in the practice's own log — which is where a send
                 * that could not go has to be findable.
                 */
                subject: message.subject,
                body: message.sms,
                templateKey: message.templateKey,
                templateVersion: message.templateVersion,
              },
            });

      await tx.agreementCopyLink.update({ where: { id: link.id }, data: { outboundItemId: item.id } });

      /*
       * THE EVIDENCE (hard rule 11: through the outbox, same transaction).
       *
       * IDS, TYPES AND VERSIONS. No address, no mobile, no name, and no masked
       * form of any of them — a mask is still derived from the value and an
       * event is forever (hard rule 9, REQ-VER-04).
       */
      await enqueueVaultEvent(tx, {
        type: 'agreement.copy_requested',
        actor,
        subject: { type: 'Agreement', id: agreementId },
        payload: {
          copyLinkId: link.id,
          channel: destination.channel,
          optionKey,
          optionsVersion: COPY_DELIVERY_VERSION,
          recipientType: context.recipientType,
          recipientId: context.recipientId,
          templateKey: message.templateKey,
          templateVersion: message.templateVersion,
          expiresAt: expiresAt.toISOString(),
        },
      });
    });

    return { channel: destination.channel, queued: true };
  }

  /* -----------------------------------------------------------------------
   * The copy itself
   * -------------------------------------------------------------------- */

  /**
   * Serve the signed agreement behind a copy token.
   *
   * RULE 13 IS THE WHOLE METHOD, and it is the SAME verification the patient's
   * own page runs — `verifiedArtefactOf`, one function, one render path. The
   * bytes are re-rendered under the renderer version recorded on the agreement
   * and refused if the hash has moved. Nothing is composed a second time and
   * no copy of the PDF is stored anywhere for this link to point at.
   *
   * READING EVIDENCE IS ITSELF EVIDENCE (REQ-LOG-07). Every open is an
   * `artefact.accessed` event with the hash that was served — which is why the
   * link opens more than once rather than burning: the count is evidence, not
   * a limit.
   *
   * AN EXPIRED OR REVOKED LINK IS A 404 WITH THE SAME WORDS AS AN UNKNOWN ONE.
   * Distinguishing them tells whoever is holding a stale URL that it was once
   * real, which is the first half of guessing the rest.
   */
  async serve(token: string): Promise<{ bytes: Buffer; mediaType: string; filename: string; sha256: string }> {
    const parsed = parseAgreementCopyToken(token);
    if (!parsed) throw new NotFoundException('That link is not one of ours, or it has expired.');

    const found = await this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const link = await tx.agreementCopyLink.findFirst({ where: { tokenHash: parsed.tokenHash } });
      if (!link) return null;
      const agreement = await tx.agreement.findFirst({ where: { id: link.agreementId } });
      return agreement ? { link, agreement } : null;
    });

    if (!found) throw new NotFoundException('That link is not one of ours, or it has expired.');
    const { link, agreement } = found;

    if (link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('That link is not one of ours, or it has expired.');
    }

    const rendered = await verifiedArtefactOf(this.renderers, agreement, this.logger);

    await this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const at = new Date();
      await tx.agreementCopyLink.update({
        where: { id: link.id },
        data: {
          firstOpenedAt: link.firstOpenedAt ?? at,
          lastOpenedAt: at,
          openCount: { increment: 1 },
        },
      });
      await enqueueVaultEvent(tx, {
        /*
         * THE ACTOR IS THE LINK, NOT A PERSON. Whoever opened it holds the
         * secret that was sent to the signer's own address; asserting it was
         * the signer would be the platform claiming an identity it did not
         * check. `copy_link` is the honest principal type.
         */
        type: 'artefact.accessed',
        actor: { principalType: 'copy_link', id: link.id },
        subject: { type: 'Agreement', id: agreement.id },
        payload: {
          action: 'copy_link_download',
          sha256: rendered.sha256,
          rendererVersion: rendered.rendererVersion,
          channel: link.channel,
          recipientType: link.recipientType,
        },
      });
    });

    return {
      bytes: rendered.bytes,
      mediaType: rendered.mediaType,
      filename: rendered.filename,
      sha256: rendered.sha256,
    };
  }
}

/**
 * The email's blocks, in the order the template wrote them. Identical in shape
 * to the portal invitation's, so a reader of one message recognises the other.
 */
function emailBlocksFor(
  message: { paragraphs: readonly string[]; actionLabel?: string; smallPrint: readonly string[] },
  url: string,
): EmailBlock[] {
  return [
    ...message.paragraphs.map((text) => ({ text })),
    ...(message.actionLabel ? [{ button: { label: message.actionLabel, url } }, { url }] : [{ url }]),
    ...message.smallPrint.map((small) => ({ small })),
  ];
}

/** The one date format patient messages use. Sydney, because the practices are. */
function formatSydneyDate(at: Date): string {
  return at.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Sydney',
  });
}
