import { createHash } from 'node:crypto';

/**
 * Rule 13 — ONE deterministic render path. Agreements render server-side,
 * are hashed at render, and any later display re-verifies the hash. Two
 * renders of the same agreement must be byte-identical.
 *
 * The renderer is a versioned artefact of its own (tech stack §3.1): the
 * rendererVersion is recorded on every signature event so an artefact always
 * verifies against the renderer that produced it.
 */
export interface RenderedArtefact {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly rendererVersion: string;
  readonly mediaType: string;
}

export interface AgreementRenderer {
  render(particulars: Record<string, unknown>, languages: readonly string[]): RenderedArtefact;
}

export const AGREEMENT_RENDERER = Symbol('AGREEMENT_RENDERER');

/**
 * ⚠ DEV PLACEHOLDER — deterministic, but NOT the production renderer.
 * Production is a pinned-font, server-side PDF/A pipeline (rule 13, tech
 * stack §3.1) and is its own build slice. This placeholder preserves the
 * semantics everything downstream depends on — stable canonical bytes,
 * hash-at-render, versioned renderer — so the signature-binding and
 * re-verification machinery is real even while the visual artefact is not.
 */
export class CanonicalJsonRenderer implements AgreementRenderer {
  static readonly VERSION = 'dev-canonical-json-1';

  render(particulars: Record<string, unknown>, languages: readonly string[]): RenderedArtefact {
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
