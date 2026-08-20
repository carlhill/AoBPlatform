import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsObject, IsUUID } from 'class-validator';
import { CaptureService } from './capture.service';

export class OpenCaptureDto {
  @IsUUID()
  agreementId!: string;

  @IsIn(['in_practice', 'sms_link', 'email_link', 'paper'])
  channel!: string;
}

export class LinkVerifyDto {
  @IsObject()
  stated!: Record<string, string>;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

@Controller('capture')
export class CaptureController {
  constructor(private readonly capture: CaptureService) {}

  /** Staff-side: open a capture request for an agreement. */
  @Post()
  open(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: OpenCaptureDto) {
    return this.capture.open(requirePractice(practiceId), dto);
  }

  /** Staff-side: mark completed; closes every other open channel (FR-2.7). */
  @Post(':id/complete')
  complete(@Headers('x-practice-id') practiceId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.capture.complete(requirePractice(practiceId), id);
  }

  /**
   * PUBLIC landing (no practice header — scope comes from the token itself).
   * Content-blind: the response names nobody (REQ-CHILD-04). Bot/velocity
   * controls (REQ-BOT-*) attach here when the bot-defence slice lands.
   */
  @Get('link/:token')
  openLink(@Param('token') token: string) {
    return this.capture.openLink(token);
  }

  @Post('link/:token/verify')
  verifyLink(@Param('token') token: string, @Body() dto: LinkVerifyDto) {
    return this.capture.verifyLink(token, dto.stated);
  }
}
