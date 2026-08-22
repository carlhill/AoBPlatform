'use client';

/*
 * THE DIRECTIVE IS LOAD-BEARING. This module holds the access token in a
 * module-level variable, and seven client components across different route
 * segments import it. Without an explicit client boundary, Next is free to
 * place it in more than one chunk — and then the session written by the
 * callback is simply not the session the sign-in gate reads.
 *
 * The symptom was: "signed in as carl@hillsempire.com" flashes, the browser
 * moves on, and the gate asks again. The token exchange had succeeded every
 * time; it was being written into a different copy of this module.
 */

import { safeReturnPath } from '@aobplatform/domain';

/**
 * OIDC authorization-code + PKCE against the aobplatform realm.
 *
 * The `web` client is bound to the **clinician-browser** flow, where a
 * WebAuthn passkey is REQUIRED with no password or OTP fallback (rule 15 /
 * REQ-VAULT-04). That is enforced by Keycloak, not by this file — this file
 * cannot weaken it, and no code path here collects a password.
 *
 * Tokens are held in memory only. Not localStorage: an access token for
 * practice data should not outlive the tab or sit where any script can read
 * it. A reload means a fresh redirect, which is silent when the Keycloak
 * session is live.
 */
const ISSUER = process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? 'http://localhost:21024/realms/aobplatform';
/**
 * The default client: the practice console and portal.
 *
 * The REVIEWER signs in against a different one. That separation is the whole
 * reason two clients exist — a practice-admin token and a platform-admin token
 * must not be interchangeable at the API — so the client id travels with the
 * login rather than being a module-level constant that silently applies to
 * both.
 */
const CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? 'web';
const CLIENT_KEY = 'aob.pkce.client';
const RETURN_KEY = 'aob.pkce.return';

const VERIFIER_KEY = 'aob.pkce.verifier';
const STATE_KEY = 'aob.pkce.state';

export interface Session {
  accessToken: string;
  /** Identity assertion, used only as `id_token_hint` at logout. */
  idToken?: string;
  expiresAt: number;
  username?: string;
  practiceId?: string;
  roles: string[];
}

let session: Session | null = null;

export function currentSession(): Session | null {
  if (session && session.expiresAt <= Date.now()) session = null;
  return session;
}

export function clearSession(): void {
  session = null;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function redirectUri(): string {
  return `${window.location.origin}/callback`;
}

/** Sends the browser to Keycloak. The passkey ceremony happens there. */
export async function beginLogin(clientId: string = CLIENT_ID): Promise<void> {
  const verifier = randomString();
  const state = randomString();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  // Remembered for the token exchange: an authorization code is bound to the
  // client that requested it, and exchanging it under a different one fails
  // with an error that says nothing useful about why.
  sessionStorage.setItem(CLIENT_KEY, clientId);
  // Where to come back to. Sign-in used to land everyone on the console root
  // regardless of where they started, so a reviewer opening a dossier link
  // signed in and then had to find the application again.
  sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid profile',
    redirect_uri: redirectUri(),
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  });
  window.location.assign(`${ISSUER}/protocol/openid-connect/auth?${params.toString()}`);
}

/**
 * A hint that this browser has signed in before. NOT a credential.
 *
 * It holds no token and grants nothing — it exists so a cold page load knows
 * whether a silent restore is worth attempting. Getting it wrong costs one
 * redirect, in either direction.
 */
const SEEN_KEY = 'aob.hasSignedIn';
const SILENT_TRIED_KEY = 'aob.silentTried';

export function rememberSignedIn(clientId: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, clientId);
  } catch {
    // Private browsing. The cost is a visible sign-in instead of a silent one.
  }
}

export function hasSignedInBefore(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Restore a session WITHOUT asking the person for anything.
 *
 * WHY THIS HAD TO EXIST, and it is not merely a convenience. The access token
 * is held in a module-level variable and deliberately nowhere else, so a full
 * page load destroys it. `auth.ts` has claimed since it was written that "a
 * reload means a fresh redirect, which is silent when the Keycloak session is
 * live" — and that redirect was never implemented.
 *
 * The consequence was worse than the annoyance of signing in again. With no
 * session, nothing scopes a practice screen: `mayChoosePractice` has no claim
 * to read, the page falls back to a stored selection, and a practice user who
 * navigated straight to /practice/locations was offered a list of every
 * practice on the platform. A missing session became a disclosure.
 *
 * `prompt=none` asks Keycloak to answer from its EXISTING SSO session or not at
 * all. If the session is live the browser comes straight back with a code and
 * nobody is asked for a passkey; if it is not, Keycloak returns
 * `login_required` and the gate does its normal job.
 *
 * ONE ATTEMPT PER PAGE LOAD, tracked in sessionStorage. Without that, a
 * `login_required` answer would send us round the same loop for ever.
 */
export async function attemptSilentLogin(clientId: string = CLIENT_ID): Promise<boolean> {
  if (currentSession()) return false;
  // NOT gated on the hint. The hint is only written by a NEW sign-in, so
  // gating on it means anybody already signed in when it shipped keeps getting
  // the chooser — which was the whole bug. A browser that has never signed in
  // pays one fast redirect and gets `login_required`, once per page load.
  if (sessionStorage.getItem(SILENT_TRIED_KEY) === 'true') return false;

  sessionStorage.setItem(SILENT_TRIED_KEY, 'true');

  const verifier = randomString();
  const state = randomString();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(CLIENT_KEY, clientId);
  sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid profile',
    redirect_uri: redirectUri(),
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    // The whole point: answer from the existing session, or refuse.
    prompt: 'none',
  });
  window.location.assign(`${ISSUER}/protocol/openid-connect/auth?${params.toString()}`);
  return true;
}

