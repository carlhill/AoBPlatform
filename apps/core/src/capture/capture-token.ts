import { createHash, randomBytes } from 'node:crypto';

/**
 * Remote-link tokens (REQ-VER-05: practice-branded, short-lived, single-use,
 * non-enumerable).
 *
 * Format: base64url(practiceId) + '.' + base64url(32 random bytes)
 * The practice segment lets the public landing endpoint establish its RLS
 * scope (a practice UUID is routing data, not a secret); the second segment
 * is the 256-bit secret. Only sha256(secret) is stored — a database read
 * cannot mint working links.
 */
export interface MintedToken {
  token: string;
  tokenHash: string;
}

export function mintCaptureToken(practiceId: string): MintedToken {
  const secret = randomBytes(32).toString('base64url');
  const token = `${Buffer.from(practiceId, 'utf8').toString('base64url')}.${secret}`;
  return { token, tokenHash: hashSecret(secret) };
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function parseCaptureToken(token: string): { practiceId: string; tokenHash: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  try {
    const practiceId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    if (!/^[0-9a-f-]{36}$/.test(practiceId)) return null;
    const secret = token.slice(dot + 1);
    if (secret.length < 32) return null;
    return { practiceId, tokenHash: hashSecret(secret) };
  } catch {
    return null;
  }
}

/** Default link expiry until decision D-05 closes (options were 24h/48h/7d). */
export const DEFAULT_LINK_EXPIRY_HOURS = 48;
