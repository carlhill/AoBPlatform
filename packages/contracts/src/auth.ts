/**
 * THE MARKER THAT SAYS "THIS BROWSER HAS JUST BEEN GIVEN A SESSION ELSEWHERE".
 *
 * WHAT WENT WRONG WITHOUT IT (Carl, 12 Sep 2026). A practitioner opens the
 * "Set up your sign-in" email, registers a passkey, Keycloak says "your account
 * has been updated", they press "Back to Application" — and the console tells
 * them they are not signed in. They ARE, in the realm: the action-token flow
 * authenticated them and left an SSO session behind. What they do not have is a
 * token in this app, because that flow never went through the app's own
 * redirect.
 *
 * WHY THE CONSOLE COULD NOT WORK IT OUT. `AccessGuard` attempts a silent
 * restore only for a browser carrying `hasSignedInBefore()`, and a brand-new
 * practitioner's browser has never completed a sign-in here, so the hint is
 * absent. Without the hint no attempt is made, and the very first thing the
 * platform ever says to them is that they are not signed in.
 *
 * WHAT THIS IS. A query parameter on the URL the invitation returns to, naming
 * the Keycloak client the invitation was issued for. It is PERMISSION TO ASK,
 * nothing more: the app may make ONE `prompt=none` attempt it would otherwise
 * skip. It carries no token, proves nothing, and grants nothing — the worst a
 * forged one can do is spend a redirect discovering there is no session, which
 * is what an honest one does when the session has expired.
 *
 * IT LIVES HERE because two packages have to agree on the spelling and a
 * mismatch fails silently — the invitation would keep working and the restore
 * would simply never happen, which is the bug this fixes wearing a different
 * hat. `@aobplatform/auth-client` writes it; `apps/web` reads it.
 */
export const SILENT_RESTORE_PARAM = 'aob_restore';

/**
 * The Keycloak clients an invitation may name. A practice token and a platform
 * token are not interchangeable (see `apps/web/app/auth.ts`), so restoring
 * against the wrong one asks a question with no useful answer. Anything else in
 * the parameter is ignored rather than passed on.
 */
export const SILENT_RESTORE_CLIENTS = ['web', 'console'] as const;
export type SilentRestoreClient = (typeof SILENT_RESTORE_CLIENTS)[number];

export function isSilentRestoreClient(value: unknown): value is SilentRestoreClient {
  return typeof value === 'string' && (SILENT_RESTORE_CLIENTS as readonly string[]).includes(value);
}

/**
 * Add the marker to a URL an invitation will return to.
 *
 * PRESERVES WHAT IS ALREADY THERE — the destination is the caller's, and each
 * invitation flow picks its own. An existing marker is replaced rather than
 * doubled, so calling this twice is the same as calling it once.
 *
 * A URL THIS CANNOT PARSE IS RETURNED UNTOUCHED. An invitation that reaches
 * somebody is worth more than a marker that saves them one button press, and a
 * throw here would stop the email being sent at all (hard rule 8 in spirit:
 * the platform never blocks the work).
 */
export function withSilentRestore(redirectUri: string, clientId: string): string {
  if (!isSilentRestoreClient(clientId)) return redirectUri;
  try {
    const url = new URL(redirectUri);
    url.searchParams.set(SILENT_RESTORE_PARAM, clientId);
    return url.toString();
  } catch {
    return redirectUri;
  }
}