/**
 * Sign out — OF KEYCLOAK, not just of this tab.
 *
 * THE LOCAL-ONLY VERSION WAS A LIE, and the bug it caused was worse than the
 * lie. Clearing the in-memory token left Keycloak's SSO session untouched, so
 * the very next page load restored it silently and the person was signed
 * straight back in. A "Sign out" button that signs you back in is not a
 * cosmetic problem on a platform whose whole claim is knowing who did what:
 * somebody hands the laptop over believing they have left.
 *
 * IT ALSO CLEARS THE ONE-ATTEMPT-PER-TAB MARKER, and leaving that behind is
 * what made /practice render blank forever. `attemptSilentLogin` refuses a
 * second try in the same tab — correctly, or a `login_required` answer would
 * loop. But signing out inside that tab left the marker set with no session:
 * the page waited for a restore that would never be attempted, and showed
 * nothing at all. Not an error, not a sign-in prompt. Nothing.
 *
 * `post.logout.redirect.uris` is "+" on both clients, meaning it inherits the
 * registered redirect URIs — so the origin is already allowed and no realm
 * change is needed here.
 */
export function signOut(): void {
  const clientId = sessionStorage.getItem(CLIENT_KEY) ?? hasSignedInBefore() ?? CLIENT_ID;
  // Read BEFORE clearing — clearSession() is what drops it.
  const idToken = currentSession()?.idToken;
  clearSession();
  try {
    window.localStorage.removeItem(SEEN_KEY);
    window.sessionStorage.removeItem(SILENT_TRIED_KEY);
  } catch {
    // Private browsing — the session is already gone from memory, which is the
    // part that matters.
  }
  const params = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: `${window.location.origin}/`,
  });
  /*
   * WITHOUT THIS, KEYCLOAK ASKS. It cannot tell which session a bare logout
   * request refers to, so it renders a confirmation page — one button reading
   * "Logout", and no way to change your mind. The hint identifies the session,
   * so the logout is unambiguous and happens directly.
   *
   * A session restored from an older page load may not carry one. Logging out
   * via the prompt is still correct, just clumsier, and is better than not
   * offering to log out at all.
   */
  if (idToken) params.set('id_token_hint', idToken);
  window.location.assign(`${ISSUER}/protocol/openid-connect/logout?${params.toString()}`);
}

/** Called by the callback when Keycloak answers `login_required`. */
export function silentLoginFailed(): void {
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Completes the code exchange on /callback. */
export async function completeLogin(code: string, state: string): Promise<Session> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  if (!verifier) throw new Error('No PKCE verifier for this login attempt — start again.');
  // CSRF: a code arriving with the wrong state is not ours.
  if (!expectedState || state !== expectedState) throw new Error('State mismatch — this login response is not ours.');

  const clientId = sessionStorage.getItem(CLIENT_KEY) ?? CLIENT_ID;
  sessionStorage.removeItem(CLIENT_KEY);

  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as { access_token: string; expires_in: number; id_token?: string };
  const claims = decodeClaims(body.access_token);
  session = {
    accessToken: body.access_token,
    /*
     * KEPT SOLELY TO PROVE WHICH SESSION IS ENDING. Without it Keycloak cannot
     * tell which session a logout refers to, so it stops and asks — a page
     * headed "Logging out / Do you want to log out?" with a single button and
     * no way to say no. Passing it as `id_token_hint` makes the logout
     * unambiguous and it happens directly.
     *
     * This is an identity assertion, not an access credential: it authorises
     * nothing, and like the access token it is held in memory only.
     */
    idToken: body.id_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    username: claims.preferred_username as string | undefined,
    practiceId: claims.practice_id as string | undefined,
    roles: ((claims.realm_access as { roles?: string[] } | undefined)?.roles ?? []) as string[],
  };
  // Remember that this browser has a live Keycloak session, so the NEXT cold
  // page load can restore silently instead of falling back to a chooser.
  rememberSignedIn(clientId);
  return session;
}

/**
 * Where to send the browser after a successful exchange.
 *
 * The RULE lives in the domain and has tests, because it is a security control
 * rather than a convenience: a stored destination followed without validation
 * is an open redirect, and a rule with tests does not get quietly relaxed by
 * somebody adding a feature. This only reads it out of storage and consumes it.
 */
export function returnPath(): string {
  const stored = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  return safeReturnPath(stored);
}

/**
 * Reads claims for DISPLAY ONLY. The browser never trusts these for access
 * decisions — the server verifies the signature on every call.
 */
function decodeClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

/** Headers for a core API call: bearer when signed in, dev practice header otherwise. */
export function apiHeaders(practiceId?: string): Record<string, string> {
  const active = currentSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (active) headers.Authorization = `Bearer ${active.accessToken}`;
  const scope = active?.practiceId ?? practiceId;
  if (scope) headers['x-practice-id'] = scope;
  return headers;
}
