/**
 * ONE PLACE THAT TURNS A FAILED RESPONSE INTO WORDS SOMEBODY CAN ACT ON.
 *
 * WHY THIS HAD TO EXIST (Carl, 7 Sep 2026). A console tab left open kept
 * saying "signed in" long after the session had actually expired —
 * `currentSession()` self-expires, but nothing was re-reading it. `apiHeaders`
 * then sent no `Authorization` header, core answered with a perfectly good
 * reason ("Resolving a review records who decided, so it needs a signed-in
 * user."), and eight call sites across the practice pages threw away that
 * reason and showed the raw status instead: "That could not be marked as
 * done — 400". CLAUDE.md §7 ("Shortcuts to the answer") calls a message like
 * that a defect on its own — the server's actual reason has to reach the
 * screen, and the one reason a person can act on without knowing anything
 * about the feature ("your session ended — sign in again") gets named
 * specifically rather than left as a number.
 *
 * NEVER A BARE NUMBER. When nothing better is available this still shows the
 * HTTP status, just in words rather than as the entire message, so the code
 * stays visible for diagnosis without being the only thing on screen.
 */
import { strings } from './strings';

/**
 * Read the server's own reason out of a failed response.
 *
 * Recognises exactly one case by itself — the expired session — because it is
 * the one failure fixable without knowing anything about the screen it
 * happened on: sign in again, press the same button. A 401 always means that.
 * A 400 means it only when the body says so; core's `BadRequestException`s use
 * plain English for a dozen unrelated refusals, and this must not claim every
 * one of them is a stale session.
 */
export async function explainFailure(res: Response): Promise<string> {
  let bodyMessage: string | undefined;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) bodyMessage = body.message.join(' ');
    else if (typeof body.message === 'string') bodyMessage = body.message;
  } catch {
    // No JSON body (or none at all) — fall through to statusText / the code.
  }

  if (isExpiredSessionFailure(res.status, bodyMessage)) return strings.status.sessionExpired;

  return bodyMessage || res.statusText || strings.status.httpRefused(res.status);
}

/**
 * The same recognition `explainFailure` applies, exposed separately so a
 * caller that already has a message string (rather than the `Response`) can
 * decide whether to offer a retry after sign-in without re-deriving it.
 */
export function isExpiredSessionFailure(status: number, bodyMessage?: string): boolean {
  return status === 401 || (status === 400 && Boolean(bodyMessage?.includes('signed-in user')));
}

/** True for the message `explainFailure` produces for an expired session. */
export function isExpiredSessionMessage(message: string): boolean {
  return message === strings.status.sessionExpired;
}
