import { createHash, randomBytes } from 'node:crypto';

/**
 * COPY LINKS — the same construction as capture links and portal activation
 * invitations, and for the same reasons (REQ-VER-05: short-lived,
 * non-enumerable, only the hash stored).
 *
 * Format: base64url(practiceId) + '.' + base64url(32 random bytes).
 *
 * THE PRACTICE SEGMENT IS ROUTING, NOT A SECRET. It lets the public endpoint
 * establish its RLS scope before it knows anything else — a practice UUID
 * identifies a business, not a person. The 256-bit second segment is the
 * secret, and only `sha256(secret)` is ever written down, so a database read
 * cannot mint a working link.
 *
 * A THIRD MINT RATHER THAN A SHARED ONE, deliberately, exactly as
 * `portal-token.ts` argues. These three tokens look identical and are not
 * interchangeable: a capture token opens ONE agreement FOR SIGNING, an
 * activation token opens a conversation about linking a whole record to an
 * account, and this one opens ONE ALREADY-SIGNED document for reading. Sharing
 * the function is one refactor away from sharing the table, and then a
 * forwarded copy link would be a signing link.
 */
export interface MintedCopyToken {
  readonly token: string;
  readonly tokenHash: string;
}

export function mintAgreementCopyToken(practiceId: string): MintedCopyToken {
  const secret = randomBytes(32).toString('base64url');
  const token = `${Buffer.from(practiceId, 'utf8').toString('base64url')}.${secret}`;
  return { token, tokenHash: hashCopySecret(secret) };
}

export function hashCopySecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function parseAgreementCopyToken(token: string): { practiceId: string; tokenHash: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  try {
    const practiceId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    if (!/^[0-9a-f-]{36}$/.test(practiceId)) return null;
    const secret = token.slice(dot + 1);
    if (secret.length < 32) return null;
    return { practiceId, tokenHash: hashCopySecret(secret) };
  } catch {
    return null;
  }
}
