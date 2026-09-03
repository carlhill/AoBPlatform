import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ArtefactError,
  CHECK_CATALOGUE,
  assertUploadAcceptable,
  downloadHeaders,
  duplicateWarning,
  identifierWarning,
  type EvidenceWarning,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { VaultEventInput } from '@aobplatform/contracts';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { extractText } from './extract-text';
import { ARTEFACT_STORE, sha256Hex, type ArtefactStore } from './artefact-store';

export interface UploadInput {
  bytes: Uint8Array;
  declaredContentType?: string;
  filename?: string;
  purpose: string;
  uploadedByName: string;
  subjectType?: string;
  subjectId?: string;
}

/** Bytes already written and hashed; the metadata row has not been made yet. */
export interface StagedArtefact {
  readonly sha256: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
  readonly detectedContentType: string;
  readonly declaredContentType: string | null;
  readonly declaredTypeMismatch: boolean;
  readonly filename: string;
  readonly purpose: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly uploadedByName: string;
}

/**
 * Evidence artefacts.
 *
 * The division of labour: the DOMAIN decides whether bytes are acceptable and
 * what they are, the STORE holds them, and this service ties the two to a
 * practice and to the evidence chain. Nothing here re-implements a rule — a
 * second copy of "is this a PNG" is a second copy that can drift.
 */
