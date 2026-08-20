import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AgreementsService } from './agreements.service';
import { CreateAgreementDto, LockParticularsDto, TransitionDto } from './agreements.dto';

/**
 * Practice scope currently arrives via the x-practice-id header.
 * TODO: replace with the authenticated principal's practice claim once
 * Keycloak lands (infra/keycloak) — the header is a dev-time stand-in, and
 * even now RLS means a wrong/absent id yields nothing rather than leaking.
 */
function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

@Controller('agreements')
export class AgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Post()
  create(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: CreateAgreementDto) {
    return this.agreements.createDraft(requirePractice(practiceId), dto);
  }

  @Get()
  list(@Headers('x-practice-id') practiceId: string | undefined, @Query('status') status?: string) {
    return this.agreements.list(requirePractice(practiceId), status);
  }

  @Get(':id')
  get(@Headers('x-practice-id') practiceId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.get(requirePractice(practiceId), id);
  }

  @Post(':id/particulars')
  lockParticulars(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockParticularsDto,
  ) {
    return this.agreements.lockParticulars(requirePractice(practiceId), id, dto);
  }

  @Post(':id/transition')
  transition(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
  ) {
    return this.agreements.transition(requirePractice(practiceId), id, dto.to);
  }
}
