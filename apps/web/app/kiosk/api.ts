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
 *
 * THE TABLET NO LONGER SAYS WHICH PRACTICE IT IS (3 Sep 2026). Every request
 * carries `x-device-credential` and none carries `x-practice-id`: the server
 * resolves the practice from the credential and refuses the header outright on
 * `/kiosk/*`. That is what closed the hole where anybody who reached the URL
 * could read a practice's waiting list by sending an id. The credential is
 * read from `pairing.ts` on each call rather than captured at module load, so
 * a tablet that pairs mid-session starts working without a reload.
 */
import type {
  ConfirmableDetailType,
  DeviceSettableTabletSessionState,
  KioskWaitingRow,
  TabletSessionPayload,
  TabletSessionState,
} from '@aobplatform/domain';
import { coreBaseUrl, getSession, kioskBuildId } from './session';
import { readPairingCredential } from './pairing';
import type { SignRequestBody } from './rules/signature-payload';

export type { KioskWaitingRow, TabletSessionPayload };

/** `GET /kiosk/waiting-list`. */
export interface WaitingListResponse {
  readonly practiceId: string;
  readonly revision: string;
  /** SERVER-DECLARED cadence. The tablet obeys it; it does not pick its own. */
  readonly pollMs: number;
  /** TYPES only, never values (REQ-VER-04). */
  readonly identifierTypes: readonly string[];
  readonly waiting: readonly KioskWaitingRow[];
  /**
   * TRUE WHEN THIS DEVICE IS NOT A TEST DEVICE, which is every tablet a real
   * practice uses (Carl, 4 Sep 2026). `waiting` is then empty and there is no
   * count anywhere in the body — the count was the first disclosure removed.
   * The poll still runs: it carries `reload` and it is the tablet's health
   * signal, which is all the walk-up flow needs from it.
   */
  readonly hidden?: boolean;
  /**
   * WHETHER ANYBODY IS WAITING AT ALL -- a boolean, never a count (Carl,
   * 4 Sep 2026). Rides on the hidden response so an ordinary tablet can hide
   * Begin over an empty queue without learning who or how many.
   */
  readonly anyoneWaiting?: boolean;
  /**
   * This tab is below the practice's kiosk build floor and must hard-reload.
   * It rides on the POLL rather than on a channel of its own, so a rollback
   * reaches an open tab within the cadence the server already chose — and it
   * is inside the ETag, so a quiet morning cannot answer 304 and swallow it.
   */
  readonly reload?: boolean;
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

/**
 * `GET /kiosk/me` — who this tablet is, answered by the server.
 *
 * IT REPLACED `GET /practices/:id`. The kiosk used to fetch a practice by an
 * id baked into the bundle at build time; it now holds one opaque credential
 * and asks. Nothing configurable comes back — a device with no settings is a
 * device that cannot be configured to ask for a Medicare card number
 * (REQ-VER-02).
 */
export interface KioskMeResponse {
  readonly deviceId: string;
  /** The name a person gave the tablet, for support to recognise it by. */
  readonly deviceLabel: string;
  readonly practiceId: string;
  readonly practiceName: string;
  readonly state?: string | null;
  /** TYPES only, never values (REQ-VER-04). */
  readonly identifierTypes?: readonly string[];
  /**
   * A TEST DEVICE — the only kind shown the waiting list (Carl, 4 Sep 2026).
   * Answered on the first call the tablet makes, so K-1 knows which front door
   * Begin opens before anybody presses it. Absent or false means the walk-up
   * flow, which is the safe default when an older server answers this call.
   */
  readonly showsWaitingList?: boolean;
  /** This tab is below the practice's build floor and must hard-reload. */
  readonly reload: boolean;
}

/**
 * `POST /kiosk/claim` — the walk-up front door.
 *
 * `passed` carries the one row the server matched. `failed` and `locked_out`
 * carry a message and NOTHING ELSE: zero matches and several matches are the
 * same answer, because "nobody by that name" and "two people here match" are
 * both facts about other people (REQ-SEC-07).
 */
export interface KioskClaimResponse {
  readonly outcome: 'passed' | 'failed' | 'locked_out';
  readonly verificationEventId?: string;
  readonly message?: string;
  readonly row?: KioskWaitingRow;
}

/** `POST /devices/pair` — the one call made with no credential, because it earns one. */
export interface PairingResponse {
  readonly credential: string;
  readonly deviceId: string;
  readonly practiceName: string;
  readonly label: string;
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

/**
 * WHAT EVERY KIOSK REQUEST CARRIES, and what it deliberately does not.
 *
 * `x-device-credential` — the one thing this tablet holds. The server reads
 * the practice off it; there is no `x-practice-id` here and there must not be,
 * because a client that can assert a practice is a client that can assert
 * somebody else's.
 *
 * `x-kiosk-build` — which build this tab is running, so a rollback can reach
 * a tab that has been open since eight in the morning. A version string and
 * nothing else: no device fingerprint, no user agent, nothing about a person.
 *
 * READ FRESH ON EVERY CALL rather than captured once at module load, so a
 * tablet that has just paired starts working immediately and one that has just
 * been revoked stops.
 */
function headers(extra?: Record<string, string>): Record<string, string> {
  const session = getSession();
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-kiosk-build': kioskBuildId(),
  };
  const credential = readPairingCredential();
  if (credential) base['x-device-credential'] = credential;
  if (session.accessToken) base.Authorization = `Bearer ${session.accessToken}`;
  return { ...base, ...extra };
}

/**
 * THE SERVER SAYS THIS TABLET IS NOT PAIRED — revoked, rotated, or holding a
 * credential from a practice that no longer knows it.
 *
 * Every caller answers it the same way: drop to the unpaired screen and STOP.
 * Not a retry, and above all not a retry loop — "no retry loop hammering the
 * server" is the requirement (TODO.md), and a tablet that hammers a 401 every
 * two seconds is a tablet somebody has to visit in order to quieten.
 */
export function isUnpaired(err: unknown): boolean {
  return err instanceof KioskApiError && err.status === 401;
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
 * Who this tablet is: the practice name and state for the header, the label
 * somebody gave the device, and whether this tab is below the build floor.
 *
 * ONE CALL AT START-UP, and it is also the paired/unpaired test — a 401 here
 * is the whole answer to "may this tablet be used", which is why the ceremony
 * asks it before it asks anything else.
 */
export function fetchKioskMe(): Promise<KioskMeResponse> {
  return request<KioskMeResponse>('/kiosk/me');
}

/**
 * THE ONE CALL MADE WITHOUT A CREDENTIAL, because it is the call that earns
 * one. Deliberately NOT through `request`: sending a stale or revoked
 * credential alongside a pairing code would have the attempt refused by the
 * guard before the code was ever looked at — and that is exactly the state a
 * tablet is in when somebody is standing there trying to re-pair it.
 *
 * The code is normalised server-side, so the screen never has to teach anybody
 * about hyphens or capitals.
 */
export async function pairDevice(code: string): Promise<PairingResponse> {
  const res = await fetch(`${coreBaseUrl()}/devices/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    // The server's sentence is the same for every kind of failure by design;
    // the screen shows its own copy regardless, and never the body.
    throw new KioskApiError(res.statusText, res.status);
  }
  return (await res.json()) as PairingResponse;
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

/**
 * THE WALK-UP CLAIM: three details in, one row out — or the generic refusal.
 *
 * WHAT IT REPLACED. The tablet used to show the waiting list, the patient
 * tapped their name, and only then proved it was them. That put a list of
 * patient names on a screen in a waiting room. Now the patient types the same
 * three details they were going to type anyway and the SERVER does the
 * finding, so a bystander sees nothing at all.
 *
 * ONE CALL DOES BOTH. There is no separate challenge to open first — there is
 * no patient to open it against until the match is made — so this is the whole
 * of K-2's server conversation. The values go out once and nothing in this
 * module keeps them.
 */
export function claimWaitingRow(stated: Record<string, string>): Promise<KioskClaimResponse> {
  return request<KioskClaimResponse>('/kiosk/claim', {
    method: 'POST',
    body: JSON.stringify({ stated }),
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

/**
 * THE DRAWN MARK TRAVELS WITH THE SIGN CALL (REQ-SIG-01/-02).
 *
 * `input` is composed by `rules/signature-payload.ts` and carries `signature`
 * for a drawn signature and nothing for a tap-to-approve. The server stores
 * the strokes and the image as artefacts of the agreement, hashes both, and
 * binds both hashes into the signature event beside the rendered agreement's
 * own hash — so what is on record is the mark the person made, not merely that
 * a mark was reported.
 *
 * NOTHING HERE KEEPS A COPY. The body is built, sent and dropped; no data URL,
 * no stroke and no request body is written to storage or a console
 * (zero-footprint, CLAUDE.md §7).
 */
export function signAgreement(
  agreementId: string,
  input: SignRequestBody,
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

/* -------------------------------------------------------------------------
 * THE SECOND FRONT DOOR — reception pushes one locked agreement to this
 * tablet (TODO.md "Two front doors", Carl 4 Sep 2026).
 *
 * THREE CALLS AND NO FOURTH. The tablet asks what it is showing, says it is
 * reading, says the person left, and ticks the details. It CANNOT declare
 * itself signed — that is the existing `POST /agreements/:id/sign`, exactly as
 * the walk-up K-4 does it — and it cannot recall itself, because recall is a
 * console act for the same reason revoke is.
 *
 * THE PAYLOAD TYPE IS THE DOMAIN'S. `TabletSessionPayload` comes from
 * `packages/domain/src/tablet-session.ts`, which the server builds its
 * response from, so the tablet and the server cannot hold different opinions
 * about what a session is. Nothing is re-declared here.
 * ---------------------------------------------------------------------- */

/** `GET /kiosk/session` — the one pushed session, or none. */
export interface TabletSessionResponse {
  readonly session: TabletSessionPayload | null;
}

/**
 * WHAT IS ON THIS TABLET RIGHT NOW.
 *
 * `Cache-Control: no-store` is the server's, and it matters more here than on
 * the waiting list: that response carries names, this one carries a date of
 * birth and an address. Nothing in this module keeps a copy — the payload goes
 * to component state and is dropped when the session ends.
 */
export function fetchTabletSession(): Promise<TabletSessionResponse> {
  return request<TabletSessionResponse>('/kiosk/session');
}

/**
 * THE TICKS — TYPES ONLY, NEVER VALUES (REQ-VER-04, hard rule 9).
 *
 * The parameter is typed `ConfirmableDetailType[]`, so a value cannot be
 * passed here even by mistake: `'name'` type-checks and the name does not.
 * And it is NOT a verification — a displayed value confirmed by whoever holds
 * the tablet proves nothing about who is holding it. The verification was the
 * staff check across the desk that the push already recorded (REQ-VER-03).
 */
export function confirmSessionDetails(
  sessionId: string,
  confirmed: readonly ConfirmableDetailType[],
): Promise<{ id: string; state: TabletSessionState }> {
  return request(`/kiosk/session/${sessionId}/confirm-details`, {
    method: 'POST',
    body: JSON.stringify({ confirmed }),
  });
}

/**
 * WHAT THE TABLET IS SHOWING — `reading`, or that the person walked away.
 *
 * `walked_away` ENDS THE SESSION AND CHANGES NOTHING ON THE AGREEMENT. That is
 * hard rule 8 on the wire: the patient is still seen, and reception chooses a
 * private bill or an episodic agreement after the service.
 */
export function setTabletSessionState(
  sessionId: string,
  state: DeviceSettableTabletSessionState,
): Promise<{ id: string; state: TabletSessionState }> {
  return request(`/kiosk/session/${sessionId}/state`, {
    method: 'POST',
    body: JSON.stringify({ state }),
  });
}
