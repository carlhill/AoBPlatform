import { Module } from '@nestjs/common';
import { UnsignedDraftClosureSweep } from './unsigned-draft-closure.sweep';

/** The hourly closure of unsigned agreements with no service after N days (D-2026-10-10-09, option 3). */
@Module({
  providers: [UnsignedDraftClosureSweep],
  exports: [UnsignedDraftClosureSweep],
})
export class UnsignedDraftsModule {}
