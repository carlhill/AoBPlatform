import { Injectable, Logger } from '@nestjs/common';
import { createConnection, type Socket } from 'node:net';
import type { DispatchRequest, DispatchResult, MessagingGateway } from './gateway';

/**
 * A LOCAL-SINK email gateway — speaks minimal SMTP to Mailhog and nothing else.
 *
 * WHY THIS EXISTS RATHER THAN A LIBRARY: CLAUDE.md §7 requires asking before
 * adding a dependency with runtime network access, and nodemailer is squarely
 * that. This is ~60 lines of plaintext SMTP against a container on localhost
 * whose entire purpose is to swallow mail, so it adds no dependency and can
 * reach nothing else.
 *
 * WHY IT IS NOT "SENDING EMAIL": Mailhog accepts everything and delivers
 * nothing. No message leaves this machine. Real sending still needs Carl's
 * sign-off, a registered sender identity, and DKIM/SPF/DMARC — a procurement
 * task, not a code task. This exists so the approval and rejection emails can
 * be READ and reviewed before any of that.
 *
 * It refuses to run outside development, so it cannot become the accidental
 * production path.
 */
@Injectable()
export class MailhogGateway implements MessagingGateway {
  readonly mode = 'mailhog';
  private readonly logger = new Logger(MailhogGateway.name);

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly from = 'noreply@aobplatform.local',
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MailhogGateway must never run in production: it is a local sink that accepts mail and delivers ' +
          'nothing, so every notification would be silently discarded.',
      );
    }
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    if (request.channel !== 'email') {
      return { accepted: false, failureCode: 'unsupported_channel', failureReason: `${request.channel} is not email.` };
    }
    try {
      const id = await this.send(request);
      // The log carries no recipient and no body (REQ-LOG-08).
      this.logger.log(`[mailhog] delivered to the local sink (${request.body.length} chars)`);
      return { accepted: true, gatewayMessageId: id };
    } catch (err) {
      this.logger.warn(`[mailhog] dispatch failed: ${(err as Error).message}`);
      return { accepted: false, failureCode: 'smtp_error', failureReason: (err as Error).message };
    }
  }

  private send(request: DispatchRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket: Socket = createConnection({ host: this.host, port: this.port });
      socket.setEncoding('utf8');
      socket.setTimeout(5000);

      const body = [
        `From: AoBPlatform <${this.from}>`,
        `To: ${request.to}`,
        `Subject: ${request.subject ?? 'AoBPlatform'}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        // SMTP dot-stuffing: a line that is a single dot ends the message.
        request.body.replace(/\r?\n\./g, '\n..'),
        '.',
      ].join('\r\n');

      const steps = [`EHLO aobplatform`, `MAIL FROM:<${this.from}>`, `RCPT TO:<${request.to}>`, 'DATA', body, 'QUIT'];
      let step = -1; // -1 while waiting for the server greeting

      socket.on('data', () => {
        step += 1;
        if (step >= steps.length) return;
        socket.write(steps[step] + (steps[step] === body ? '' : '\r\n'));
      });
      socket.on('error', reject);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`Mailhog at ${this.host}:${this.port} did not respond.`));
      });
      socket.on('close', () => resolve(`mailhog-${Date.now()}`));
    });
  }
}
