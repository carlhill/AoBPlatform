import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MESSAGING_GATEWAY, type MessagingGateway } from './gateway';
import { renderHtml, renderText, type EmailBlock, type EmailFooter } from './template';

/**
 * One place that knows what an outbound message from us looks like.
 *
 * EXTRACTED BECAUSE THE FOOTER HAD ALREADY FORKED. PracticeAdminService held
 * two implementations of it — `footerData()` and `footer()` — with near
 * identical doc comments explaining why it matters, which is the clearest
 * possible sign that a third was coming. Now a practitioner invitation needed
 * one too.
 *
 * WHY THE FOOTER IS NOT DECORATION. We send people messages about a
 * Medicare-related matter and ask them to open a link and type a code. That is
 * precisely what a phishing email asks for. What separates us from one is
 * saying who we are, why they received it, and what we will never ask for.
 *
 * The "we will never ask" line is the one that does real work: it hands the
 * reader a rule they can apply to the NEXT message, including one we did not
 * send.
 */
@Injectable()
export class EmailComposer {
  private readonly logger = new Logger(EmailComposer.name);

  constructor(
    @Inject(MESSAGING_GATEWAY) private readonly gateway: MessagingGateway,
    private readonly config: ConfigService,
  ) {}

  get mode(): string {
    return this.gateway.mode;
  }

  footerData(): EmailFooter {
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
   * The same footer for a recipient who never applied to us.
   *
   * A practitioner invited by their employer did not fill in a form here, and
   * telling them "this address was given on an application" would be false —
   * and false in the one paragraph whose entire job is to make the message
   * credible. A reader who catches us being wrong about why they got it has
   * every reason to treat the rest as a scam.
   */
  footerFor(whyReceived: string): EmailFooter {
    return { ...this.footerData(), whyReceived };
  }

  /** Render one message in both parts, from a single set of blocks. */
  compose(subject: string, blocks: readonly EmailBlock[], footer?: EmailFooter) {
    const f = footer ?? this.footerData();
    return { body: renderText(blocks, f), html: renderHtml(subject, blocks, f) };
  }

  /**
   * Compose and send.
   *
   * NEVER THROWS. Every caller is doing something already recorded — an
   * application accepted, an affiliation created — and none of it should be
   * rolled back because a mail server hiccuped. But a silent failure leaves
   * somebody waiting on a message that will never come, so the outcome comes
   * back as a value the caller can surface.
   */
  async send(input: {
    to: string;
    subject: string;
    blocks: readonly EmailBlock[];
    footer?: EmailFooter;
    /** For the log line when it fails. */
    context: string;
  }): Promise<{ notified: boolean; detail: string }> {
    const { body, html } = this.compose(input.subject, input.blocks, input.footer);

    const result = await this.gateway
      .dispatch({ channel: 'email', to: input.to, subject: input.subject, body, html })
      .catch((err: Error) => ({ accepted: false, failureReason: err.message }));

    if (!result.accepted) {
      this.logger.warn(
        `${input.context}: the message to ${input.to} was NOT sent (${result.failureReason ?? 'unknown error'}). ` +
          'What it was about is recorded and unaffected.',
      );
    }

    return {
      notified: result.accepted,
      detail: result.accepted
        ? `Sent (${this.gateway.mode}).`
        : `NOT sent: ${result.failureReason ?? 'unknown error'}.`,
    };
  }
}
