/**
 * The portal's whole conversation with `apps/core` (M8, C8).
 *
 * ONE COOKIE, NO HEADER. Every call carries `credentials: 'include'` and
 * nothing else: the session is the httpOnly `aob_portal` cookie the server
 * sets, so nothing a script can reach holds it and no client-asserted
 * identifier exists to forge. There is deliberately no `x-practice-id` here —
 * the server resolves the patient's links from the cookie, which is what stops
 * one practice's row appearing under another's name.
 *
 * A 401 IS A STATE, NOT AN ERROR. It means "not signed in", which is an
 * ordinary answer for this page: portal access is never a precondition of
 * signing (REQ-PORT-08), so most patients will never have opened it.
 *
 * THE FIXTURE SWITCH, AND WHY IT IS ONE LINE. The server side of this contract
 * is being built in parallel (`apps/core/src/portal`). Until it lands, every
 * function below answers from `fixtures.ts`; when it lands, set
 * `NEXT_PUBLIC_PORTAL_FIXTURES=false` (or flip the default in `PORTAL_FIXTURES`
 * below) and every call goes to core with no change anywhere else. The shapes
 * in this file ARE the contract — they are what the cards are typed against —
 * so the switch cannot quietly change what a card is handed.
 *
 * NOTHING HERE PERSISTS ANYTHING. No storage API is touched, and no response
 * body is written to a console: these payloads carry a date of birth and an
 * address.
 */
import type { ConfirmableDetailType } from '@aobplatform/domain';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:3001';

/**
 * TRUE WHILE THE SERVER SIDE IS BEING BUILT. The default is the honest local
 * answer today; the env var is how a deployment says otherwise without a code
 * change. This is the only line that decides, by design.
 */
export const PORTAL_FIXTURES = (process.env.NEXT_PUBLIC_PORTAL_FIXTURES ?? 'true') !== 'false';

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** One practice this account is linked to. The patient carries the link, never a practice. */
export interface PortalLink {
  readonly practiceId: string;
  readonly practiceName: string;
  readonly patientId: string;
}

/** `GET /portal/session`. A 401 means signed out, which is a normal state here. */
export interface PortalSession {
  readonly accountId: string;
  readonly links: readonly PortalLink[];
}

/**
 * `GET /portal/details` — one row PER PRACTICE, because the PMS is the master
 * and two practices can hold different addresses for the same person.
 *
 * THERE IS NO MEDICARE FIELD AND THERE MUST NOT BE (hard rule 1, REQ-VER-02).
 * `DetailsCard` also refuses to render one if a payload ever grows one.
 */
export interface PortalDetails {
  readonly practiceId: string;
  readonly practiceName: string;
  readonly familyName: string;
  readonly givenNames: string;
  readonly dateOfBirth: string;
  readonly address: string;
  readonly mobile: string;
  readonly email: string;
  readonly patientRecordNumber: string;
}

/** `GET /portal/agreements`. NO AMOUNT — not on the wire, not on the card (hard rule 4). */
export interface PortalAgreement {
  readonly id: string;
  readonly practiceName: string;
  readonly providerName: string;
  readonly type: string;
  readonly status: string;
  readonly serviceDate: string | null;
  readonly serviceDescription: string | null;
  readonly channel: string;
  readonly signedAt: string | null;
  readonly artefactAvailable: boolean;
}

/** `GET /portal/enduring` — per practitioner × patient, never per practice (hard rule 6). */
export interface PortalEnduring {
  readonly agreementId: string;
  readonly practiceName: string;
  readonly providerName: string;
  readonly activeSince: string;
}

/** `POST /portal/enduring/:id/terminate` — the written notice, and when it bites. */
export interface PortalTermination {
  readonly noticeId: string;
  readonly effectiveAt: string;
}

/**
 * `GET /portal/notices` — reg 89AA claim notifications.
 *
 * THE ONE PLACE A BENEFIT AMOUNT EXISTS in this product (REQ-REG-04,
 * REQ-PORT-04). One-way: nothing here is approved, declined or chased.
 */
