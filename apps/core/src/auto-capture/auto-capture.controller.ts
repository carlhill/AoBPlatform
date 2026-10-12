import { BadRequestException, Body, Controller, Headers, Post } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import type { IsoDate } from '@aobplatform/domain';
import { AutoCaptureService } from './auto-capture.service';

class SyncAppointmentsDto {
  /** Defaults to today. ISO date, because "today" depends on whose clock. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * The two PMS-driven triggers, as the practice presses them.
 *
 * `POST /pms/sync` KEPT ITS ROUTE and its response shape (`created`, `updated`,
 * `total`) and gained `captured` and `suppressed` — because what a practice
 * means by "sync" is not "copy the invoices" but "and then ask the patients we
 * now know we have to ask". Moved here from `PmsModule` because that
 * orchestration needs `AgreementsService`, which imports `PmsModule` for
 * write-back; the mirror step stays there, pure.
 *
 * Both are staff-triggered today. The scheduled versions arrive with the
 * print-capture adapter (CONSULTATION-CAPTURE-PLAN.md Part 8), where the
 * document landing IS the trigger.
 */
@Controller('pms')
export class AutoCaptureController {
  constructor(private readonly autoCapture: AutoCaptureService) {}

  @Post('sync')
  syncInvoices(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.autoCapture.syncInvoicesAndCapture(requirePractice(practiceId));
  }

  @Post('sync-appointments')
  syncAppointments(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: SyncAppointmentsDto) {
    return this.autoCapture.syncAppointments(requirePractice(practiceId), dto.date as IsoDate | undefined);
  }
}
