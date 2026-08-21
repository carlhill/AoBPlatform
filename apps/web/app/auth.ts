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
