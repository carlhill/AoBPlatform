import { Module } from '@nestjs/common';
import { RendererRegistry } from './renderer-registry';

@Module({
  providers: [RendererRegistry],
  exports: [RendererRegistry],
})
export class RenderModule {}
