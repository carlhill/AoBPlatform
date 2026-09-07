import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ServiceDescriptionsService } from './service-descriptions.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';

/**
 * The chosen words. NOT validated against the list here, deliberately: the
 * list is versioned content and the service owns the comparison, so a single
 * refusal message names the version the caller's screen has gone stale
 * against. A `@IsIn` here would be a second copy of the list in a decorator.
 */
export class SetServiceDescriptionDto {
  @IsString()
  @MaxLength(200)
  description!: string;
}

export class SetDefaultServiceDescriptionDto {
  /** `null` clears the default — an explicit "we have not chosen one". */
  @IsOptional()
  @ValidateIf((o: SetDefaultServiceDescriptionDto) => o.description !== null)
  @IsString()
  @MaxLength(200)
  description!: string | null;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * D6a on a staff surface (CONSULTATION-CAPTURE-PLAN §2.4).
 *
 * A SEPARATE PREFIX RATHER THAN A ROUTE ON `AgreementsController`, and that is
 * a judgement worth stating: the list, the practice default and the pending
 * queue are not agreement resources, and hanging three of them off
 * `/agreements` to keep one of them tidy would put the versioned-content
 * endpoints somewhere nobody would look for them.
 *
 * NOTHING HERE CARRIES PII except the pending queue, which carries an initial
 * and a family name and no identifier of any kind — the same shape every other
 * practice list uses.
 */
@Controller('service-descriptions')
export class ServiceDescriptionsController {
  constructor(private readonly descriptions: ServiceDescriptionsService) {}

  /**
   * The list a screen renders, and the version it renders it as. The web app
   * NEVER carries these strings: they are the mapping C6 matches, and a copy
   * in a component is a copy that goes stale silently (hard rule 14).
   */
  @Get()
  list(@Headers('x-practice-id') practiceId: string | undefined) {
    requirePractice(practiceId);
    return this.descriptions.list();
  }

  /** The list plus this practice's default, for the settings control. */
  @Get('settings')
  settings(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.descriptions.settings(requirePractice(practiceId));
  }

  /** Drafts that cannot be locked until somebody chooses D6a. */
  @Get('pending')
  pending(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.descriptions.pending(requirePractice(practiceId));
  }

  @Put('default')
  setDefault(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: SetDefaultServiceDescriptionDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.descriptions.setDefault(requirePractice(practiceId), dto.description ?? null, actor);
  }

  /**
   * One draft gets its description. The acting staff member comes from the
   * verified session and never from the body — and the endpoint refuses
   * outright when there is none, because being able to say who did this is the
   * entire reason the control is here rather than on the tablet.
   *
   * DECLARED LAST: Nest matches in declaration order, and a `:agreementId`
   * above `pending` would try to parse the word "pending" as a UUID.
   */
  @Post('agreements/:agreementId')
  set(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: SetServiceDescriptionDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.descriptions.setFor(requirePractice(practiceId), agreementId, dto.description, actor);
  }
}
