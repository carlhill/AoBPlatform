import { Module } from '@nestjs/common';
import { ServiceDescriptionsController } from './service-descriptions.controller';
import { ServiceDescriptionsService } from './service-descriptions.service';
import { RulesClientModule } from '../rules-client/rules-client.module';

/**
 * D6a on a staff surface. Exported because the appointment sweep asks it for
 * the practice's default when it drafts a pre-agreement — behaviour through a
 * module API, never another module reaching into these tables.
 */
@Module({
  imports: [RulesClientModule],
  controllers: [ServiceDescriptionsController],
  providers: [ServiceDescriptionsService],
  exports: [ServiceDescriptionsService],
})
export class ServiceDescriptionsModule {}
