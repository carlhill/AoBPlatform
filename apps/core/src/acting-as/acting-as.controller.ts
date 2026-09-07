import { Body, Controller, Get, Post, Query, ParseUUIDPipe, Param } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ACTING_AS_REASONS, ACTING_AS_REASON_KEYS } from '@aobplatform/domain';
import { ActingAsService } from './acting-as.service';
import { PLATFORM_ADMIN, RequireRoles } from '../auth/roles.decorator';
import { SessionActor, type Actor } from '../auth/actor.decorator';

export class StartActingAsDto {
  @IsUUID()
  practiceId!: string;

  @IsIn(ACTING_AS_REASON_KEYS)
  reason!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * Starting and stopping an acting-as session.
 *
 * PLATFORM OPERATORS ONLY, obviously — but note what is NOT restricted: the
 * log. Reading who has acted as whom is deliberately open to any signed-in
 * operator, because a record of impersonation that only the impersonators can
 * read is not much of a record.
 */
@Controller('acting-as')
export class ActingAsController {
  constructor(private readonly actingAs: ActingAsService) {}

  @RequireRoles(PLATFORM_ADMIN)
  @Post('start')
  start(@Body() dto: StartActingAsDto, @SessionActor() actor: Actor | undefined) {
    return this.actingAs.start({ practiceId: dto.practiceId, reason: dto.reason, note: dto.note }, actor);
  }

  /** Always allowed. The way out must never be the difficult part. */
  @Post('end')
  end(@SessionActor() actor: Actor | undefined) {
    return this.actingAs.end(actor);
  }

  /** What the banner reads: am I acting as anybody right now? */
  @Get('current')
  async current(@SessionActor() actor: Actor | undefined) {
    if (!actor) return { acting: false };
    const open = await this.actingAs.openFor(actor.id);
    return open ? { acting: true, session: open } : { acting: false };
  }

  @Get()
  list(@Query('practiceId') practiceId?: string) {
    return this.actingAs.list(practiceId);
  }

  /**
   * Stopping somebody else's session.
   *
   * Every session expires by computation after the cap, so nothing is ever left
   * open indefinitely. This is for ending one EARLY, which is what you want the
   * moment you notice a session that should not be running.
   */
  @Post(':sessionId/end')
  endOther(@Param('sessionId', ParseUUIDPipe) sessionId: string, @SessionActor() actor: Actor | undefined) {
    return this.actingAs.endOther(sessionId, actor);
  }

  @Get('catalogue')
  catalogue() {
    return { reasons: ACTING_AS_REASONS };
  }
}
