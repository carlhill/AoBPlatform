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

  it('an ordinary 400 refusal is NOT reclassified as an expired session', async () => {
    expect(isExpiredSessionFailure(400, 'Change at least one detail first.')).toBe(false);
    const res = response(400, { message: 'Change at least one detail first.' });
    expect(await explainFailure(res)).toBe('Change at least one detail first.');
  });
});