@Injectable()
export class ArtefactsService {
  private readonly logger = new Logger(ArtefactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARTEFACT_STORE) private readonly store: ArtefactStore,
  ) {}

  /**
   * PHASE ONE — validate the bytes, hash them, and write them to the store.
   *
   * Split out of `upload()` so that a caller which is ALREADY inside a
   * transaction can put the metadata row in that same transaction (see
   * `recordStaged`). The signature capture needs exactly that: the artefact
   * rows, the signature event and every vault event for them commit together
   * or not at all (rule 11) — a signature bound to an artefact row that rolled
   * back would be evidence pointing at nothing.
   *
   * Bytes first, as before. A metadata row pointing at content that was never
   * written is a broken reference; content with no row is merely orphaned, and
   * the hash makes it identifiable.
   */
  async stage(practiceId: string, input: UploadInput): Promise<StagedArtefact> {
    let accepted;
    try {
      accepted = assertUploadAcceptable(input);
    } catch (err) {
      if (err instanceof ArtefactError) throw new BadRequestException(err.message);
      throw err;
    }

    const sha256 = sha256Hex(input.bytes);

    if (accepted.declaredTypeMismatch) {
      // Not a refusal — browsers get this wrong innocently — but a deliberate
      // mismatch is a probe, and probes are worth a line in the log.
      this.logger.warn(
        `Artefact for practice ${practiceId} declared "${input.declaredContentType}" but is ` +
          `"${accepted.detectedContentType}". Stored as what it actually is.`,
      );
    }

    const storageKey = await this.store.put(practiceId, sha256, input.bytes);

    return {
      sha256,
      storageKey,
      sizeBytes: accepted.sizeBytes,
      detectedContentType: accepted.detectedContentType,
      declaredContentType: input.declaredContentType ?? null,
      declaredTypeMismatch: accepted.declaredTypeMismatch,
      filename: accepted.filename,
      purpose: accepted.purpose,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      uploadedByName: input.uploadedByName.trim(),
    };
  }

  /**
   * PHASE TWO — the metadata row and its vault event, in the CALLER'S
   * transaction. The two are written together here for the same reason they
   * always were: an artefact with no event is evidence outside the chain.
   */
  async recordStaged(tx: Prisma.TransactionClient, practiceId: string, staged: StagedArtefact) {
    const artefact = await tx.artefact.create({
      data: {
        practiceId,
        sha256: staged.sha256,
        sizeBytes: staged.sizeBytes,
        declaredContentType: staged.declaredContentType,
        detectedContentType: staged.detectedContentType,
        declaredTypeMismatch: staged.declaredTypeMismatch,
        filename: staged.filename,
        purpose: staged.purpose,
        subjectType: staged.subjectType,
        subjectId: staged.subjectId,
        uploadedByName: staged.uploadedByName,
        storageKey: staged.storageKey,
      },
    });

    // The HASH goes to the vault, never the bytes (REQ-LOG-08). Same
    // division as `renderedArtefactHash` on an agreement.
    await enqueueVaultEvent(tx, {
      type: 'artefact.accessed',
      actor: { principalType: 'staff', id: practiceId },
      subject: { type: 'Artefact', id: artefact.id },
      payload: {
        action: 'uploaded',
        sha256: staged.sha256,
        sizeBytes: staged.sizeBytes,
        contentType: staged.detectedContentType,
        purpose: staged.purpose,
        uploadedBy: staged.uploadedByName,
        declaredTypeMismatch: staged.declaredTypeMismatch,
      },
    });

    return {
      id: artefact.id,
      sha256: artefact.sha256,
      sizeBytes: artefact.sizeBytes,
      contentType: artefact.detectedContentType,
      filename: artefact.filename,
      purpose: artefact.purpose,
      declaredTypeMismatch: artefact.declaredTypeMismatch,
      uploadedAt: artefact.uploadedAt,
    };
  }

  async upload(practiceId: string, input: UploadInput) {
    const staged = await this.stage(practiceId, input);
    return this.prisma.withPractice(practiceId, (tx) => this.recordStaged(tx, practiceId, staged));
  }

  async list(practiceId: string, filter: { subjectType?: string; subjectId?: string } = {}) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.artefact.findMany({
        where: {
          subjectType: filter.subjectType,
          subjectId: filter.subjectId,
        },
        orderBy: { uploadedAt: 'desc' },
      });
      return rows.map((a) => ({
        id: a.id,
        sha256: a.sha256,
        sizeBytes: a.sizeBytes,
        contentType: a.detectedContentType,
        filename: a.filename,
        purpose: a.purpose,
        uploadedByName: a.uploadedByName,
        uploadedAt: a.uploadedAt,
        declaredTypeMismatch: a.declaredTypeMismatch,
        /** Tombstoned: the row and hash survive, the content does not. */
        deleted: Boolean(a.deletedAt),
      }));
    });
  }

  /**
   * Fetch for download. REQ-LOG-07 — reads are logged, not only writes: who
   * looked at a piece of evidence is itself evidence.
   */
  async download(practiceId: string, artefactId: string, readByName: string) {
    const artefact = await this.prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findFirst({ where: { id: artefactId } }),
    );
    if (!artefact) throw new NotFoundException('Artefact not found in this practice.');
    if (artefact.deletedAt) {
      throw new NotFoundException(
        `This artefact was removed on ${artefact.deletedAt.toISOString().slice(0, 10)}` +
          `${artefact.deletedReason ? ` (${artefact.deletedReason})` : ''}. Its hash and provenance remain on ` +
          'record; the content does not.',
      );
    }

    const bytes = await this.store.get(artefact.storageKey);

    // The stored hash is the identity of the content. If what came back does
    // not match, something has altered the object out from under us, and
    // serving it would launder that alteration.
    const actual = sha256Hex(bytes);
    if (actual !== artefact.sha256) {
      this.logger.error(
        `Artefact ${artefactId} does not match its recorded hash. Expected ${artefact.sha256}, got ${actual}. ` +
          'Refusing to serve it.',
      );
      throw new BadRequestException(
        'This artefact no longer matches the hash recorded when it was uploaded, so it will not be served. ' +
          'That is a tamper signal, not a transient error.',
      );
    }

    await this.prisma.withPractice(practiceId, (tx) =>
      enqueueVaultEvent(tx, {
        type: 'artefact.accessed',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'Artefact', id: artefactId },
        payload: { action: 'downloaded', sha256: artefact.sha256, readBy: readByName || 'unattributed' },
      }),
    );

    return {
      bytes,
      headers: downloadHeaders({
        detectedContentType: artefact.detectedContentType,
        filename: artefact.filename,
      }),
    };
  }

  /** Removes the content; the row, hash and provenance survive by design. */
  async tombstone(
    practiceId: string,
    artefactId: string,
    reason: string,
    actor: VaultEventInput['actor'] = { principalType: 'staff', id: practiceId },
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('Removing artefact content must record why.');
    }
    const artefact = await this.prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findFirst({ where: { id: artefactId } }),
    );
    if (!artefact) throw new NotFoundException('Artefact not found in this practice.');
    if (artefact.legalHold) {
      throw new BadRequestException('This artefact is under legal hold and its content cannot be removed.');
    }
    if (artefact.deletedAt) return { id: artefactId, alreadyRemoved: true };

    await this.store.remove(artefact.storageKey);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const updated = await tx.artefact.update({
        where: { id: artefactId },
        data: { deletedAt: new Date(), deletedReason: reason.trim() },
      });
      await enqueueVaultEvent(tx, {
        type: 'retention.crypto_shredded',
        actor,
        subject: { type: 'Artefact', id: artefactId },
        payload: { action: 'content_removed', sha256: artefact.sha256, reason: reason.trim() },
      });
      return { id: updated.id, removedAt: updated.deletedAt, reason: updated.deletedReason };
    });
  }

  /**
   * Does this file actually evidence what it is about to be cited for?
   *
   * Two questions, both answered as WARNINGS and never as a refusal:
   *
   *   1. Are these bytes already cited for a different check? Compared on the
   *      SHA-256 that already exists so a file read in a dispute can be shown to
   *      be the file uploaded now — duplicate detection is a free second use of
   *      it.
   *   2. Does the file contain the identifier it is supposed to prove? Only
   *      answerable for text-bearing files; an image says so rather than
   *      passing silently.
   *
   * WHY NOT REFUSE. A hash block is beaten by re-exporting the file, which
   * changes the bytes and nothing else — it would stop the honest mistake and
   * wave through anyone actually trying, which is the worst combination. And a
   * content match cannot prove authenticity: a fabricated screenshot contains
   * the right number just as reliably. Refusing on either would make the
   * platform easier to fool, because a reviewer would read a green tick as
   * verification.
   */
  async inspect(
    practiceId: string,
    artefactId: string,
    context: { checkKey?: string; identifier?: string; identifierLabel?: string },
  ): Promise<{ warnings: EvidenceWarning[]; extractedChars: number | null }> {
    const artefact = await this.prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findFirst({ where: { id: artefactId } }),
    );
    if (!artefact) throw new NotFoundException('Artefact not found in this practice.');

    const warnings: EvidenceWarning[] = [];

    // 1. The same bytes, cited elsewhere.
    const siblings = await this.prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findMany({
        where: { sha256: artefact.sha256, id: { not: artefactId }, deletedAt: null },
      }),
    );
    const citedFor = [
      ...new Set(
        siblings
          .filter((a) => a.subjectType === 'PracticeCheck' && a.subjectId)
          .map((a) => a.subjectId as string),
      ),
    ];
    if (citedFor.length > 0) {
      const checks = await this.prisma.withPractice(practiceId, (tx) =>
        tx.practiceCheck.findMany({ where: { id: { in: citedFor } } }),
      );
      const labels = [...new Set(checks.map((c) => CHECK_CATALOGUE.find((definition) => definition.key === c.checkKey)?.label ?? c.checkKey))];
      const warning = duplicateWarning({
        sha256: artefact.sha256,
        filename: artefact.filename,
        alreadyCitedFor: labels,
      });
      if (warning) warnings.push(warning);
    }

    // 2. Does it contain what it is meant to prove?
    let extractedChars: number | null = null;
    if (context.identifier) {
      const bytes = await this.store.get(artefact.storageKey);
      const text = extractText(bytes, artefact.detectedContentType);
      extractedChars = text === null ? null : text.length;

      const warning = identifierWarning({
        extracted: text,
        identifier: context.identifier,
        identifierLabel: context.identifierLabel ?? 'identifier',
        filename: artefact.filename,
      });
      if (warning) warnings.push(warning);
    }

    return { warnings, extractedChars };
  }

}
