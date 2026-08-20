import { Module } from '@nestjs/common';
import { AGREEMENT_RENDERER, CanonicalJsonRenderer } from './renderer';

@Module({
  providers: [{ provide: AGREEMENT_RENDERER, useClass: CanonicalJsonRenderer }],
  exports: [AGREEMENT_RENDERER],
})
export class RenderModule {}
