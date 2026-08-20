import { BadRequestException, Body, Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { VerificationService } from './verification.service';

export class StartChallengeDto {
  @IsUUID()
  patientId!: string;

  @IsIn(['in_practice', 'sms_link', 'email_link', 'portal', 'paper'])
  channel!: string;

  @IsArray()
  @ArrayMinSize(3)
  @IsString({ each: true })
  identifierTypes!: string[];
}

export class AttemptDto {
  /**
   * Stated identifier values, keyed by type. Remote channels are INPUT
   * FIELDS the person states into — never a "is this you? Y/N" confirmation
   * screen (REQ-VER-03). Values are compared and discarded.
   */
  @IsObject()
  stated!: Record<string, string>;

  @IsOptional()
  @IsString()
  verifiedByStaffId?: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('challenges')
  start(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: StartChallengeDto) {
    return this.verification.startChallenge(requirePractice(practiceId), dto);
  }

  @Post('challenges/:id/attempt')
  attempt(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttemptDto,
  ) {
    return this.verification.attempt(requirePractice(practiceId), id, dto);
  }
}
