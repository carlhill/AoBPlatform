/**
 * Wires the outbox's retention pieces together: the receipts ledger, always;
 * the key and the cipher, only when `retention.enabled` is true.
 *
 * THE ONE THING THIS FILE GUARANTEES: with retention disabled (the shipped
 * default — `config.ts`'s `DEFAULT_RETENTION_CONFIG`), nothing here touches
 * DPAPI or shells to PowerShell. That is what keeps every existing install
 * working unchanged, and it is what keeps this suite runnable on the Linux CI
 * runner that has neither.
 */
import type { RetentionConfig } from './config';
import { dpapiKeyWrapper, decryptPayload, encryptPayload, loadOrCreateKey, type EncryptedPayload, type KeyWrapper } from './keystore';
import type { Logger } from './log';
import { makeFileReceiptsWriter, type ReceiptsWriter } from './receipts';

/** What the outbox needs to encrypt and decrypt a payload, without knowing how the key is held. */
export interface Cipher {
  encrypt(plaintext: Buffer): EncryptedPayload;
  decrypt(payload: EncryptedPayload): Buffer;
}

export interface RetentionDeps {
  readonly config: RetentionConfig;
  readonly receipts: ReceiptsWriter;
  /** Present only when `config.enabled` — a job may not be written unencrypted while this is absent. */
  readonly cipher?: Cipher;
}

/**
 * Build what `Outbox` needs. Throws (refusing to start the program) if
 * retention is enabled and the key cannot be loaded or created — see
 * `keystore.ts`'s `loadOrCreateKey` for why that is the right failure mode.
 */
export function buildRetentionDeps(
  dataDir: string,
  config: RetentionConfig,
  logger: Logger,
  wrapper: KeyWrapper = dpapiKeyWrapper(),
): RetentionDeps {
  const receipts = makeFileReceiptsWriter(dataDir);
  if (!config.enabled) return { config, receipts };

  const key = loadOrCreateKey(dataDir, wrapper, logger);
  return {
    config,
    receipts,
    cipher: {
      encrypt: (plaintext) => encryptPayload(key, plaintext),
      decrypt: (payload) => decryptPayload(key, payload),
    },
  };
}
