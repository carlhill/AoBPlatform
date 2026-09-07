import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';
import { PracticeScoped } from '../auth/practice-scope.decorator';
import { ArrivalsService } from './arrivals.service';
import { ArrivalDto } from './arrivals.dto';

/** Reception naming the provider the claim will go under. One field, on purpose. */
export class ChooseProviderDto {
  @IsUUID()
  providerId!: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * WHERE A PRACTICE'S SOFTWARE SAYS SOMEBODY WALKED IN (Carl, 4 Sep 2026;
 * TODO.md "Reception-centric" §2).
 *
 * PRACTICE-SCOPED, THE PRACTICE'S OWN ACT — the same guard the connector's
 * other door uses (`POST /inbound/print-jobs`). A platform operator has no
 * business asserting that a patient arrived at somebody else's front desk, and
 * `@PracticeScoped` says so; acting-as still passes, and leaves a record of on
 * whose behalf. The `x-practice-id` header is the dev-time stand-in for the
 * connector's mTLS identity, exactly as it is everywhere else, and RLS means a
 * wrong or absent id yields nothing rather than leaking.
 *
 * `@Req` ALONGSIDE `@Body`, AND IT IS NOT LAZINESS — the same reason
 * `PATCH /patients/:id/details` does it. `whitelist: true` silently strips an
 * unknown field, which is right for a typo and WRONG for a forbidden one: a
 * body carrying a Medicare card number, or one asserting the agreement type,
 * would vanish and its sender would learn nothing. The raw key list goes to the
 * service, which refuses both out loud (hard rules 1, 6 and 14).
 *
 * 201, NOT 202. Unlike a print job this is not queued: by the time it returns,
 * the mirror is updated, the decision is made and recorded, and the draft — if
 * the visit needs one — exists and is on reception's queue. The response says
 * what was decided and why, so the connector's author can see the platform
 * disagreeing with their assumption rather than guessing.
 */
@Controller('arrivals')
export class ArrivalsController {
  constructor(private readonly arrivals: ArrivalsService) {}

  @Post()
  @PracticeScoped()
  receive(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: ArrivalDto,
    @Req() req: Request,
  ) {
    const sent = req.body && typeof req.body === 'object' ? Object.keys(req.body as object) : [];
    return this.arrivals.receive(requirePractice(practiceId), dto, sent);
  }

  /**
   * THE DESK'S "NEEDS A PROVIDER" LIST — arrivals refused for naming somebody
   * who cannot be the provider on an agreement (Carl, 5–7 Sep 2026).
   *
   * BEFORE `:id`, because `needing-a-provider` and `servicing-providers` are
   * not UUIDs and Nest matches routes in declaration order.
   */
  @Get('needing-a-provider')
  @PracticeScoped()
  needingAProvider(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.arrivals.needingAProvider(requirePractice(practiceId));
  }

  /** Who reception may choose instead. Servicing providers only, by the same rule that refused. */
  @Get('servicing-providers')
  @PracticeScoped()
  servicingProviders(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.arrivals.servicingProviders(requirePractice(practiceId));
  }

  /**
   * RECEPTION'S FIX. Names the provider the claim goes under and the platform
   * replays the PMS's own message under the same idempotency key, so the retry
   * supersedes the refusal instead of making a second walk-in.
   */
  @Post(':id/provider')
  @PracticeScoped()
  chooseProvider(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChooseProviderDto,
  ) {
    return this.arrivals.chooseProvider(requirePractice(practiceId), id, dto.providerId);
  }

  /**
   * One arrival, read back. Ids, a decision and a version — no patient value of
   * any kind, because there is nothing here a screen needs them for and the
   * work page already reads the five details from the one mirror.
   */
  @Get(':id')
  get(@Headers('x-practice-id') practiceId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.arrivals.get(requirePractice(practiceId), id);
  }
}
