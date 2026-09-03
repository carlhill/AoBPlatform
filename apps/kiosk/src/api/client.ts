/**
 * The kiosk's whole conversation with `apps/core`. Seven calls, all of which
 * already existed before this app did (commit 7553f67 added the eighth, the
 * waiting list) — the kiosk adds no ceremony of its own.
 *
 * ETAGS ARE THE POINT OF THE POLL. `fetchWaitingList` sends `If-None-Match`
 * and returns `notModified` on a 304, so an unchanged waiting room costs a
 * status line and no JSON. At the server's own two-second cadence that is
 * most of the requests on most mornings (§9.4, and the server's `revisionOf`
 * comment).
 *
 * NO IDENTIFIER VALUE IS EVER LOGGED OR RETAINED HERE. `attemptChallenge`
 * takes the stated values, hands them to the server and returns; nothing in
 * this module keeps them, and nothing in this module writes a request body to
 * a console.
 */
import { coreBaseUrl, getSession } from '../session';
import {
  KioskApiError,
  type AgreementResponse,
  type AttemptResponse,
  type ChallengeResponse,
  type PracticeResponse,
  type PracticeUsersResponse,
  type WaitingListResponse,
} from './types';

function headers(extra?: Record<string, string>): Record<string, string> {
  const session = getSession();
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    // The dev-time practice stand-in; the auth guard overwrites it from the
    // token's practice claim whenever a verified principal is present.
    'x-practice-id': session.practiceId,
  };
  if (session.accessToken) base.Authorization = `Bearer ${session.accessToken}`;
  return { ...base, ...extra };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${coreBaseUrl()}${path}`, { ...init, headers: headers(init?.headers as never) });
  if (!res.ok) {
    // The body may name a rule failure; it never names a patient detail value.
    const text = await res.text().catch(() => '');
    throw new KioskApiError(text.slice(0, 400) || res.statusText, res.status);
  }
  return (await res.json()) as T;
}

export type WaitingListResult =
  | { readonly kind: 'changed'; readonly etag: string | null; readonly body: WaitingListResponse }
  | { readonly kind: 'notModified' };

export async function fetchWaitingList(etag: string | null): Promise<WaitingListResult> {
  const res = await fetch(`${coreBaseUrl()}/kiosk/waiting-list`, {
    headers: headers(etag ? { 'If-None-Match': etag } : undefined),
  });
  if (res.status === 304) return { kind: 'notModified' };
  if (!res.ok) throw new KioskApiError(res.statusText, res.status);
  const body = (await res.json()) as WaitingListResponse;
  /*
   * THE TAG IS RECONSTRUCTED WHEN THE HEADER CANNOT BE READ, and this is not
   * belt-and-braces — it is the difference between the ETag path working and
   * not working in a browser.
   *
   * On a native tablet the `ETag` header is right there. Under CORS it is not:
   * `ETag` is not a CORS-safelisted response header, so unless the server
   * sends `Access-Control-Expose-Headers: ETag` (core enables CORS with
   * defaults, so it does not), `headers.get('etag')` returns null — every poll
   * would then omit `If-None-Match` and every poll would cost a full body.
   * The failure is silent, which is the worst kind.
   *
   * The server's own tag is `"<revision>"` and `revision` is in the body, so
   * the client can compose the identical value from the contract it already
   * has. No server change, and 304s work in both builds.
   */
  const headerTag = res.headers.get('etag');
  return {
    kind: 'changed',
    etag: headerTag ?? (body.revision ? `"${body.revision}"` : null),
    body,
  };
}

/**
 * The practice's own name and location line, for the header. One call at
 * start-up; the kiosk holds no configuration of its own (REQ-VER-02 — a device
 * with no settings is a device that cannot be configured to ask for a card
 * number).
 */
export function fetchPractice(): Promise<PracticeResponse> {
  const session = getSession();
  return request<PracticeResponse>(`/practices/${session.practiceId}`);
}

export function fetchAgreement(agreementId: string): Promise<AgreementResponse> {
  return request<AgreementResponse>(`/agreements/${agreementId}`);
}

export function startChallenge(input: {
  patientId: string;
  identifierTypes: readonly string[];
}): Promise<ChallengeResponse> {
  return request<ChallengeResponse>('/verification/challenges', {
    method: 'POST',
    body: JSON.stringify({
      patientId: input.patientId,
      channel: 'in_practice',
      identifierTypes: input.identifierTypes,
    }),
  });
}

export function attemptChallenge(
  challengeId: string,
  stated: Record<string, string>,
): Promise<AttemptResponse> {
  const session = getSession();
  return request<AttemptResponse>(`/verification/challenges/${challengeId}/attempt`, {
    method: 'POST',
    body: JSON.stringify({
      stated,
      // Every in-practice verification is attributed to the signed-in staff
      // member; that is what the passkey session on the device buys.
      ...(session.staffId ? { verifiedByStaffId: session.staffId } : {}),
    }),
  });
}

/**
 * Moves a verified draft to the signing step. The remote link path does this
 * inside `capture.verifyLink`; the in-practice path has no equivalent server
 * hop, so the kiosk asks for the transition explicitly — through the domain
 * transition map, which refuses anything the lifecycle does not allow.
 */
export function transitionAgreement(agreementId: string, to: string): Promise<AgreementResponse> {
  return request<AgreementResponse>(`/agreements/${agreementId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to }),
  });
}

export function lockParticulars(
  agreementId: string,
  input: { serviceDate: string; basicServiceDescription?: string },
): Promise<AgreementResponse> {
  return request<AgreementResponse>(`/agreements/${agreementId}/particulars`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function signAgreement(
  agreementId: string,
  input: { method: 'drawn' | 'tap_to_approve'; captureRequestId: string },
): Promise<AgreementResponse> {
  return request<AgreementResponse>(`/agreements/${agreementId}/sign`, {
    method: 'POST',
    body: JSON.stringify({ ...input, channel: 'in_practice' }),
  });
}

export function completeCapture(captureRequestId: string): Promise<unknown> {
  return request(`/capture/${captureRequestId}/complete`, { method: 'POST' });
}

/**
 * The practice's own staff names, for the REQ-VUL-04 block. Held in memory for
 * the session and compared against, never displayed. A practice list that
 * cannot be fetched leaves the block unable to fire, so the caller treats a
 * failure as a reason to route the assignor branch to the desk rather than as
 * a reason to let it through.
 */
export async function fetchPracticeStaffNames(): Promise<readonly string[]> {
  const body = await request<PracticeUsersResponse>('/practice-users');
  return body.users.map((user) => user.name).filter((name) => typeof name === 'string');
}
