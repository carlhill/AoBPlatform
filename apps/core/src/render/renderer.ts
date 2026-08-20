import { createHash } from 'node:crypto';

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

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