export interface PortalNotice {
  readonly id: string;
  readonly date: string;
  readonly providerName: string;
  readonly practiceName: string;
  readonly benefitAmountCents: number;
}

/** `GET /portal/visits` — where an agreement was made. Never a clinical record. */
export interface PortalVisit {
  readonly date: string;
  readonly practiceName: string;
  readonly locationLine: string;
}

/** `GET /portal/messages` — that a message was sent, never what it said. */
export interface PortalMessage {
  readonly id: string;
  readonly channel: string;
  readonly sentAt: string;
  readonly state: string;
  readonly purposeKey: string;
  readonly practiceName: string;
  /** Waiting for the patient — the structural answer to phishing (REQ-PORT-06). */
  readonly pending: boolean;
}

/** Somebody nominated to act for this patient (REQ-PORT-07, REQ-VUL-01). */
export interface PortalActsForMe {
  readonly assignorId: string;
  readonly name: string;
  /** A key into the versioned relationship list, never a display label on the wire. */
  readonly relationshipKey: string;
  readonly since: string;
  readonly active: boolean;
}

/** A patient this account acts for — scoped, and never their clinical anything. */
export interface PortalIActFor {
  readonly patientId: string;
  readonly practiceName: string;
  readonly givenNames: string;
  readonly since: string;
}

export interface PortalAssignors {
  readonly actsForMe: readonly PortalActsForMe[];
  readonly iActFor: readonly PortalIActFor[];
}

/** `GET /portal/access-log` — every look, from the vault's own events (FR-8.2). */
export interface PortalAccessEntry {
  readonly at: string;
  readonly actorType: 'practice_staff' | 'patient' | 'system';
  readonly practiceName: string;
  /** A key; the label comes from the string table, and an unmapped key shows as itself. */
  readonly actionKey: string;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** Thrown for any non-2xx. Carries the status so 401 can be told from 500. */
export class PortalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PortalApiError';
  }
}

export function isSignedOut(err: unknown): boolean {
  return err instanceof PortalApiError && err.status === 401;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CORE_URL}${path}`, {
    ...init,
    // The session cookie, and only the session cookie.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    // The body may name a rule; it never names a detail value, and it is never logged.
    throw new PortalApiError(res.statusText || `HTTP ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

/*
 * Every function is `fixtures first, then the real call`. The import is lazy so
 * a production build with the switch off can drop the fixture module entirely
 * rather than shipping sample identities to a browser.
 */
async function fixtures() {
  return import('./fixtures');
}

export async function fetchSession(): Promise<PortalSession> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureSession();
  return request<PortalSession>('/portal/session');
}

export async function fetchDetails(): Promise<readonly PortalDetails[]> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureDetails;
  return request<readonly PortalDetails[]>('/portal/details');
}

export async function fetchAgreements(): Promise<readonly PortalAgreement[]> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureAgreements;
  return request<readonly PortalAgreement[]>('/portal/agreements');
}

export async function fetchEnduring(): Promise<readonly PortalEnduring[]> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureEnduring;
  return request<readonly PortalEnduring[]>('/portal/enduring');
}

export async function fetchNotices(): Promise<readonly PortalNotice[]> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureNotices;
  return request<readonly PortalNotice[]>('/portal/notices');
}

export async function fetchVisits(): Promise<readonly PortalVisit[]> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureVisits;
  return request<readonly PortalVisit[]>('/portal/visits');
}

export async function fetchMessages(): Promise<readonly PortalMessage[]> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureMessages;
  return request<readonly PortalMessage[]>('/portal/messages');
}

export async function fetchAssignors(): Promise<PortalAssignors> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureAssignors;
  return request<PortalAssignors>('/portal/assignors');
}

export async function fetchAccessLog(): Promise<readonly PortalAccessEntry[]> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureAccessLog;
  return request<readonly PortalAccessEntry[]>('/portal/access-log');
}

