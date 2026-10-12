import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LogoError, assertLogoAcceptable } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { ArtefactsService } from '../artefacts/artefacts.service';
import { formatAbn, letterheadHashOf, type AgreementLetterhead } from '../render/agreement-document';
import type { Actor } from '../auth/actor.decorator';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

/**
 * THE PRACTICE'S LETTERHEAD — what appears at the top of every agreement it
 * makes (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1, Q3/Q4).
 *
 * ALMOST NOTHING HERE IS NEW DATA. The legal name, the trading names, the
 * address, the phone, the email and the ABN are all already on the practice
 * record — most of them verified against the ABR — and this READS them. A
 * second copy kept "for the letterhead" would be a second copy to go stale,
 * and the one that went stale would be the one printed on contracts.
 *
 * THE LOGO IS THE ONE ADDITION, and it is a pointer rather than bytes: the
 * image is an artefact, addressed by content hash, and the render embeds it
 * verbatim. See `packages/domain/src/practice-logo.ts` for why it is the
 * fussiest image on the platform.
 *
 * THE BUSINESS ADDRESS, NOT A PLACE OF PRACTICE. The head-office fields are
 * the entity's own address. D4's "address of the place of practice at the time
 * of the service" (REQ-REG-02(a)) is a different fact, lives on the provider,
 * and is assembled by the lock — conflating them would put a registered office
 * on a contract as the place a service was rendered.
 */
@Injectable()
export class LetterheadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artefacts: ArtefactsService,
  ) {}

  /**
   * The letterhead as the renderer wants it, plus its hash. Undefined fields
   * are omitted rather than sent empty: the hash is over what is actually
   * printed, and a practice that fills in its phone number later must produce
   * a different letterhead rather than the same one with a blank line.
   */
  async forPractice(practiceId: string): Promise<{
    readonly letterhead: AgreementLetterhead;
    readonly letterheadHash: string;
  }> {
    const practice = await this.prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({}));
    if (!practice) throw new NotFoundException('Practice not found.');

    const letterhead: AgreementLetterhead = prune({
      legalName: practice.legalName?.trim() || practice.name,
      tradingName: practice.tradingNames[0]?.trim() || undefined,
      address: composeAddress(practice),
      phone: practice.businessPhone?.trim() || undefined,
      email: practice.businessEmail?.trim() || undefined,
      abn: formatAbn(practice.abn),
      logoSha256: practice.logoSha256 ?? undefined,
      logoContentType: practice.logoContentType ?? undefined,
    });

    return { letterhead, letterheadHash: letterheadHashOf(letterhead) };
  }

  /** What the settings page shows: the fields, where each comes from, and the logo. */
  async settings(practiceId: string) {
    const { letterhead, letterheadHash } = await this.forPractice(practiceId);
    const practice = await this.prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({}));
    return {
      letterhead,
      letterheadHash,
      logo: practice?.logoSha256
        ? {
            sha256: practice.logoSha256,
            contentType: practice.logoContentType,
            widthPx: practice.logoWidthPx,
            heightPx: practice.logoHeightPx,
            updatedAt: practice.logoUpdatedAt,
            updatedBy: practice.logoUpdatedBy,
            artefactId: practice.logoArtefactId,
          }
        : null,
    };
  }

  /**
   * Upload or replace the logo.
   *
   * THE OLD ARTEFACT IS NOT TOUCHED. Every agreement made under the previous
   * letterhead embeds those exact bytes and re-verifies against them, so
   * replacing the logo re-points the practice and leaves the evidence where it
   * is (hard rules 11 and 13). This is why "remove" below is a pointer clear
   * rather than a tombstone.
   */
  async setLogo(practiceId: string, bytes: Uint8Array, filename: string | undefined, actor?: Actor) {
    let accepted;
    try {
      accepted = assertLogoAcceptable(bytes);
    } catch (err) {
      if (err instanceof LogoError) throw new BadRequestException(err.message);
      throw err;
    }

    // Bytes to the store first, the rows in one transaction after — the same
    // ordering every artefact upload uses: content with no row is orphaned and
    // identifiable by its hash; a row pointing at content that was never
    // written is a broken reference.
    const staged = await this.artefacts.stage(practiceId, {
      bytes,
      purpose: 'practice_logo',
      filename: filename ?? `logo.${accepted.contentType === 'image/png' ? 'png' : 'jpg'}`,
      declaredContentType: accepted.contentType,
      uploadedByName: actor?.name ?? 'practice administrator',
      subjectType: 'Practice',
      subjectId: practiceId,
    });

    return this.prisma.withPractice(practiceId, async (tx) => {
      const artefact = await this.artefacts.recordStaged(tx, practiceId, staged);
      const updated = await tx.practice.update({
        where: { id: practiceId },
        data: {
          logoArtefactId: artefact.id,
          logoSha256: artefact.sha256,
          logoContentType: accepted.contentType,
          logoWidthPx: accepted.widthPx,
          logoHeightPx: accepted.heightPx,
          logoUpdatedAt: new Date(),
          logoUpdatedBy: actor?.name ?? null,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'practice.letterhead_logo_set',
        actor: actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR,
        subject: { type: 'Practice', id: practiceId },
        payload: {
          sha256: artefact.sha256,
          contentType: accepted.contentType,
          widthPx: accepted.widthPx,
          heightPx: accepted.heightPx,
          sizeBytes: accepted.sizeBytes,
        },
      });
      return {
        sha256: updated.logoSha256,
        contentType: updated.logoContentType,
        widthPx: updated.logoWidthPx,
        heightPx: updated.logoHeightPx,
      };
    });
  }

  /**
   * Stop printing the logo. THE ARTEFACT SURVIVES — see `setLogo`. Removing
   * the bytes would make every agreement that embeds them unverifiable, which
   * is not a thing a settings page gets to do.
   */
  async clearLogo(practiceId: string, actor?: Actor) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.findFirst({});
      if (!practice) throw new NotFoundException('Practice not found.');
      if (!practice.logoSha256) return { cleared: false };
      await tx.practice.update({
        where: { id: practiceId },
        data: {
          logoArtefactId: null,
          logoSha256: null,
          logoContentType: null,
          logoWidthPx: null,
          logoHeightPx: null,
          logoUpdatedAt: new Date(),
          logoUpdatedBy: actor?.name ?? null,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'practice.letterhead_logo_cleared',
        actor: actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR,
        subject: { type: 'Practice', id: practiceId },
        // The hash of what stopped being printed — the artefact itself stays.
        payload: { previousSha256: practice.logoSha256 },
      });
      return { cleared: true };
    });
  }
}

/**
 * The entity's own address, from the structured fields, falling back to what
 * was typed. Undefined rather than a partial line: half an address on a
 * contract is worse than none, because it looks checked.
 */
function composeAddress(practice: {
  headOfficeLine1: string | null;
  headOfficeLine2: string | null;
  headOfficeSuburb: string | null;
  headOfficeState: string | null;
  headOfficePostcode: string | null;
  headOfficeAddress: string | null;
}): string | undefined {
  const structured = [
    practice.headOfficeLine1,
    practice.headOfficeLine2,
    [practice.headOfficeSuburb, practice.headOfficeState, practice.headOfficePostcode]
      .filter((p) => p && p.trim())
      .join(' '),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');
  if (structured.trim()) return structured;
  return practice.headOfficeAddress?.trim() || undefined;
}

function prune<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null)) as T;
}
