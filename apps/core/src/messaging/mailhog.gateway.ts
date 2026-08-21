import { Injectable, Logger } from '@nestjs/common';
import { createConnection, type Socket } from 'node:net';
import type { DispatchRequest, DispatchResult, MessagingGateway } from './gateway';

/**
 * A LOCAL-SINK email gateway — speaks minimal SMTP to Mailhog and nothing else.
 *
 * WHY THIS EXISTS RATHER THAN A LIBRARY: CLAUDE.md §7 requires asking before
 * adding a dependency with runtime network access, and nodemailer is squarely
 * that. This is a small amount of plaintext SMTP against a container on the
 * compose network whose entire purpose is to swallow mail, so it adds no
 * dependency and can reach nothing else.
 *
 * WHY IT IS NOT "SENDING EMAIL": Mailhog accepts everything and delivers
 * nothing. No message leaves this machine. Real sending still needs Carl's
 * sign-off, a registered sender identity, and DKIM/SPF/DMARC — procurement,
 * not code. This exists so the approval and rejection messages can be READ.
 *
 * It refuses to run in production, so it cannot become the accidental live
 * path: a gateway that silently discards notifications would be far worse
 * than none.
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

  /**
   * Minimal SMTP, driven by RESPONSE CODES rather than by counting packets.
   *
   * The first version counted `data` events and assumed one per step. That
   * breaks immediately: EHLO replies with several lines ("250-PIPELINING",
   * "250-SIZE", … , "250 HELP"), and TCP may split or coalesce any of them.
   * The counter desynchronised and the exchange hung until the timeout — which
   * at least reported honestly rather than claiming success.
   *
   * So: buffer, split on CRLF, and act only on a line of the form "NNN " with
   * a SPACE, which is how SMTP marks the final line of a reply.
   */
  private send(request: DispatchRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      const message = [
        `From: AoBPlatform <${this.from}>`,
        `To: ${request.to}`,
        `Subject: ${request.subject ?? 'AoBPlatform'}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        // Dot-stuffing: a line consisting of a single dot terminates the data.
        request.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'),
      ].join('\r\n');

      // Each step waits for an expected code, then sends the next command.
      const steps: Array<{ expect: number; send: string | null }> = [
        { expect: 220, send: `EHLO aobplatform` },
        { expect: 250, send: `MAIL FROM:<${this.from}>` },
        { expect: 250, send: `RCPT TO:<${request.to}>` },
        { expect: 250, send: 'DATA' },
        { expect: 354, send: `${message}\r\n.` },
        { expect: 250, send: 'QUIT' },
        { expect: 221, send: null },
      ];

      const socket: Socket = createConnection({ host: this.host, port: this.port });
      socket.setEncoding('utf8');
      socket.setTimeout(5000);

      let buffer = '';
      let index = 0;
      let settled = false;

      const fail = (message_: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(message_));
      };

      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 2);

          // Continuation lines look like "250-...". Only "250 ..." is final.
          if (!/^\d{3} /.test(line)) continue;
          const code = Number(line.slice(0, 3));
          const step = steps[index];
          if (!step) return;

          if (code !== step.expect) {
            return fail(`SMTP step ${index} expected ${step.expect}, got: ${line}`);
          }
          index += 1;
          if (step.send === null) {
            settled = true;
            socket.end();
            return resolve(`mailhog-${index}-${line.slice(0, 3)}`);
          }
          socket.write(step.send + '\r\n');
        }
      });

      socket.on('error', (err) => fail(err.message));
      socket.on('timeout', () => fail(`Mailhog at ${this.host}:${this.port} did not respond at SMTP step ${index}.`));
      socket.on('close', () => {
        if (!settled) fail(`Mailhog closed the connection at SMTP step ${index}.`);
      });
    });
  }
}