/**
 * ENDING AN ENDURING AGREEMENT — the patient's own right under 65CA(7)(b),
 * held even where somebody else entered the agreement for them (REQ-END-06).
 *
 * The server generates and delivers the written notice; this returns when it
 * takes effect, which is two business days from the notice (FR-5.3). The card
 * shows that date rather than claiming it is already over.
 */
export async function terminateEnduring(agreementId: string): Promise<PortalTermination> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixtureTermination();
  return request<PortalTermination>(`/portal/enduring/${encodeURIComponent(agreementId)}/terminate`, {
    method: 'POST',
  });
}

/**
 * ASKING A PRACTICE TO CORRECT A DETAIL — a request, never an edit.
 *
 * NO NEW VALUE IS SENT, and there is no parameter for one. The PMS is the
 * master and the practice owns the record (an APP 13-style correction routed to
 * the record owner), so what travels is "this one is wrong"; the practice
 * confirms the right value with the patient themselves.
 */
export async function requestDetailCorrection(
  practiceId: string,
  fieldType: ConfirmableDetailType,
): Promise<void> {
  if (PORTAL_FIXTURES) return;
  await request<void>('/portal/details/correction-request', {
    method: 'POST',
    body: JSON.stringify({ practiceId, fieldType }),
  });
}

/** Withdrawing somebody's authority to act. No reason is asked for, and none is sent. */
export async function revokeAssignor(assignorId: string): Promise<void> {
  if (PORTAL_FIXTURES) return;
  await request<void>(`/portal/assignors/${encodeURIComponent(assignorId)}/revoke`, { method: 'POST' });
}

/**
 * The agreement AS SIGNED. Opened in a new tab rather than fetched: the server
 * re-verifies the hash on the way out (hard rule 13) and answers a PDF, and a
 * blob built in the browser would be a second render path.
 */
export function artefactUrl(agreementId: string): string {
  return `${CORE_URL}/portal/agreements/${encodeURIComponent(agreementId)}/artefact`;
}

/**
 * SIGN OUT — a server-side revoke, not only a cleared cookie (Carl, 4 Sep
 * 2026: "no sign-out button"). The session row is revoked on the server, so a
 * copied cookie is dead too; the browser then re-asks `/portal/session` and
 * lands on the signed-out screen.
 */
export async function signOut(): Promise<void> {
  if (PORTAL_FIXTURES) {
    (await fixtures()).closeFixtureSession();
    return;
  }
  await request<{ signedOut: true }>('/portal/sign-out', { method: 'POST' });
}

/**
 * DEV ONLY — mint a portal session for named patients without a passkey.
 *
 * Guarded exactly like the console's own bypass (`AuthGate`,
 * `NEXT_PUBLIC_DEV_UNAUTHENTICATED_CONSOLE`): the control that calls this does
 * not render unless the build was made with the flag set, and core answers
 * `/dev/*` only in a development configuration. It is not a second way in.
 */
export async function openDevPortalSession(
  patientIds: readonly string[],
  practiceIds: readonly string[] = [],
): Promise<void> {
  if (PORTAL_FIXTURES) {
    (await fixtures()).openFixtureSession();
    return;
  }
  // RLS IS LIVE IN DEV, so the seam has to be told which practices to look
  // in — it has no back door across the fence (see portal-dev.controller.ts).
  await request<void>('/dev/portal-session', {
    method: 'POST',
    body: JSON.stringify({ patientIds, practiceIds }),
  });
}

// ---------------------------------------------------------------------------
// FR-8.2 — passkeys (Carl, 4 Sep 2026: "Implement"; D-2026-09-04-02)
// ---------------------------------------------------------------------------

/**
 * ONE CREDENTIAL, AS THE "SIGN-IN AND SECURITY" CARD LISTS IT.
 *
 * `label` is the patient's own words for their own device and may be null,
 * which is the ordinary case — the card shows a neutral name rather than
 * inventing one from a user agent string. There is no field here for a device
 * model, a browser or an operating system, and there must not be: a device
 * fingerprint is not made acceptable by being displayed as a convenience.
 */
