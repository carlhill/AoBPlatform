/**
 * The kiosk's whole conversation with `apps/core`. Every call here already
 * existed before this surface did; the kiosk adds no ceremony of its own.
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
import type { KioskWaitingRow } from '@aobplatform/domain';
import { coreBaseUrl, getSession } from './session';

export type { KioskWaitingRow };

/** `GET /kiosk/waiting-list`. */
export interface WaitingListResponse {
  readonly practiceId: string;
  readonly revision: string;
  /** SERVER-DECLARED cadence. The tablet obeys it; it does not pick its own. */
  readonly pollMs: number;
  /** TYPES only, never values (REQ-VER-04). */
  readonly identifierTypes: readonly string[];
  readonly waiting: readonly KioskWaitingRow[];
}

/** `GET /agreements/:id` — only the fields the ceremony reads. */
export interface AgreementResponse {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly patientId: string;
  readonly assignorId: string;
  readonly assignorIsPatient: boolean;
  readonly particulars: Record<string, unknown> | null;
  readonly particularsLockedAt: string | null;
  readonly ruleSetVersion: string | null;
  readonly mappingVersion: string | null;
  readonly renderedArtefactHash: string | null;
}

export interface ChallengeResponse {
  readonly challengeId: string;
  readonly identifierTypes: readonly string[];
}

export interface AttemptResponse {
  readonly outcome: 'passed' | 'failed' | 'locked_out';
  readonly verificationEventId?: string;
  /** Present on a failure. Generic by construction — the kiosk shows its own copy regardless. */
  readonly message?: string;
}

export interface PracticeResponse {
  readonly id: string;
  readonly name: string;
  readonly state?: string | null;
  /** The practice's configured challenge set — the approved six only (REQ-VER-02). */
  readonly identifierTypes?: readonly string[];
}

export interface PracticeUsersResponse {
  readonly users: ReadonlyArray<{ readonly name: string }>;
}

/** Thrown for any non-2xx. Carries the status so a caller can tell a 404 from a 500. */
export class KioskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'KioskApiError';
  }
}

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
  const res = await fetch(`${coreBaseUrl()}${path}`, {
    ...init,
    headers: headers(init?.headers as Record<string, string> | undefined),
  });
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
   * `ETag` is not a CORS-safelisted response header, so unless the server
   * sends `Access-Control-Expose-Headers: ETag` (core enables CORS with
   * defaults, so it does not), `headers.get('etag')` returns null — every poll
   * would then omit `If-None-Match` and every poll would cost a full body.
   * The failure is silent, which is the worst kind.
   *
   * The server's own tag is `"<revision>"` and `revision` is in the body, so
   * the client can compose the identical value from the contract it already
   * has. No server change, and 304s work.
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

/**
 * SOMEBODY OTHER THAN THE PATIENT IS SIGNING — or the patient is after all.
 *
 * NEW SINCE THE EXPO BUILD, and it is what closes that build's one honest gap:
 * `apps/kiosk` ran the gates and then handed over to the desk, because nothing
 * re-pointed a draft at a different assignor. `POST /agreements/:id/assignor`
 * now does, with the same rules the tablet applies (`@aobplatform/domain`'s
 * `buildAssignorForAnother`), so the ceremony continues to K-3 instead of
 * ending at reception.
 *
 * IT REFUSES AFTER THE PARTICULARS ARE LOCKED (REQ-REG-06 — who signs is one
 * of the locked particulars). The UI must never offer it there; this is the
 * server saying so anyway, because a rule enforced only on a client is a
 * suggestion.
 */
export interface ChangeAssignorRequest {
  /** D7 — explicit, never inferred (CLAUDE.md §3). */
  readonly assignorIsPatient: boolean;
  readonly name?: string;
  /** The word the person chose — the fact C8 prints. Separate from the basis (REQ-VUL-01). */
  readonly relationship?: string;
  /** Which version of the relationship list produced it (hard rule 14). */
  readonly relationshipsVersion?: string;
  /** Reg 65CB(5)'s category, derived from the relationship through versioned content. */
  readonly authorityBasis?: string;
  readonly note?: string;
  /** REQ-AGE-01. The DECLARATION made on screen, never a stored date of birth. */
  readonly declaresEighteenOrOver?: boolean;
  readonly mobile?: string;
  readonly email?: string;
}

export function changeAssignor(
  agreementId: string,
  body: ChangeAssignorRequest,
): Promise<AgreementResponse> {
  return request<AgreementResponse>(`/agreements/${agreementId}/assignor`, {
    method: 'POST',
    body: JSON.stringify(body),
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
