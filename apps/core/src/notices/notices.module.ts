import { Module } from '@nestjs/common';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';
import { MESSAGING_GATEWAY, SandboxGateway } from '../messaging/gateway';

/**
 * The gateway is the SANDBOX in dev: real sends need a registered ACMA sender
 * ID, cost money, and require asking Carl first (CLAUDE.md §7). Swapping in a
 * real provider is one provider binding.
 */
@Module({
  controllers: [NoticesController],
  providers: [NoticesService, SandboxGateway, { provide: MESSAGING_GATEWAY, useExisting: SandboxGateway }],
  exports: [NoticesService, MESSAGING_GATEWAY, SandboxGateway],
})
export class NoticesModule {}
