import { createHash, randomBytes } from 'node:crypto';

/**
 * ACTIVATION INVITATIONS — the same construction as capture links, and for the
 * same reasons (REQ-VER-05: short-lived, single-use, non-enumerable).
 *
 * Format: base64url(practiceId) + '.' + base64url(32 random bytes).
 *
 * THE PRACTICE SEGMENT IS ROUTING, NOT A SECRET. It lets the public activation
 * endpoint establish its RLS scope before it knows anything else — the same
 * trick `capture-token.ts` uses, and the same justification: a practice UUID
 * identifies a business, not a person.
 *
 * ONLY THE HASH IS STORED. A database read cannot mint a working invitation.
 *
 * A SEPARATE MINT FROM CAPTURE TOKENS, ON PURPOSE. They look identical and they
 * are not interchangeable: a capture token opens ONE agreement for signing and
 * is content-blind until verified; an activation token opens a conversation
 * about linking a whole record to a portal account. Sharing the function would
 * be one refactor away from sharing the table, and then a forwarded signing
 * link would be an account key. They stay apart.
 */
export interface MintedPortalToken {
  readonly token: string;
  readonly tokenHash: string;
}

export function mintPortalActivationToken(practiceId: string): MintedPortalToken {
  const secret = randomBytes(32).toString('base64url');
  const token = `${Buffer.from(practiceId, 'utf8').toString('base64url')}.${secret}`;
  return { token, tokenHash: hashPortalSecret(secret) };
}

export function hashPortalSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function parsePortalActivationToken(token: string): { practiceId: string; tokenHash: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  try {
    const practiceId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    if (!/^[0-9a-f-]{36}$/.test(practiceId)) return null;
    const secret = token.slice(dot + 1);
    if (secret.length < 32) return null;
    return { practiceId, tokenHash: hashPortalSecret(secret) };
  } catch {
    return null;
  }
}

/**
 * How long an invitation stays open.
 *
 * SEVEN DAYS, and longer than a capture link's 48 hours on purpose. A signing
 * link is time-critical — the practice is waiting on it. An activation
 * invitation is an OFFER (REQ-PORT-08: never a precondition of anything), and a
 * patient who opens it on the following weekend has done nothing wrong. It is
 * still short enough that a message sitting in an old inbox is not a standing
 * key, and it is still single-use and still useless without the three
 * identifiers.
 */
export const PORTAL_ACTIVATION_EXPIRY_HOURS = 24 * 7;
