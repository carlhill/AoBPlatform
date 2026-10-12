import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { RendererRegistry, renderInputOf } from './renderer-registry';

/**
 * THE ONE WAY A STORED AGREEMENT BECOMES BYTES SOMEBODY IS GIVEN — hard
 * rule 13.
 *
 * The bytes are never fetched from a store. They are RE-RENDERED,
 * deterministically, under the renderer version recorded ON the agreement, and
 * the hash is compared with the one recorded at lock. Two renders of one
 * agreement are byte-identical, so a mismatch is a tamper signal rather than a
 * transient error — and refusing is the honest answer, because the conflict is
 * between the record and the artefact and no retry fixes it.
 *
 * WHY THIS IS A FUNCTION AND NOT A METHOD ON TWO SERVICES. The patient's own
 * page and the "send me a copy" link both hand a patient the same document,
 * and the moment the check lives in two places one of them will be the one
 * that drifts. "One deterministic render path" is not only about the renderer;
 * it is about the verification in front of it.
 *
 * IT DOES NOT WRITE THE EVENT. Reading evidence is itself evidence
 * (REQ-LOG-07), but WHO read it and by what route differ — a signed-in patient
 * on their own page, a link out of a message — so the caller records the
 * `artefact.accessed` event with its own actor and action. This function
 * returns the hash it verified precisely so the caller binds the right one in.
 */
export interface VerifiableAgreement {
  readonly id: string;
  readonly particulars: unknown;
  readonly renderPayload?: unknown;
  readonly particularsLockedAt: Date | null;
  readonly renderedArtefactHash: string | null;
  readonly rendererVersion: string | null;
  readonly renderedLanguages: string[];
}

export interface VerifiedArtefact {
  readonly bytes: Buffer;
  readonly mediaType: string;
  readonly filename: string;
  readonly sha256: string;
  readonly rendererVersion: string;
}

export async function verifiedArtefactOf(
  renderers: RendererRegistry,
  agreement: VerifiableAgreement,
  logger: Logger,
): Promise<VerifiedArtefact> {
  if (!agreement.particularsLockedAt || !agreement.renderedArtefactHash) {
    throw new NotFoundException('This agreement has no signed copy yet.');
  }

  const renderer = renderers.get(agreement.rendererVersion);
  if (!renderer) {
    // 409 rather than 500: the record is intact and the platform simply cannot
    // honour rule 13 for it today. Saying so is better than serving bytes
    // whose hash nothing checked.
    throw new ConflictException(
      'This copy cannot be re-verified with the renderer it was made under, so it will not be served.',
    );
  }

  // `renderInputOf`, not `particulars`: since 5 September 2026 the lock stores
  // the WHOLE rendered document (letterhead + words + particulars) and that is
  // what has to be re-rendered to check the hash.
  const rendered = await renderer.render(renderInputOf(agreement), agreement.renderedLanguages);
  if (rendered.sha256 !== agreement.renderedArtefactHash) {
    logger.error(
      `Agreement ${agreement.id} re-rendered to ${rendered.sha256}, recorded ${agreement.renderedArtefactHash}. ` +
        'Refusing to serve it.',
    );
    throw new ConflictException(
      'This copy no longer matches the hash recorded when it was signed, so it will not be served. ' +
        'That is a tamper signal, not a transient error.',
    );
  }

  return {
    bytes: rendered.bytes,
    mediaType: rendered.mediaType,
    filename: `agreement-${agreement.id}${rendered.mediaType === 'application/pdf' ? '.pdf' : '.json'}`,
    sha256: rendered.sha256,
    rendererVersion: rendered.rendererVersion,
  };
}
