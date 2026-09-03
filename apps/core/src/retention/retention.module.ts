import { Module } from '@nestjs/common';
import { ArtefactsModule } from '../artefacts/artefacts.module';
import { RetentionSweepService } from './retention-sweep.service';

/** The hourly retention sweep. CorrespondenceModule is global; artefacts come through its module API. */
@Module({
  imports: [ArtefactsModule],
  providers: [RetentionSweepService],
  exports: [RetentionSweepService],
})
export class RetentionModule {}
