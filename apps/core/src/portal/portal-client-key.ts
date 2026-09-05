import type { Request } from 'express';

/**
 * WHAT A RATE LIMITER ON A PUBLIC PORTAL ROUTE COUNTS AGAINST.
 *
 * `req.ip` WITH A FALLBACK, AND NO `X-Forwarded-For` PARSING OF OUR OWN. Express
 * derives `req.ip` from that header only when `trust proxy` is configured, which
 * is a deployment decision made once in `main.ts` rather than a header a
 * controller decides to believe. Reading the header directly would mean any
 * caller could set their own rate-limit key, which is the same as having no
 * limiter.
 *
 * IT IS NOT AN IDENTIFIER AND IS NEVER STORED. The address exists as a key in an
 * in-memory map for ten minutes and appears in no event, no log line and no row
 * (REQ-LOG-08).
 *
 * ONE DEFINITION, TWO DOORS. Passkey sign-in and the activation link are both
 * reachable without a session, and both are limited; a second copy of this
 * function would be a second chance to start trusting a header.
 */
export function clientKey(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
