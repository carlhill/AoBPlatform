import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MESSAGING_GATEWAY, SandboxGateway } from './gateway';
import { MailhogGateway } from './mailhog.gateway';
import { EmailComposer } from './composer.service';
import { PortalRecordIdLine } from './portal-record-id.service';

/**
 * Outbound messaging (CLAUDE.md §7).
 *
 * DEFAULTS TO THE SANDBOX, which records what would have been sent and never
 * opens a socket. Setting MAIL_SANDBOX_SMTP_HOST switches to Mailhog — still a
 * local sink that delivers nothing, but one you can READ, so the approval and
 * rejection emails can be reviewed before anybody decides to send mail for
 * real. Real sending needs Carl's sign-off, a registered sender identity and
 * DKIM/SPF/DMARC; that is procurement, not code.
 */
@Global()
@Module({
  providers: [
    EmailComposer,
    /*
     * THE RECORD ID SENTENCE, for any sender whose recipient is a patient with
     * a portal record (Carl, 4 Sep 2026). It lives here because it is part of
     * what a message from us looks like, beside the footer — see its own file
     * for why it is not in the portal module.
     */
    PortalRecordIdLine,
    {
      provide: MESSAGING_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('MAIL_SANDBOX_SMTP_HOST');
        if (!host) return new SandboxGateway();
        const port = Number(config.get<string>('MAIL_SANDBOX_SMTP_PORT', '1025'));
        new Logger('MessagingModule').log(`Email goes to the local sink at ${host}:${port}. Nothing leaves this machine.`);
        return new MailhogGateway(host, port);
      },
    },
  ],
  exports: [MESSAGING_GATEWAY, EmailComposer, PortalRecordIdLine],
})
export class MessagingModule {}
