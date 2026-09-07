import { Inject, Injectable } from '@nestjs/common';
import { CanonicalJsonRenderer, type AgreementRenderer } from './renderer';
import { DeterministicPdfRenderer } from './pdf-renderer';
import { AgreementPdfRenderer } from './agreement-pdf-renderer';
import { LOGO_LOADER, type LogoLoader } from './logo-loader';

/**
 * Resolves renderers by version. New agreements lock under `current`;
 * verification re-renders always resolve the version recorded ON the
 * agreement — never silently the newest (rule 13/14).
 *
 * NOTHING IS EVER REMOVED FROM THIS MAP. `dev-canonical-json-1` and `pdf-1`
 * are superseded, not retired: agreements locked under them must keep
 * re-verifying against them for as long as those agreements are retained, and
 * an unregistered version is an artefact nobody can re-verify (the portal
 * answers 409 rather than serving it, which is the right answer and a bad
 * outcome).
 */
@Injectable()
export class RendererRegistry {
  private readonly renderers: Map<string, AgreementRenderer>;

  readonly currentVersion = AgreementPdfRenderer.VERSION;

  constructor(@Inject(LOGO_LOADER) logos: LogoLoader) {
    this.renderers = new Map<string, AgreementRenderer>([
      [CanonicalJsonRenderer.VERSION, new CanonicalJsonRenderer()],
      [DeterministicPdfRenderer.VERSION, new DeterministicPdfRenderer()],
      [AgreementPdfRenderer.VERSION, new AgreementPdfRenderer(logos)],
    ]);
  }

  current(): AgreementRenderer {
    return this.renderers.get(this.currentVersion)!;
  }

  get(version: string | null | undefined): AgreementRenderer | undefined {
    return this.renderers.get(version ?? '');
  }
}

/**
 * WHAT TO HAND A RENDERER WHEN RE-VERIFYING A STORED AGREEMENT.
 *
 * From 5 September 2026 the lock stores the whole rendered DOCUMENT —
 * letterhead, resolved words and particulars — in `renderPayload`, because a
 * render that omits a field cannot detect a change to it. Agreements locked
 * before that carry only `particulars`, and their renderer (`pdf-1`, or the
 * dev canonical-JSON one) takes exactly that.
 *
 * ONE HELPER RATHER THAN THREE COPIES OF `??`. Three call sites re-render to
 * check a hash — signing, PMS write-back and the patient's own copy — and the
 * choice between the two shapes must be identical in all three or one of them
 * starts reporting determinism violations that are really a shape mismatch.
 */
export function renderInputOf(agreement: {
  renderPayload?: unknown;
  particulars: unknown;
}): Record<string, unknown> {
  const stored = agreement.renderPayload;
  if (stored && typeof stored === 'object') return stored as Record<string, unknown>;
  return (agreement.particulars ?? {}) as Record<string, unknown>;
}
