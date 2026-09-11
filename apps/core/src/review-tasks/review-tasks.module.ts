import { Global, Module } from '@nestjs/common';
import { ReviewTasksController } from './review-tasks.controller';
import { ReviewTasksService } from './review-tasks.service';

/**
 * Global, because anything that changes a practice record may need to raise a
 * task — and a service some callers cannot reach is one some changes will
 * quietly skip.
 */
@Global()
@Module({
  controllers: [ReviewTasksController],
  providers: [ReviewTasksService],
  exports: [ReviewTasksService],
})
export class ReviewTasksModule {}
