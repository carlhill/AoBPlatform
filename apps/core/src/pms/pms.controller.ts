import { BadRequestException, Controller, Headers, Post } from '@nestjs/common';
import { PmsSyncService } from './pms-sync.service';

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

@Controller('pms')
export class PmsController {
  constructor(private readonly sync: PmsSyncService) {}

  /** Staff-triggered invoice sync — scheduled sync per connected practice arrives with the real connector. */
  @Post('sync')
  syncInvoices(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.sync.syncInvoices(requirePractice(practiceId));
  }
}
