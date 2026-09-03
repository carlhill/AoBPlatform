import { BadRequestException, Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AgreementsService } from './agreements.service';
import {
  ChangeAssignorDto,
  CreateAgreementDto,
  LockParticularsDto,
  SignDto,
  TransitionDto,
} from './agreements.dto';

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

  /**
   * Somebody other than the patient is signing — or the patient is after all.
   *
   * ON THE AGREEMENT, NOT ON THE CAPTURE REQUEST, and deliberately: D7 is a
   * particular of the AGREEMENT, one of the things the rule set validates and
   * the renderer prints. A capture request is a channel — a link, a tablet, a
   * piece of paper — and the same agreement may have several open at once
   * (FR-2.7). Hanging "who signs" off one of them would let two channels
   * disagree about the party to a single contract. So it sits beside
   * `:id/particulars` and `:id/sign`, in the order the ceremony runs.
   */
  @Post(':id/assignor')
  changeAssignor(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeAssignorDto,
  ) {
    return this.agreements.changeAssignor(requirePractice(practiceId), id, dto);
  }

  @Post(':id/particulars')
  lockParticulars(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockParticularsDto,
  ) {
    return this.agreements.lockParticulars(requirePractice(practiceId), id, dto);
  }

  @Post(':id/sign')
  sign(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignDto,
    @Ip() ip: string,
  ) {
    return this.agreements.sign(requirePractice(practiceId), id, { ...dto, ipAddress: ip });
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
