/**
 * ONE HELPER, SO A FAILED RESPONSE NEVER SHOWS AS A BARE NUMBER (Carl, 7 Sep
 * 2026 — "a console tab left open shows signed in after the session has
 * expired… actions then fail with a bare 400").
 *
 * Lives under `app/practice` rather than beside `apiError.ts` itself because
 * `vitest.config.ts` only runs `app/kiosk`, `app/practice`, `app/platform`,
 * `app/patient` and `app/apply` — the scope is named there and this does not
 * widen it, it borrows a slot in a directory that is already covered.
 */
import { describe, expect, it } from 'vitest';
import { explainFailure, isExpiredSessionFailure, isExpiredSessionMessage } from '../apiError';
import { strings } from '../strings';

function response(status: number, body: unknown, statusText = ''): Response {
  return {
    status,
    statusText,
    json: async () => body,
  } as unknown as Response;
}

describe('failures_show_the_servers_reason_not_a_number', () => {
  it('a 400 with a body message shows that message, not "400"', async () => {
    const res = response(400, { message: 'Change at least one detail first.' });
    const message = await explainFailure(res);
    expect(message).toBe('Change at least one detail first.');
    expect(message).not.toMatch(/^\d+$/);
  });

  it('an array of messages is joined into one sentence', async () => {
    const res = response(400, { message: ['name must not be empty', 'dateOfBirth must be a date'] });
    expect(await explainFailure(res)).toBe('name must not be empty dateOfBirth must be a date');
  });

  it('no body and no statusText still names the code, in words, never bare', async () => {
    const res = response(503, {}, '');
    const message = await explainFailure(res);
    expect(message).toBe(strings.status.httpRefused(503));
    expect(message).not.toBe('503');
  });

  it('a body that is not JSON falls back to statusText', async () => {
    const res = {
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    } as unknown as Response;
    expect(await explainFailure(res)).toBe('Bad Gateway');
  });
});

describe('expired_session_failure_says_sign_in_again', () => {
  it('a 401 is always the expired-session case, whatever the body says', async () => {
    const res = response(401, { message: 'unauthorized' });
    expect(await explainFailure(res)).toBe(strings.status.sessionExpired);
    expect(isExpiredSessionMessage(await explainFailure(res))).toBe(true);
  });

  it('a 401 with no body at all is still the expired-session case', async () => {
    const res = response(401, undefined);
    expect(await explainFailure(res)).toBe(strings.status.sessionExpired);
  });

  it('a 400 naming the review-tasks refusal is recognised by its own wording', async () => {
    // The exact sentence core's review-tasks service throws
    // (apps/core/src/review-tasks/review-tasks.service.ts) when the caller
    // could not be identified — never retyped here, matched by the substring
    // the rule is defined by.
    const res = response(400, { message: 'Resolving a review records who decided, so it needs a signed-in user.' });
    expect(await explainFailure(res)).toBe(strings.status.sessionExpired);
  });

  it('a_403_that_says_nobody_is_signed_in_is_the_expired_session_case', async () => {
    /*
     * CARL, 28 SEPTEMBER 2026, AT A LIVE DESK: *"could not send to tablet"*,
     * twice, on two records whose print jobs were perfectly readable.
     *
     * `pushRefusals.noActor()` is a `ForbiddenException` — 403 — and the one
     * refusal in the push path with no `reason` code, because it is not a
     * push refusal at all: it is the request arriving with nobody attached.
     * This helper only knew 401 and 400, so the console fell through to
     * "Could not send. Please tell support what you were doing." while the
     * server was explaining the actual problem in full sentences.
     *
     * THE SENTENCE IS CORE'S OWN, not retyped — matched by the substring the
     * rule is defined by, exactly as the 400 case above is.
     */
    const noActor =
      'Sending an agreement to a tablet records the staff-verified identity check that goes with it, so '
      + 'it is recorded against the person who did it. This request carries no signed-in user, so it is '
      + 'refused rather than recorded as nobody.';
    expect(isExpiredSessionFailure(403, noActor)).toBe(true);
    const res = response(403, { message: noActor });
    expect(await explainFailure(res)).toBe(strings.status.sessionExpired);
  });

  it('an_ordinary_403_is_a_refusal_and_not_a_stale_session', async () => {
    /*
     * A BARE 403 USUALLY MEANS "YOU MAY NOT DO THIS", which is true and
     * different, and telling somebody to sign in again would send them round
     * a loop that cannot help them. Only a 403 that SAYS there is no
     * signed-in user is reclassified.
     */
    expect(isExpiredSessionFailure(403, 'This practice is not yours to act on.')).toBe(false);
    expect(isExpiredSessionFailure(403, undefined)).toBe(false);
    const res = response(403, { message: 'This practice is not yours to act on.' });
    expect(await explainFailure(res)).toBe('This practice is not yours to act on.');
  });

  it('an ordinary 400 refusal is NOT reclassified as an expired session', async () => {
    expect(isExpiredSessionFailure(400, 'Change at least one detail first.')).toBe(false);
    const res = response(400, { message: 'Change at least one detail first.' });
    expect(await explainFailure(res)).toBe('Change at least one detail first.');
  });
});
