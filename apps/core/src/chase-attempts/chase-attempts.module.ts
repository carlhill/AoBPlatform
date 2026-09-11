import { Module } from '@nestjs/common';
import { ChaseAttemptsController } from './chase-attempts.controller';
import { ChaseAttemptsService } from './chase-attempts.service';

/** M7 — the human half of the chase ladder (Carl, 3 Sep 2026). */
@Module({
  controllers: [ChaseAttemptsController],
  providers: [ChaseAttemptsService],
  exports: [ChaseAttemptsService],
})
export class ChaseAttemptsModule {}
