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
const CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? 'web';

const VERIFIER_KEY = 'aob.pkce.verifier';
const STATE_KEY = 'aob.pkce.state';

export interface Session {
  accessToken: string;
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
export async function beginLogin(): Promise<void> {
  const verifier = randomString();
  const state = randomString();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid profile',
    redirect_uri: redirectUri(),
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  });
  window.location.assign(`${ISSUER}/protocol/openid-connect/auth?${params.toString()}`);
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

  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as { access_token: string; expires_in: number };
  const claims = decodeClaims(body.access_token);
  session = {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    username: claims.preferred_username as string | undefined,
    practiceId: claims.practice_id as string | undefined,
    roles: ((claims.realm_access as { roles?: string[] } | undefined)?.roles ?? []) as string[],
  };
  return session;
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
