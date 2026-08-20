import { Module } from '@nestjs/common';
import { EnduringController } from './enduring.controller';
import { EnduringService } from './enduring.service';

@Module({
  controllers: [EnduringController],
  providers: [EnduringService],
  exports: [EnduringService],
})
export class EnduringModule {}
