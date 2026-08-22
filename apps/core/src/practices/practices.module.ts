import { Module } from '@nestjs/common';
import { PracticesController } from './practices.controller';
import { PracticesService } from './practices.service';
import { PracticeUsersController } from './practice-users.controller';
import { PracticeUsersService } from './practice-users.service';

@Module({
  controllers: [PracticesController, PracticeUsersController],
  providers: [PracticesService, PracticeUsersService],
  exports: [PracticesService],
})
export class PracticesModule {}
