/**
 * Wires the outbox's retention pieces together: the key, the cipher and the
 * receipts writer.
 *
 * THE KEY ALWAYS EXISTS (D-2026-09-29-02, 29 Sep 2026). Until then this file
 * guaranteed the opposite — with retention off, nothing here touched DPAPI or
 * PowerShell. Carl reversed it: audit locations and archived PDFs are
 * encrypted from day one, so the key cannot wait for `retention.enabled`.
 * What that flag still decides is the outbox PAYLOAD: plaintext and kept
 * (off), or encrypted and destroyed on acknowledgement (on).
 *
 * KEY MANAGEMENT IS A HUMAN-AUTHORED ZONE (`CLAUDE.md` §7c). `keystore.ts` is
 * unchanged; only when it is called moved. Flagged for Carl's review before
 * any practice runs it. Tests inject a stand-in wrapper, which is what keeps
 * the suite runnable on the Linux CI runner that has no DPAPI.
 */
import type { RetentionConfig } from './config';
import { dpapiKeyWrapper, decryptPayload, encryptPayload, loadOrCreateKey, type EncryptedPayload, type KeyWrapper } from './keystore';
import type { Logger } from './log';
import type { ReceiptsWriter } from './receipts';

/** What the outbox and the store need to encrypt and decrypt, without knowing how the key is held. */
export interface Cipher {
  encrypt(plaintext: Buffer): EncryptedPayload;
  decrypt(payload: EncryptedPayload): Buffer;
}

export interface RetentionDeps {
  readonly config: RetentionConfig;
  readonly receipts: ReceiptsWriter;
  /**
   * Always present from `buildRetentionDeps`. Optional in the type only so a
   * test can prove the guard: a job is never written unencrypted while
   * retention is on and this is absent.
   */
  readonly cipher?: Cipher;
}

/**
 * Load the key, creating it on first run, and wrap it as a cipher. Throws —
 * refusing to start the program — if a key on disk cannot be unwrapped; see
 * `keystore.ts`'s `loadOrCreateKey` for why that is the right failure mode.
 */
export function loadCipher(dataDir: string, logger: Logger, wrapper: KeyWrapper = dpapiKeyWrapper()): Cipher {
  const key = loadOrCreateKey(dataDir, wrapper, logger);
  return {
    encrypt: (plaintext) => encryptPayload(key, plaintext),
    decrypt: (payload) => decryptPayload(key, payload),
  };
}

/** What `Outbox` needs. The receipts writer is the database (`store.ts`) since 29 Sep 2026. */
export function buildRetentionDeps(config: RetentionConfig, receipts: ReceiptsWriter, cipher: Cipher): RetentionDeps {
  return { config, receipts, cipher };
}
