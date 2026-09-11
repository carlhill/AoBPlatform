import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { MANUAL_REVIEW_RESOLUTIONS, REVIEW_TASK_KINDS } from '@aobplatform/domain';
import { ReviewTasksService } from './review-tasks.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';

export class ResolveTaskDto {
  /*
   * THE MANUAL LIST, NOT EVERY RESOLUTION. `reinvited` records an ACT — a new
   * portal invitation was minted — and only the code that performs that act
   * may write it. Accepting it here would let a caller close a locked
   * invitation by saying a replacement went out (Carl, 5 Sep 2026).
   */
  @IsIn(MANUAL_REVIEW_RESOLUTIONS as unknown as string[])
  resolution!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * The review queue.
 *
 * SCOPED TO A PRACTICE like everything else that carries practice data. A task
 * summary names what changed on a practice record, which is not a thing to
 * hand across tenants.
 *
 * There is deliberately no endpoint for an automated check to POST a
 * resolution directly. A checker reports its VERDICT through
 * `recordAutomatedCheck`, and whether that closes the task is the domain's
 * decision — putting a `resolve` endpoint in reach of a checker would let a
 * future caller write "reviewed" for something nothing reviewed.
 */
@Controller('review-tasks')
export class ReviewTasksController {
  constructor(private readonly tasks: ReviewTasksService) {}

  @Get()
  list(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('state') state?: string,
    @Query('kind') kind?: string,
  ) {
    return this.tasks.list(practiceId, { state, kind });
  }

  @Post(':id/claim')
  claim(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.tasks.claim(practiceId ?? '', id, actor);
  }

  @Post(':id/resolve')
  resolve(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTaskDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.tasks.resolve(practiceId ?? '', id, { resolution: dto.resolution, note: dto.note }, actor);
  }

  /** The kinds, their questions, and which may be closed automatically. */
  @Get('catalogue')
  catalogue() {
    return { kinds: REVIEW_TASK_KINDS, resolutions: MANUAL_REVIEW_RESOLUTIONS };
  }
}
