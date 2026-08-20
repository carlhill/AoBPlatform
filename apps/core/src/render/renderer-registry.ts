import { Injectable } from '@nestjs/common';
import { CanonicalJsonRenderer, type AgreementRenderer } from './renderer';
import { DeterministicPdfRenderer } from './pdf-renderer';

/**
 * Resolves renderers by version. New agreements lock under `current`;
 * verification re-renders always resolve the version recorded ON the
 * agreement — never silently the newest (rule 13/14).
 */
@Injectable()
export class RendererRegistry {
  private readonly renderers = new Map<string, AgreementRenderer>([
    [CanonicalJsonRenderer.VERSION, new CanonicalJsonRenderer()],
    [DeterministicPdfRenderer.VERSION, new DeterministicPdfRenderer()],
  ]);

  readonly currentVersion = DeterministicPdfRenderer.VERSION;

  current(): AgreementRenderer {
    return this.renderers.get(this.currentVersion)!;
  }

  get(version: string | null | undefined): AgreementRenderer | undefined {
    return this.renderers.get(version ?? '');
  }
}
