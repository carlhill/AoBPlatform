import { Injectable } from '@nestjs/common';
import { ArtefactsService } from '../artefacts/artefacts.service';

/**
 * THE ONE WAY THE RENDERER GETS THE PRACTICE'S LOGO BYTES.
 *
 * WHY THE BYTES ARE NOT IN THE RENDER PAYLOAD. A logo may be half a megabyte,
 * and the payload is stored on every agreement row: at a few thousand
 * agreements that is the same file written a few thousand times into the
 * transactional store. The payload carries the sha256 instead, and this
 * resolves it — the artefact store is content-addressed and re-hashes on the
 * way out, so "the same sha256" is a guarantee about the bytes rather than a
 * hope (which is what rule 13 needs from it).
 *
 * WHY IT IS AN INTERFACE ON THE REGISTRY RATHER THAN AN ARGUMENT TO `render`.
 * Three call sites re-render an agreement to verify its hash — signing,
 * write-back and the patient's own copy — and each of them cares only that the
 * bytes come back identical. Threading a resolver through all three would put
 * the same four lines in three places and make a future fourth caller a
 * decision. The renderer asks; the callers do not have to know it needs to.
 *
 * A MISSING LOGO IS A REFUSED RENDER, not a render without a logo. If the
 * letterhead says there is one and it cannot be produced, the bytes would
 * differ from the bytes that were hashed at lock — which is exactly the
 * tamper signal rule 13 exists to raise. Returning null lets the renderer say
 * so in its own words.
 *
 * AND IT IS NOW THE PORT FOR THE SIGNATURE MARK TOO (27 September 2026). The
 * Signed-DB4 renderer composites the patient's signature PNG onto the page and
 * needs exactly this contract — artefact bytes by content hash, scoped to the
 * practice, re-hashed on the way out, no read event. The name is narrower than
 * the job it now does; renaming it would touch the registry, both renderers,
 * the module and the inventory for no change in behaviour, so the second use
 * is recorded here rather than left to be discovered.
 */
export interface LogoLoader {
  load(practiceId: string, sha256: string): Promise<Buffer | null>;
}

export const LOGO_LOADER = Symbol('LOGO_LOADER');

@Injectable()
export class ArtefactLogoLoader implements LogoLoader {
  constructor(private readonly artefacts: ArtefactsService) {}

  /**
   * NO `artefact.accessed` EVENT, deliberately (REQ-LOG-07 logs READS).
   *
   * A render is not a person reading evidence. Every agreement display already
   * writes its own event, and one extra "somebody read the logo" per render
   * would be several per agreement, all of them about a file that is on the
   * practice's own letterhead. Logging it would bury the reads that matter.
   */
  load(practiceId: string, sha256: string): Promise<Buffer | null> {
    return this.artefacts.contentByHash(practiceId, sha256);
  }
}
