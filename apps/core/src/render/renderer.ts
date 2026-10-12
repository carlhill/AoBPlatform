import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json';

/**
 * Rule 13 — ONE deterministic render path. Agreements render server-side,
 * are hashed at render, and any later display re-verifies the hash. Two
 * renders of the same agreement must be byte-identical.
 *
 * Renderers are VERSIONED CONTENT, like rule sets (rule 14): every agreement
 * records the rendererVersion that produced its artefact, and re-rendering
 * for verification always uses THAT version — a new renderer is a new
 * version, never an in-place edit, or every previously stored hash would
 * stop verifying.
 */
export interface RenderedArtefact {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly rendererVersion: string;
  readonly mediaType: string;
}

export interface AgreementRenderer {
  render(particulars: Record<string, unknown>, languages: readonly string[]): Promise<RenderedArtefact>;
}

export const AGREEMENT_RENDERER = Symbol('AGREEMENT_RENDERER');

/**
 * DEV reference renderer — deterministic canonical JSON. Retained as a
 * registered version forever: agreements locked under it must keep
 * re-verifying against it (rule 13 + rule 14 together).
 */
export class CanonicalJsonRenderer implements AgreementRenderer {
  static readonly VERSION = 'dev-canonical-json-1';

  async render(particulars: Record<string, unknown>, languages: readonly string[]): Promise<RenderedArtefact> {
    const canonical = canonicalJson({ particulars, languages, renderer: CanonicalJsonRenderer.VERSION });
    const bytes = Buffer.from(canonical, 'utf8');
    return {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rendererVersion: CanonicalJsonRenderer.VERSION,
      mediaType: 'application/json',
    };
  }
}

/*
 * RE-EXPORTED, NOT REDECLARED. The one implementation lives in
 * `./canonical-json`; this module used to carry a copy of it (see that file for
 * why three copies was a hard-rule-13 problem). Kept exported here so nothing
 * that imports it from this module has to move.
 */
export { canonicalJson };
