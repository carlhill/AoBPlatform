import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PracticesController } from './practices.controller';
import { PracticesService } from './practices.service';
import { PracticeUsersController } from './practice-users.controller';
import { PracticeUsersService } from './practice-users.service';

@Module({
  // For KEYCLOAK_ADMIN: inviting somebody creates their account and sends
  // the enrolment link, which is the identity layer's job rather than ours.
  imports: [IdentityModule],
  controllers: [PracticesController, PracticeUsersController],
  providers: [PracticesService, PracticeUsersService],
  exports: [PracticesService],
})
export class PracticesModule {}
