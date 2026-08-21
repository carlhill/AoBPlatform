import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Where artefact bytes live.
 *
 * An interface with a local implementation, on the same pattern as the ABR
 * client and the address validator: the production shape is object storage
 * (S3/Azure Blob, Australian region, encrypted at rest, versioning off so a
 * tombstone really removes content), and this keeps the seam so that lands as
 * one class rather than a refactor.
 *
 * WHY NOT POSTGRES. Blobs in a relational database bloat backups, slow
 * restores, and put attacker-supplied bytes inside the transactional store.
 * The metadata row belongs there; the content does not.
 */
export interface ArtefactStore {
  readonly kind: string;
  /** Returns the storage key. The caller already has the hash. */
  put(practiceId: string, sha256: string, bytes: Uint8Array): Promise<string>;
  get(storageKey: string): Promise<Uint8Array>;
  /** Removes the bytes. The metadata row survives as a tombstone. */
  remove(storageKey: string): Promise<void>;
}

export const ARTEFACT_STORE = Symbol('ARTEFACT_STORE');

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Filesystem-backed store for local development.
 *
 * THE KEY IS DERIVED, NEVER SUPPLIED. It is built from the practice id and the
 * content hash — both of which we generate — so a filename can never influence
 * where bytes land. Every resolved path is then checked to be inside the root,
 * which catches any future change that reintroduces caller-controlled input.
 *
 * NOTE THE PRACTICE ID IN THE PATH: content is segregated per tenant, so
 * identical bytes uploaded by two practices are two objects. That is
 * deliberate — a shared object would let one practice detect, by observing
 * deduplication, that another had uploaded the same file.
 */
export class FilesystemArtefactStore implements ArtefactStore {
  readonly kind = 'filesystem';
  private readonly logger = new Logger(FilesystemArtefactStore.name);
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(storageKey: string): string {
    const full = resolve(join(this.root, storageKey));
    // Defence in depth: even though the key is derived, verify it stayed put.
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Refusing an artefact path outside the store root.');
    }
    return full;
  }

  async put(practiceId: string, sha256: string, bytes: Uint8Array): Promise<string> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Refusing to store under a malformed hash.');
    if (!/^[0-9a-f-]{36}$/i.test(practiceId)) throw new Error('Refusing to store under a malformed practice id.');
    // Two levels of fan-out so a directory never holds a million entries.
    const storageKey = `${practiceId}/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
    const path = this.pathFor(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'w' });
    return storageKey;
  }

  async get(storageKey: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(storageKey)));
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
    this.logger.log('Artefact content removed; the metadata row and its hash remain.');
  }
}
