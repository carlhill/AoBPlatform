import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { PendingEmailService } from './pending-email.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PractitionerEmailService } from '../identity/practitioner-email.service';

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
  constructor(
    private readonly pending: PendingEmailService,
    private readonly practitionerEmail: PractitionerEmailService,
  ) {}

  /**
   * Confirming needs the CODE as well as the token, because the link alone is
   * opened by mail scanners, link previews and antivirus gateways — all of
   * which issue GETs. A POST carrying a typed code is what makes a human
   * necessary.
   */
  @Public()
  @Post('confirm')
  async confirm(@Body() dto: ConfirmDto) {
    /*
     * ONE LINK, TWO KINDS OF SUBJECT. The message cannot say which -- printing
     * "this is a practitioner address change" in a link would tell whoever
     * intercepted it something about the account before they proved anything.
     * So the token is resolved first and the answer routed by what it names.
     *
     * The two paths differ in more than plumbing: confirming a PRACTICE
     * administrator address hands the account over and revokes its passkeys,
     * because that account belongs to the practice. Confirming a
     * PRACTITIONER's does not, because that credential is the person's own.
     */
    const found = await this.pending.resolve(dto.token, 'confirm');
    if (!found) throw new NotFoundException('That confirmation link is not one of ours, or it has been replaced.');

    if (found.practitionerId) return this.practitionerEmail.confirm(found, dto.code);
    // Same subject, two very different confirmations: adminEmail hands the
    // account over, groupEmail just writes a column. See PendingEmailChange.field.
    if (found.field === 'groupEmail') return this.pending.confirmGroupEmail(found, dto.code);
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
  async stop(@Body() dto: StopDto, @SessionActor() actor: Actor | undefined) {
    const found = await this.pending.resolve(dto.token, 'stop');
    if (!found) throw new NotFoundException('That link is not one of ours.');

    if (found.practitionerId) return this.practitionerEmail.stop(found);
    if (found.field === 'groupEmail') return this.pending.stopGroupEmail(found, actor);
    return this.pending.stop(dto.token, actor);
  }

  /**
   * A BACKUP address answers, from the link we sent it.
   *
   * Public for the same reason the confirm above is, and more so: whoever
   * holds this link may have no account at all — a spouse, a colleague, a
   * practice manager whose only involvement is agreeing to be the second
   * channel. The token finds the row; the code proves a human read the
   * message rather than a scanner GETting the link.
   */
  @Public()
  @Post('confirm-backup')
  confirmBackup(@Body() dto: ConfirmDto) {
    return this.practitionerEmail.confirmBackup(dto.token, dto.code);
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
