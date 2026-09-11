import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TemplatesService } from './templates.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PracticeScoped } from '../auth/practice-scope.decorator';
import { PLATFORM_ADMIN, RequireRoles } from '../auth/roles.decorator';

export class ProposeTemplateDto {
  @IsIn(['episodic', 'enduring'])
  agreementType!: string;

  /**
   * The practice mints it, and it is recorded on every agreement made from it.
   * Constrained to the same shape the content file uses so a version is always
   * sortable and always ends in a number — a rewrite mints a new one.
   */
  @Matches(/^[a-z][a-z0-9-]*-[0-9]+$/, {
    message: 'version must be lower-kebab-case ending in a number, e.g. testville-episodic-1',
  })
  @MaxLength(60)
  version!: string;

  @IsObject()
  body!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ReviewTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNotes?: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * PER-PRACTICE AGREEMENT WORDING — the practice's side and the platform's,
 * deliberately on two prefixes (Carl, 5 Sep 2026; W1).
 *
 * `/agreement-templates` is the PRACTICE surface: read the generic words, see
 * your own variants, propose one, submit it, withdraw it. Practice-scoped, so
 * a platform operator with no practice claim is refused rather than shown an
 * empty list that reads as "no variants".
 *
 * `/platform/agreement-templates` is the REVIEW surface, and every route on it
 * requires `platform_admin`. Activation is the one act a practice may not
 * perform on its own wording — see `TemplatesService.activate` for why, and
 * for the two other layers that hold the same line.
 */
@Controller('agreement-templates')
@PracticeScoped()
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /** The generic words, this practice's variants, and the declared placeholders. */
  @Get()
  list(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.templates.list(requirePractice(practiceId));
  }

  /** What a new agreement of this type would actually be worded from, today. */
  @Get('resolved')
  resolved(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('agreementType') agreementType?: string,
  ) {
    return this.templates.resolve(requirePractice(practiceId), agreementType ?? 'episodic_pre');
  }

  @Post()
  propose(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: ProposeTemplateDto,
    @SessionActor() actor?: Actor,
  ) {
    return this.templates.propose(requirePractice(practiceId), dto, actor);
  }

  @Post(':id/submit')
  submit(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor?: Actor,
  ) {
    return this.templates.submit(requirePractice(practiceId), id, actor);
  }

  @Post(':id/retire')
  retire(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor?: Actor,
  ) {
    return this.templates.retire(requirePractice(practiceId), id, actor);
  }
}

/**
 * The platform reviewer's twin. Same rows, different authority.
 *
 * THE QUEUE READS ACROSS PRACTICES, which every other list on this platform
 * does not. It is the only honest shape for a review queue — a reviewer's
 * question is "what is waiting", not "what is waiting at this practice" — and
 * it carries no patient data of any kind: a practice name, a type, a version
 * and a date.
 */
@Controller('platform/agreement-templates')
@RequireRoles(PLATFORM_ADMIN)
export class PlatformTemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async queue() {
    /*
     * A SECURITY DEFINER READ, because RLS cannot express this question. A
     * platform reviewer has no practice context by definition, so there is no
     * `app.practice_id` that would be correct — the same reasoning, and the
     * same mechanism, as the identity dashboards (CONVENTIONS.md §6).
     *
     * The function returns submitted and active wording only, never a
     * practice's private drafts, and carries no patient data of any kind.
     */
    const waiting = await this.prisma.$queryRaw<
      Array<{
        id: string;
        practiceId: string;
        practiceName: string;
        agreementType: string;
        version: string;
        status: string;
        body: unknown;
        notes: string | null;
        submittedByName: string | null;
        submittedAt: Date | null;
        reviewedByName: string | null;
        reviewNotes: string | null;
        activatedAt: Date | null;
      }>
    >`SELECT * FROM agreement_templates_awaiting_review()`;
    return { waiting };
  }

  @Post(':practiceId/:id/activate')
  activate(
    @Param('practiceId', ParseUUIDPipe) practiceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewTemplateDto,
    @SessionActor() actor?: Actor,
  ) {
    return this.templates.activate(practiceId, id, dto.reviewNotes, actor);
  }

  @Post(':practiceId/:id/request-changes')
  requestChanges(
    @Param('practiceId', ParseUUIDPipe) practiceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewTemplateDto,
    @SessionActor() actor?: Actor,
  ) {
    return this.templates.requestChanges(practiceId, id, dto.reviewNotes ?? '', actor);
  }
}
