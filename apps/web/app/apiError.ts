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
  /*
   * 403 JOINS 400 HERE (Carl, 28 September 2026, at a live desk: *"could not
   * send to tablet"*, twice, on two readable records).
   *
   * WHAT IT COST TO LEAVE OUT. `pushRefusals.noActor()` is a
   * `ForbiddenException` — 403 — and it is the ONE refusal in the push path
   * that carries no `reason` code, because it is not a push refusal at all;
   * it is the request arriving with nobody attached. So a console whose
   * session had quietly expired met "Could not send. Please tell support what
   * you were doing." while the server was answering, in full sentences, that
   * there was no signed-in user. Two people then spent a while looking at the
   * print-record check, which was working perfectly.
   *
   * GATED ON THE MESSAGE, EXACTLY AS 400 IS, and for the same reason: a bare
   * 403 usually means "you may not do this", which is a true and different
   * thing, and telling somebody to sign in again would send them round a loop
   * that cannot help. Only a 403 that SAYS there is no signed-in user is a
   * stale session.
   */
  const saysNobodyIsSignedIn = Boolean(bodyMessage?.includes('signed-in user'));
  return status === 401 || ((status === 400 || status === 403) && saysNobodyIsSignedIn);
}

/** True for the message `explainFailure` produces for an expired session. */
export function isExpiredSessionMessage(message: string): boolean {
  return message === strings.status.sessionExpired;
}
