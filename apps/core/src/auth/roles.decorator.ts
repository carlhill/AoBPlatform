import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES = 'aob:required-roles';

/**
 * Requires one of these realm roles on the bearer token.
 *
 * WHAT THIS IS FOR, precisely: endpoints where being signed in is not the
 * question. The reviewer surface is the clearest case — approving a practice is
 * what opens consent capture, and a practice administrator holding a perfectly
 * valid token has no business doing it.
 *
 * IT IS STAGED, exactly like AuthGuard, and for the same reason. While
 * AUTH_ENFORCE is false a request with no token still passes, because the
 * passkey ceremony is unproven on real hardware and enforcing early would lock
 * the console out of the very screens used to enrol the first passkey. But a
 * request that DOES carry a token is checked against these roles either way:
 * presenting a practice-admin token to a reviewer endpoint is a refusal now,
 * not at some future release.
 *
 * That asymmetry is deliberate. "No token" is an unfinished deployment; "the
 * wrong token" is an answer, and answering it late would mean shipping a
 * window in which a valid practice token could approve practices.
 *
 * The console gate in the browser stops a person BROWSING to these screens.
 * This stops a REQUEST. Neither substitutes for the other, and the browser one
 * is the weaker of the two — it is markup.
 */
export const RequireRoles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);

/** AoBPlatform staff who read applications and approve practices. */
export const PLATFORM_ADMIN = 'platform_admin';
