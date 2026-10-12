import { Injectable, Logger } from '@nestjs/common';

/**
 * Outbound messaging. CLAUDE.md §7: anything that sends a real SMS or email
 * requires asking Carl first — real sends need a registered ACMA sender ID
 * and cost money. Dev therefore runs the SandboxGateway, which records what
 * WOULD have been sent and never touches a network.
 *
 * The real gateway (tier-1 SMS provider, dedicated number per practice; SES
 * or equivalent with DKIM/SPF/DMARC) implements this same interface — a
 * procurement task in Phase 0, not a code task.
 */
export interface DispatchRequest {
  readonly channel: string;
  readonly to: string;
  readonly subject?: string;
  /**
   * The plain-text part. ALWAYS required, never optional.
   *
   * Not because many people read plain text, but because a message with no
   * text part scores as spam with most filters, and because screen readers and
   * terminal clients deserve better than tag soup. When `html` is present the
   * two are sent as multipart/alternative and the client picks.
   */
  readonly body: string;
  /** The HTML part, when the message has a designed form. */
  readonly html?: string;
}

export interface DispatchResult {
  readonly accepted: boolean;
  readonly gatewayMessageId?: string;
  readonly failureCode?: string;
  readonly failureReason?: string;
}

export interface MessagingGateway {
  readonly mode: string;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
}

export const MESSAGING_GATEWAY = Symbol('MESSAGING_GATEWAY');

/** Records what would have been sent. Never opens a socket. */
@Injectable()
export class SandboxGateway implements MessagingGateway {
  readonly mode = 'sandbox';
  private readonly logger = new Logger(SandboxGateway.name);
  private readonly sent: Array<DispatchRequest & { gatewayMessageId: string }> = [];
  /** Test seam: force the next dispatch to fail, to exercise the failure path. */
  failNext = false;

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    if (this.failNext) {
      this.failNext = false;
      return { accepted: false, failureCode: 'sandbox_forced_failure', failureReason: 'Forced failure (test seam).' };
    }
    const gatewayMessageId = `sandbox-${this.sent.length + 1}-${Date.now()}`;
    this.sent.push({ ...request, gatewayMessageId });
    // No recipient address, no body: this line is a log, and logs carry no PII.
    this.logger.log(`[sandbox] would dispatch via ${request.channel} (${request.body.length} chars)`);
    return { accepted: true, gatewayMessageId };
  }

  /** Inspection for tests and the dev console. */
  outbox(): ReadonlyArray<DispatchRequest & { gatewayMessageId: string }> {
    return this.sent;
  }
}
