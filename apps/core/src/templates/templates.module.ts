import { Module } from '@nestjs/common';
import { PlatformTemplatesController, TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * Which words a practice's agreements are made from (W1).
 *
 * EXPORTED because the LOCK asks it, once, for every agreement: `prepareLock`
 * resolves the template before it renders. Behaviour through a module API,
 * never another module reaching into these rows (CLAUDE.md §4).
 */
@Module({
  controllers: [TemplatesController, PlatformTemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
