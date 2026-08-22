import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { PendingEmailService } from './pending-email.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';

class ConfirmDto {
  @IsString() @Length(10, 200) token!: string;
  @IsString() @Length(6, 6) code!: string;
}

class StopDto {
  @IsString() @Length(10, 200) token!: string;
}

/**
 * Answering a held administrator-email change, from the link in the message.
 *
 * PUBLIC, because the whole point is that these are answered by somebody who
 * cannot sign in — either they hold an address that is not yet the practice's
 * administrator address, or they hold the one being taken away. Requiring a
 * session would mean only the person making the change could object to it.
 *
 * The token IS the authorisation. It is single-purpose, unguessable, scoped to
 * one request, and the confirm and stop tokens are separate so that holding one
 * never implies the other.
 */
@Controller('pending-email-change')
export class PendingEmailController {
  constructor(private readonly pending: PendingEmailService) {}

  /**
   * Confirming needs the CODE as well as the token, because the link alone is
   * opened by mail scanners, link previews and antivirus gateways — all of
   * which issue GETs. A POST carrying a typed code is what makes a human
   * necessary.
   */
  @Public()
  @Post('confirm')
  confirm(@Body() dto: ConfirmDto) {
    return this.pending.confirm(dto.token, dto.code);
  }

  /**
   * Stopping needs only the token — but it is still a POST.
   *
   * Not because stopping is dangerous; it is the safe direction, and somebody
   * who did not ask for the change should be able to object in one press. It is
   * a POST so that a scanner GETting the link cannot cancel a legitimate change
   * on the practice's behalf.
   */
  @Public()
  @Post('stop')
  stop(@Body() dto: StopDto, @SessionActor() actor: Actor | undefined) {
    return this.pending.stop(dto.token, actor);
  }

  /**
   * What the practice's own screens show while a change waits. Practice-scoped
   * rather than public: this one is read from inside the console.
   */
  @Get('live/:practiceId')
  live(@Param('practiceId') practiceId: string) {
    return this.pending.live(practiceId);
  }
}
