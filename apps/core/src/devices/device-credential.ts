import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@aobplatform/domain';

/**
 * THE TWO SECRETS DEVICE PAIRING DEALS IN, minted and hashed in one place.
 *
 * ⚠ Neither is stored. `credentialHash` and `codeHash` are sha256 hex and the
 * database refuses anything else (see the migration's CHECK constraints), so a
 * read of the tables cannot produce a working credential — the same rule
 * `capture_token.ts` keeps for the remote capture link, for the same reason.
 *
 * THE CREDENTIAL CARRIES THE PRACTICE ID IN CLEAR, and that is deliberate
 * rather than sloppy. A practice UUID is ROUTING DATA, not a secret: it
 * appears in `x-practice-id` on every console request already. Putting it in
 * the credential lets `withPractice` be entered before anything is read, so
 * the credential lookup itself happens INSIDE the RLS fence rather than
 * outside it. The alternative — an unscoped lookup by hash across every
 * practice's devices — would mean one query in the system that deliberately
 * sees every tenant, which is precisely the query nobody should have to write.
 *
 *   <base64url(practiceId)>.<base64url(48 random bytes)>
 *
 * 48 bytes is 384 bits, comfortably over the 256-bit floor, and long enough
 * that the credential is obviously not something anybody would retype — which
 * is the point: it is never shown to a person. The PAIRING CODE is the part a
 * person handles, and it is eight characters and lives ten minutes.
 */

export interface MintedCredential {
  /** Shown ONCE, to the tablet that paired. Never logged, never re-displayed. */
  credential: string;
  /** What is stored. sha256 hex of the secret half only. */
  credentialHash: string;
}

export function mintDeviceCredential(practiceId: string): MintedCredential {
  const secret = randomBytes(48).toString('base64url');
  const credential = `${Buffer.from(practiceId, 'utf8').toString('base64url')}.${secret}`;
  return { credential, credentialHash: hashSecret(secret) };
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Splits a credential into the practice it routes to and the hash to look the
 * device up by. Returns null for anything that is not shaped like one — a
 * malformed header is a 401, never a 500.
 */
export function parseDeviceCredential(
  credential: string,
): { practiceId: string; credentialHash: string } | null {
  const dot = credential.indexOf('.');
  if (dot <= 0) return null;
  try {
    const practiceId = Buffer.from(credential.slice(0, dot), 'base64url').toString('utf8');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(practiceId)) return null;
    const secret = credential.slice(dot + 1);
    if (secret.length < 43) return null; // 32 random bytes, base64url, at minimum
    return { practiceId, credentialHash: hashSecret(secret) };
  } catch {
    return null;
  }
}

/**
 * A pairing code, from the alphabet the domain fixes.
 *
 * `randomInt` RATHER THAN `Math.random()` OR A MODULO OF A BYTE. The first is
 * not a cryptographic source; the second skews towards the first six
 * characters of a thirty-character alphabet, because 256 is not a multiple of
 * 30. `randomInt` rejects and re-draws, so every character is equally likely —
 * which is the whole strength of an eight-character code.
 */
export function mintPairingCode(): { code: string; codeHash: string } {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return { code, codeHash: hashSecret(code) };
}

/**
 * Constant-time comparison of two hex hashes.
 *
 * Used where a hash is compared in application code rather than by an indexed
 * lookup. Overkill against a database index, which leaks nothing useful, but
 * free — and the alternative is remembering which comparisons are safe.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