export interface PortalPasskey {
  readonly id: string;
  readonly label: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

/** What an options call hands back. `options` goes straight to the browser, unread. */
interface PortalPasskeyChallenge {
  readonly challengeId: string;
  readonly options: Record<string, unknown>;
}

/**
 * CAN THIS BROWSER DO PASSKEYS AT ALL.
 *
 * Checked before either control is RENDERED, not before it is clicked. A
 * "sign in with a passkey" button that explains itself only after being pressed
 * is worse than no button on a page a worried person came to for reassurance —
 * and older browsers are over-represented among the patients this page is for.
 */
export function passkeysAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

export async function fetchPasskeys(): Promise<readonly PortalPasskey[]> {
  if (PORTAL_FIXTURES) return (await fixtures()).fixturePasskeys();
  return request<readonly PortalPasskey[]>('/portal/passkeys');
}

/**
 * ADD A PASSKEY — options, the browser ceremony, then verify.
 *
 * THE WHOLE CEREMONY LIVES HERE RATHER THAN IN THE CARD, so the card stays a
 * screen: it has one async call to await and one error to show. It also means
 * the two round trips and the `navigator.credentials` call cannot drift apart
 * across surfaces, because there is one copy of the sequence.
 *
 * ONLY REACHABLE WITH A LIVE SESSION. The server refuses both halves without
 * one (`passkey_registration_requires_a_bootstrapped_session`) — this is not
 * the enforcement, it is the screen agreeing with it.
 *
 * NOTHING IS PERSISTED IN THE BROWSER. No storage API is touched here and no
 * response is logged. The credential itself lives in the phone's own secure
 * store, which is the platform's, not ours.
 */
export async function registerPasskey(label?: string): Promise<PortalPasskey> {
  if (PORTAL_FIXTURES) return (await fixtures()).addFixturePasskey(label);

  const { startRegistration } = await import('@simplewebauthn/browser');
  const challenge = await request<PortalPasskeyChallenge>('/portal/passkeys/registration/options', {
    method: 'POST',
  });

  // The browser asks for the patient's face, fingerprint or PIN here.
  const response = await startRegistration({ optionsJSON: challenge.options as never });

  const result = await request<{ registered: true; passkey: PortalPasskey }>(
    '/portal/passkeys/registration/verify',
    {
      method: 'POST',
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        response,
        ...(label && label.trim().length > 0 ? { label: label.trim() } : {}),
      }),
    },
  );
  return result.passkey;
}

/**
 * SIGN IN WITH A PASSKEY — no username, no identifier, nothing typed.
 *
 * The options carry no credential list, so this call cannot be used to ask
 * whether somebody has an account here; the patient's own device offers the
 * right credential and the signature says who they are. On success the server
 * sets the session cookie and the page re-reads its session — there is nothing
 * for this function to return.
 */
export async function signInWithPasskey(): Promise<void> {
  if (PORTAL_FIXTURES) {
    (await fixtures()).openFixtureSession();
    return;
  }

  const { startAuthentication } = await import('@simplewebauthn/browser');
  const challenge = await request<PortalPasskeyChallenge>('/portal/passkeys/authentication/options', {
    method: 'POST',
  });

  const response = await startAuthentication({ optionsJSON: challenge.options as never });

  await request<{ signedIn: true }>('/portal/passkeys/authentication/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId: challenge.challengeId, response }),
  });
}

/**
 * REMOVE ONE. REMOVING THE LAST IS ALLOWED (REQ-PORT-08) and the server says so
 * in `noPasskeysRemain` — the card uses that to warn BEFORE the patient
 * confirms, never to refuse. The portal is never a precondition of anything,
 * and somebody wiping a phone they are selling should not be made to keep a
 * credential in order to be permitted to remove the others.
 */
export async function revokePasskey(passkeyId: string): Promise<void> {
  if (PORTAL_FIXTURES) {
    (await fixtures()).removeFixturePasskey(passkeyId);
    return;
  }
  await request<void>(`/portal/passkeys/${encodeURIComponent(passkeyId)}/revoke`, { method: 'POST' });
}
