import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ArtefactError, assertUploadAcceptable, downloadHeaders } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { ARTEFACT_STORE, sha256Hex, type ArtefactStore } from './artefact-store';

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

  async upload(
    practiceId: string,
    input: {
      bytes: Uint8Array;
      declaredContentType?: string;
      filename?: string;
      purpose: string;
      uploadedByName: string;
      subjectType?: string;
      subjectId?: string;
    },
  ) {
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

    // Bytes first. A metadata row pointing at content that was never written
    // is a broken reference; content with no row is merely orphaned, and the
    // hash makes it identifiable.
    const storageKey = await this.store.put(practiceId, sha256, input.bytes);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const artefact = await tx.artefact.create({
        data: {
          practiceId,
          sha256,
          sizeBytes: accepted.sizeBytes,
          declaredContentType: input.declaredContentType ?? null,
          detectedContentType: accepted.detectedContentType,
          declaredTypeMismatch: accepted.declaredTypeMismatch,
          filename: accepted.filename,
          purpose: accepted.purpose,
          subjectType: input.subjectType ?? null,
          subjectId: input.subjectId ?? null,
          uploadedByName: input.uploadedByName.trim(),
          storageKey,
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
          sha256,
          sizeBytes: accepted.sizeBytes,
          contentType: accepted.detectedContentType,
          purpose: accepted.purpose,
          uploadedBy: input.uploadedByName.trim(),
          declaredTypeMismatch: accepted.declaredTypeMismatch,
        },
      });

      return {
        id: artefact.id,
        sha256,
        sizeBytes: artefact.sizeBytes,
        contentType: artefact.detectedContentType,
        filename: artefact.filename,
        purpose: artefact.purpose,
        declaredTypeMismatch: artefact.declaredTypeMismatch,
        uploadedAt: artefact.uploadedAt,
      };
    });
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
  async tombstone(practiceId: string, artefactId: string, reason: string) {
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
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'Artefact', id: artefactId },
        payload: { action: 'content_removed', sha256: artefact.sha256, reason: reason.trim() },
      });
      return { id: updated.id, removedAt: updated.deletedAt, reason: updated.deletedReason };
    });
  }
}
