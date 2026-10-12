import { randomInt, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * THE 6-DIGIT CODE THE PROVIDER READS OUT ON THE CALL (TELEHEALTH-PLAN.md §3
 * step 5, §6 item 3).
 *
 * WHAT IT PROVES. Whoever opened the link can hear the call. The link went to
 * the contact on the record; the code went down the phone line. Together, and
 * with the provider's identity check, they replace the three typed identifiers
 * for the live call only (D-2026-10-11-07 decision 2).
 *
 * MADE BY A CSPRNG. `randomInt` draws from the operating system's secure
 * generator and is uniform over the range, so no digit is likelier than any
 * other. `Math.random` would be neither.
 *
 * STORED AS A SALTED SCRYPT, NEVER AS THE CODE. Six digits is a million
 * values. A plain sha256 of one is reversed from a database dump in under a
 * second, which would make "stored hashed" a comfort rather than a control.
 * scrypt with a per-session salt makes each guess cost real work, and the code
 * is dead within minutes anyway. No pepper, deliberately: a server-held key is
 * key management, which is a human-authored zone (CLAUDE.md §7c).
 *
 * ASYNC, so a burst of guesses does not stall the event loop for every other
 * request in the process (review, 12 Oct 2026).
 *
 * NEVER LOGGED. Nothing in this file writes anywhere, and the one caller
 * returns the code once, to the provider's screen.
 */

const SCRYPT_COST = 16384;
const KEY_LENGTH = 32;

function scryptAsync(secret: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(secret, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** A fresh code of `digits` digits, leading zeros kept. */
export function generateTelehealthCode(digits: number): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}

/** `scrypt$<cost>$<salt hex>$<hash hex>` — the shape the migration's CHECK insists on. */
export async function hashTelehealthCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(code, salt, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time. A malformed stored value never matches, rather than throwing. */
export async function telehealthCodeMatches(candidate: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 2) return false;
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  // Only digits are ever compared; anything else is a wrong code, cheaply.
  if (!/^[0-9]{4,10}$/.test(candidate)) return false;
  const actual = await scryptAsync(candidate, salt, { N: cost });
  return timingSafeEqual(actual, expected);
}
