import type { Request, Response } from 'express';
import { PORTAL_SESSION_COOKIE, PORTAL_SESSION_MINUTES } from '@aobplatform/contracts';

/**
 * The one thing the portal puts on a device: an opaque session id.
 *
 * WRITTEN BY HAND RATHER THAN WITH `cookie-parser`. Reading one named cookie
 * out of one header is six lines; a dependency in the request path of a
 * patient-facing surface is a supply-chain question forever. The same reasoning
 * `artefacts.controller.ts` gives for not adding a multipart parser.
 *
 * `httpOnly` SO SCRIPT CANNOT READ IT, `sameSite: lax` so a cross-site POST
 * cannot ride it, `secure` in anything but development so it never crosses a
 * plain connection. `path: '/'` because the artefact download and the reads sit
 * under different prefixes.
 *
 * NOTHING ELSE IS EVER STORED CLIENT-SIDE. The portal is not the kiosk, but the
 * zero-footprint reasoning applies with more force, not less: this runs on a
 * patient's own phone. No claims in the cookie, no patient ids, no name — an
 * id that means nothing without the row behind it, which the server can revoke.
 */
const SESSION_MAX_AGE_MS = PORTAL_SESSION_MINUTES * 60 * 1000;

/** The session id the caller presented, or null. Shape-checked before it reaches SQL. */
export function readPortalCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== PORTAL_SESSION_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    // A UUID or nothing. The value is interpolated into a `set_config` call
    // that casts to uuid, and a malformed cookie must be a 401 rather than a
    // database error with a query in it.
    return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  }
  return null;
}

export function setPortalCookie(res: Response, sessionId: string): void {
  res.cookie(PORTAL_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearPortalCookie(res: Response): void {
  res.clearCookie(PORTAL_SESSION_COOKIE, { path: '/' });
}
