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
  practitionerId?: string;
  consoleRole?: string;
  roles: string[];
  /**
   * Kept SOLELY to renew the access token before it expires — never sent to
   * any endpoint but Keycloak's own token endpoint, and like everything else
   * here, memory-only. Absent for a session this build's flow did not obtain
   * one for; the keep-alive below is a no-op in that case, not an error.
   */
  refreshToken?: string;
  /** Which client the token belongs to, so a refresh asks the same one. */
  clientId: string;
}

let session: Session | null = null;

/*
 * THE ONE SIGNAL EVERY UI THAT SHOWS "SIGNED IN" LISTENS FOR (Carl, 7 Sep
 * 2026). `currentSession()` self-expires silently — nothing about reading it
 * announces that the answer just changed. `SessionControl` and `AuthGate`
 * used to read it once, on mount, which is why a console tab left open kept
 * saying "signed in as…" long after the token was gone. Dispatched at every
 * point `session` actually changes: a successful sign-in, a successful
 * refresh, a failed refresh (via `clearSession`), an explicit sign-out (same),
 * and the lazy self-expiry below.
 *
 * THE REASON RIDES ALONG, and it is not decoration. `AuthGate` answers a
 * session that has gone null by leaving the page's content mounted under a
 * "sign in again" card — deliberately, so nothing somebody was doing is
 * thrown away. That is exactly wrong for `'signed-out'`: somebody who pressed
 * Sign Out on a shared machine, believing they had left, must not have the
 * practice's own data sitting on screen under a banner. Only a reason of
 * `'expired'` or `'refresh-failed'` — the session dying on its own, unasked —
 * earns the non-blocking treatment.
 */
export type SessionChangeReason = 'signed-in' | 'refreshed' | 'expired' | 'refresh-failed' | 'signed-out';

function dispatchSessionChanged(reason: SessionChangeReason): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<{ reason: SessionChangeReason }>('aob:session-changed', { detail: { reason } }));
  }
}

/*
 * WHY THE FIRST REFRESH FAILED, so the bar can say something more useful than
 * "your sign-in has expired" when there is a real reason on hand — Keycloak's
 * own `error` code (`invalid_grant`, `invalid_client`…), never a token value.
 * `null` means either nothing has failed yet, or the last thing to happen was
 * a SUCCESSFUL refresh or an explicit sign-out — both of which clear it below.
 */
let lastRefreshFailure: string | null = null;

/**
 * WHY A SILENT RESTORE WAS REFUSED, when it was and when this browser had a
 * sign-in to lose (Carl, 7 Sep 2026).
 *
 * IT IS NOT THE SAME FACT AS "NOT SIGNED IN", and the difference is the whole
 * reason it exists. The gate's ordinary copy — "you are not signed in, this
 * page shows real records" — is written for somebody who has never been here.
 * Carl HAD been, minutes earlier; Keycloak's SSO session had simply idled out.
 * Telling him he was not signed in described the state and hid the cause, and
 * left him with no idea why it kept happening.
 *
 * SET ONLY WHERE BOTH HALVES ARE KNOWN. `silentLoginFailed` reads the
 * "this browser has signed in here" hint BEFORE clearing it, so a browser that
 * genuinely has never signed in keeps the generic copy and this stays null.
 *
 * IT HOLDS AN OIDC ERROR CODE AND NOTHING ELSE — never a token, never a
 * username.
 */
let lastRestoreRefusal: string | null = null;

/** The OIDC reason the last silent restore was refused, for a browser that had
 *  signed in here. `null` otherwise, and null again after any sign-in. */
export function restoreRefusalReason(): string | null {
  return lastRestoreRefusal;
}

/**
 * HOW LONG A SIGN-IN SURVIVES WITHOUT ACTIVITY, in minutes, so the copy can say
 * it instead of leaving somebody to guess.
 *
 * IT IS THE REALM'S NUMBER, NOT OURS. Keycloak enforces the idle timeout and
 * this only reports it, so it is read from the environment rather than typed
 * into a sentence — a hardcoded "30 minutes" beside a realm set to 240 is a
 * confident lie, and the realm is the thing that moves.
 *
 * READ STATICALLY, for the reason `session.ts` gives about every
 * `NEXT_PUBLIC_*` value: Next substitutes the member expression at build time
 * and a dynamic lookup silently yields `undefined`.
 */
export function sessionIdleMinutes(): number {
  const raw = process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES;
  const minutes = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
}

/** The reason the most recent refresh attempt failed, if the last thing that
 *  happened to this session was a failure. Read by `SessionControl` to add
 *  detail to the plain "sign-in has expired" note. */
export function refreshFailureReason(): string | null {
  return lastRefreshFailure;
}

function devWarn(...args: unknown[]): void {
  // No token values ever reach this — every call site below passes only a
  // status code and a short error code, never a header or a body in full.
  if (process.env.NODE_ENV !== 'production') console.warn('[auth]', ...args);
}

/*
 * THE LOGOUT HINT OUTLIVES THE ACCESS TOKEN, and it has to.
 *
 * Dropping the whole session the moment the access token expired also threw
 * away the id_token — so pressing Sign out in that window produced a logout
 * with no `id_token_hint`, Keycloak could not tell which session was ending,
 * and it fell back to the "Do you want to log out?" page. The person is still
 * signed in as far as Keycloak is concerned; we had simply forgotten which
 * session to name.
 *
 * An expired access token means "you cannot call APIs any more". It does not
 * mean "we no longer know who was here". Keeping the assertion is safe by the
 * same reasoning that makes it safe to hold at all: it authorises nothing, and
 * it is still memory-only.
 */
let lastIdToken: string | undefined;

export function currentSession(): Session | null {
  if (session && session.expiresAt <= Date.now()) {
    lastIdToken = session.idToken ?? lastIdToken;
    session = null;
    stopRefresh();
    dispatchSessionChanged('expired');
  }
  return session;
}

/** The assertion to name at logout, whether or not the session is still live. */
export function logoutHint(): string | undefined {
  return currentSession()?.idToken ?? lastIdToken;
}

/**
 * `reason` defaults to `'signed-out'` — the caller for whom that is wrong
 * (the failed-refresh path below) says so explicitly. `AuthGate` treats that
 * default as "leaving on purpose" and hides whatever the page was showing,
 * rather than the non-blocking card it offers for a session that died on its
 * own.
 */
export function clearSession(reason: SessionChangeReason = 'signed-out'): void {
  session = null;
  // Cleared HERE and not on expiry: this is somebody actually leaving, so
  // there is no logout still to perform and nothing left to name.
  lastIdToken = undefined;
  /*
   * AND THE "SIGNING YOU BACK IN" WINDOW CLOSES WITH IT. A session ending is
   * the end of one episode, not the start of another: nothing is being
   * restored, and a stale open window would let the next cold render inherit a
   * countdown that began under a different session.
   *
   * IT DOES NOT MAKE AN EXPIRY LOOK LIKE A RELOAD. `SessionControl` and
   * `AuthGate` only ask `silentRestoreInFlight()` about a page that has NOT
   * held a session in this mount, so a tab whose session expired under
   * somebody still gets the amber note rather than a promise.
   */
  restoreWindowOpenedAt = null;
  /*
   * AND A DELIBERATE SIGN-OUT SETTLES THE QUESTION FOR GOOD. Somebody chose to
   * leave: nothing is being restored, and a gate that showed nothing while it
   * waited for a restore would leave the practice's own screen up behind it on
   * a machine whose user believes they have gone. An EXPIRY does not settle it
   * — that is a different fact, and the components tell the two apart by
   * whether the page ever held a session.
   */
  if (reason === 'signed-out') {
    silentRestoreSettled = true;
    // Somebody chose to leave. "Your earlier sign-in has ended" would be true
    // and patronising; the ordinary gate is right.
    lastRestoreRefusal = null;
  }
  stopRefresh();
  dispatchSessionChanged(reason);
}

/*
 * KEEPING THE SESSION ALIVE, so `currentSession()` almost never has to say no.
 *
 * WHY THIS HAD TO EXIST. `currentSession()` self-expires: once `expiresAt`
 * passes, it silently clears itself and returns null. Nothing was refreshing
 * it, and nothing was telling the person it had happened. The TOP BAR does not
 * re-poll, so it went on showing "signed in" long after every write had
 * quietly stopped carrying an Authorization header at all — and under
 * AUTH_ENFORCE=false the server does not refuse an anonymous request, it just
 * proceeds without an actor. A save that needed attribution then failed with
 * a business-logic error ("must name the person making it") that had nothing
 * to do with the real problem: the session was gone and nobody had been told.
 *
 * A HIDDEN-IFRAME `prompt=none` REDIRECT WOULD ALSO HAVE WORKED, and is the
 * more common SPA pattern — but it means round-tripping through Keycloak's
 * `/auth` endpoint on a timer, which is heavier and has its own failure modes
 * (third-party-cookie blocking breaks a same-site-adjacent iframe in some
 * browsers). Keycloak already returns a `refresh_token` for this client's
 * standard flow; refreshing directly against the token endpoint is one POST,
 * no navigation, no iframe, and it either works or it does not — there is
 * nothing to silently fail inside a hidden frame nobody is watching.
 *
 * PROACTIVE, a minute before expiry, not reactive on 401. Waiting to be told
 * the token is dead means the FIRST request after expiry always fails and has
 * to be retried — which is invisible for a GET a component re-fetches anyway,
 * and is exactly the kind of write this bug was found on: one press, one
 * chance, gone before anybody could retry it.
 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function stopRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function scheduleRefresh(): void {
  stopRefresh();
  if (!session?.refreshToken) return;

  // A minute of margin, and never less than 15s from now — a token issued
  // with an unusually short lifetime must not turn this into a tight loop.
  const delay = Math.max(15_000, session.expiresAt - Date.now() - 60_000);
  refreshTimer = setTimeout(() => void performRefresh(), delay);
}

async function performRefresh(): Promise<void> {
  const current = session;
  if (!current?.refreshToken) return;

  try {
    const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: current.clientId,
        refresh_token: current.refreshToken,
      }),
    });

    if (!res.ok) {
      /*
       * THE REFRESH TOKEN ITSELF IS DEAD — the SSO session ended, or somebody
       * signed out elsewhere. Nothing to retry: clearing here is what makes
       * `currentSession()` and the top bar agree with reality immediately,
       * rather than both going on claiming a session that Keycloak has
       * already forgotten.
       */
      const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
      lastRefreshFailure = body.error ?? String(res.status);
      devWarn('refresh failed', res.status, body.error);
      clearSession('refresh-failed');
      return;
    }

    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
      id_token?: string;
      refresh_token?: string;
    };
    const claims = decodeClaims(body.access_token);

    // Still the same session the caller started with, refreshed in place —
    // an id captured elsewhere while this was in flight stays valid.
    session = {
      ...current,
      accessToken: body.access_token,
      idToken: body.id_token ?? current.idToken,
      expiresAt: Date.now() + body.expires_in * 1000,
      practiceId: claims.practice_id as string | undefined,
      practitionerId: claims.practitioner_id as string | undefined,
      consoleRole: claims.console_role as string | undefined,
      roles: ((claims.realm_access as { roles?: string[] } | undefined)?.roles ?? []) as string[],
      // Rotated if Keycloak rotates refresh tokens for this realm; kept
      // otherwise, so a realm without rotation does not lose the ability to
      // refresh again next time.
      refreshToken: body.refresh_token ?? current.refreshToken,
    };
    lastIdToken = body.id_token ?? lastIdToken;
    lastRefreshFailure = null;
    dispatchSessionChanged('refreshed');
    scheduleRefresh();
  } catch (e) {
    /*
     * A NETWORK BLIP, not a dead session. Retrying immediately would hammer a
     * connection that is already struggling; the existing timer's own next
     * firing (or the tab regaining focus, below) tries again soon enough, and
     * the lazy expiry check in `currentSession()` is still the backstop if
     * every attempt keeps failing until the token genuinely lapses.
     *
     * NOT recorded as `lastRefreshFailure` and no event fired: the session is
     * still live as far as anybody can tell, so surfacing this in the bar
     * would say "expired" about a session that has not, in fact, expired.
     * Logged in development only, and only the error's own message — never a
     * token or a header.
     */
    devWarn('refresh attempt failed (network)', e instanceof Error ? e.message : e);
  }
}

/*
 * BROWSERS THROTTLE `setTimeout` IN BACKGROUND TABS, sometimes past the point
 * a scheduled refresh should have fired. A tab left open and unfocused for an
 * hour must not come back to a session that quietly died while nobody was
 * looking — so returning focus is a second trigger, not only the timer.
 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !session?.refreshToken) return;
    if (session.expiresAt - Date.now() < 90_000) void performRefresh();
  });
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
  /*
   * A LIVE SSO SESSION EXISTS AGAIN, so the question a future cold render asks
   * — "is a silent restore coming?" — is open once more. Anything that settled
   * it earlier (a deliberate sign-out, a `login_required`, a restore that never
   * landed) was settled about a state that has just been replaced.
   */
  silentRestoreSettled = false;
  restoreWindowOpenedAt = null;
  lastRestoreRefusal = null;
  try {
    window.localStorage.setItem(SEEN_KEY, clientId);
    /*
     * AND THE TAB MAY TRY AGAIN ON ITS NEXT LOAD (Carl, 7 Sep 2026).
     *
     * THE BUG THIS FIXES, in his own sequence: reload, the restore is refused
     * because Keycloak's SSO session had idled out, the "already tried" marker
     * stays set for the life of the TAB — it is sessionStorage, which survives
     * reloads — and he then signs in with his passkey. The next reload found
     * the marker, settled the question without asking, and offered him a
     * sign-in prompt while Keycloak's session was live. The marker was
     * answering a question about a state that no longer existed.
     *
     * A SUCCESSFUL EXCHANGE IS EXACTLY WHEN IT STOPS BEING TRUE, whether the
     * exchange came from a passkey or from a silent redirect: either way there
     * IS a session now, and the next cold load deserves its one attempt at
     * restoring it.
     *
     * THE LOOP GUARD IS UNTOUCHED. `attemptSilentLogin` still sets the marker
     * before it redirects and still refuses a second attempt in the same
     * document; this clears it from the CALLBACK's document, which is a
     * different page load and makes no second attempt of its own.
     */
    window.sessionStorage.removeItem(SILENT_TRIED_KEY);
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
 * WHEN WE FIRST STARTED SAYING "SIGNING YOU BACK IN", and why the window opens
 * then rather than at module load.
 *
 * A cold load has no session by construction — the access token lives in a
 * module variable and nowhere else — so for the first moments of every reload
 * "not signed in" and "about to be signed back in" look identical from the
 * inside. What separates them is TIME: a live SSO session answers `prompt=none`
 * in tens of milliseconds, and one that does not answer is not coming.
 *
 * The clock therefore starts when the question is first ASKED — the first paint
 * of the top bar — which is the moment from which somebody is actually looking
 * at the claim. Anchoring it to module load would spend part of the budget on
 * whatever happened before the page rendered, and would make the window
 * unmeasurable from a test that fakes the clock after importing this module.
 */
let restoreWindowOpenedAt: number | null = null;

/**
 * HAS THE QUESTION BEEN ANSWERED IN THIS DOCUMENT? Set on every path that
 * decides no silent restore is happening — including the paths that decide it
 * before trying — so the interim below cannot outlive the fact.
 */
let silentRestoreSettled = false;

function settleSilentRestore(): void {
  silentRestoreSettled = true;
}

/**
 * IS A SILENT RESTORE EXPECTED OR RUNNING RIGHT NOW? (Carl, 7 Sep 2026.)
 *
 * THE FAULT IT FIXES. Pressing the browser's reload on a console page starts
 * the tab signed out — deliberately, the token is memory-only — and a redirect
 * then restores it from Keycloak's SSO session without asking for anything.
 * For that second the top bar offered "Sign in" and the gate said "sign in
 * again", with no expiry note. Both were WRONG rather than merely early:
 * nobody had been signed out, and the honest thing to say is that we are
 * putting it back.
 *
 * IT IS A PREDICTION, AND IT IS BOUNDED THREE WAYS, because a hopeful
 * "signing you back in…" that never resolves is a worse lie than the one it
 * replaces. It is false the moment a session exists; false as soon as anything
 * settles the question (`attemptSilentLogin` returning false, Keycloak
 * answering `login_required`, a deliberate sign-out); and false once the same
 * grace period `attemptSilentLogin` already trusts has elapsed, so a page that
 * never attempts a restore falls through to the ordinary signed-out state on
 * its own.
 *
 * `hasSignedInBefore()` IS THE PRECONDITION, and it is a hint rather than a
 * credential: it holds no token and grants nothing, it is written only by a
 * real sign-in, and `silentLoginFailed()` clears it the moment Keycloak says
 * there is no session to restore. A browser that has never signed in here
 * never sees this state.
 */
export function silentRestoreInFlight(): boolean {
  if (typeof window === 'undefined') return false;
  if (currentSession()) {
    restoreWindowOpenedAt = null;
    return false;
  }
  if (silentRestoreSettled) return false;
  if (!hasSignedInBefore()) {
    restoreWindowOpenedAt = null;
    return false;
  }
  if (restoreWindowOpenedAt === null) restoreWindowOpenedAt = Date.now();
  return Date.now() - restoreWindowOpenedAt < SILENT_REDIRECT_GRACE_MS;
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
 *
 * AND THE MARKER IS CLEARED BY A SUCCESSFUL EXCHANGE, not only by signing out
 * (`rememberSignedIn`). sessionStorage survives a reload, so a marker left
 * behind by one refused attempt used to outlive the very sign-in that made a
 * restore possible again — the tab then offered a sign-in prompt with a live
 * Keycloak session sitting behind it. One attempt per page LOAD is what this
 * guard is for; one attempt per tab, for ever, is what it had become.
 */
/**
 * How long to keep believing a silent-login redirect is on its way.
 *
 * Long enough that a redirect which IS coming is never pre-empted by a flash of
 * the sign-in prompt, short enough that a person facing a page which renders
 * nothing is not left reading it. A same-machine Keycloak answers in tens of
 * milliseconds.
 */
const SILENT_REDIRECT_GRACE_MS = 5000;

export async function attemptSilentLogin(clientId: string = CLIENT_ID): Promise<boolean> {
  if (currentSession()) {
    settleSilentRestore();
    return false;
  }
  // NOT gated on the hint. The hint is only written by a NEW sign-in, so
  // gating on it means anybody already signed in when it shipped keeps getting
  // the chooser — which was the whole bug. A browser that has never signed in
  // pays one fast redirect and gets `login_required`, once per page load.
  if (sessionStorage.getItem(SILENT_TRIED_KEY) === 'true') {
    // Already asked in this tab and not signed in, so nothing is coming: the
    // bar must say "Sign in" rather than go on promising a restore.
    settleSilentRestore();
    return false;
  }

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

  /*
   * A REDIRECT THAT NEVER LANDS MUST NOT STRAND THE CALLER.
   *
   * `assign` does not navigate synchronously, and it has no way to report that
   * the navigation never happened. Returning `true` unconditionally therefore
   * told every caller "stop waiting, you are about to be torn down" on the
   * strength of a request that may go nowhere. Both callers respond by
   * rendering NOTHING until the teardown arrives, so a redirect that does not
   * land is a permanently blank page — the exact failure the sign-out path
   * below was already fixed to prevent, reached by a different route.
   *
   * The reachable cause is an origin Keycloak does not know. The client
   * registers `localhost` only, so the same app opened on `127.0.0.1` asks for
   * a `redirect_uri` that is not registered, Keycloak refuses to come back,
   * and the browser simply stays where it is.
   *
   * So the claim is now bounded: if this page is still here after the grace
   * period, the navigation is not coming and `false` sends the caller down its
   * ordinary no-session path. When the redirect DOES land, this promise dies
   * with the document and nothing is painted.
   */
  return new Promise<boolean>((resolve) => {
    window.setTimeout(() => {
      // The navigation is not coming. Same moment, same reason, for the caller
      // and for the top bar.
      settleSilentRestore();
      resolve(false);
    }, SILENT_REDIRECT_GRACE_MS);
  });
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
  const idToken = logoutHint();
  clearSession();
  // A deliberate sign-out is not a refresh failure — do not let an old one
  // linger and show up beside the NEXT sign-in's expiry, on the next tab.
  lastRefreshFailure = null;
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

/**
 * Called by the callback when Keycloak answers `login_required`.
 *
 * THE HINT IS READ BEFORE IT IS CLEARED, and the order is the point. A browser
 * that HAD signed in here is being told its session ended; one that never had
 * is simply not signed in. The two get different copy, and after this function
 * has run there is no way to tell them apart — so the distinction is captured
 * on the way past.
 */
export function silentLoginFailed(reason = 'login_required'): void {
  // There is no SSO session to restore from — say so on screen immediately
  // rather than waiting out the grace period.
  settleSilentRestore();
  if (hasSignedInBefore()) lastRestoreRefusal = reason;
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Completes the code exchange on /callback. */
/*
 * ONE EXCHANGE PER CODE, and the guard lives here rather than in the callback
 * page so that every caller gets it.
 *
 * An authorization code is single-use: Keycloak answers the second attempt with
 * `invalid_grant / Code not valid`. That is correct of Keycloak and a disaster
 * on screen, because the person is by then SIGNED IN and looking at
 * "Sign-in failed".
 *
 * It happens for more reasons than one -- React re-running an effect in
 * development, somebody reloading the callback URL, a dev server restarting
 * mid-flow -- and they all end the same way. Rather than chase each, the
 * exchange is made idempotent: the same code returns the same promise, and a
 * code already spent returns the session it produced.
 */
const exchanges = new Map<string, Promise<Session>>();

export function completeLogin(code: string, state: string): Promise<Session> {
  const inFlight = exchanges.get(code);
  if (inFlight) return inFlight;

  const attempt = exchangeCode(code, state);
  exchanges.set(code, attempt);
  /*
   * A FAILED exchange is forgotten, so a genuine retry is still possible. Only
   * a success is worth remembering, and remembering it is what makes a second
   * call return a session instead of an error.
   */
  attempt.catch(() => exchanges.delete(code));
  return attempt;
}

async function exchangeCode(code: string, state: string): Promise<Session> {
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

  const body = (await res.json()) as {
    access_token: string;
    expires_in: number;
    id_token?: string;
    refresh_token?: string;
  };
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
    // A practitioner carries this INSTEAD of a practice claim: they work at
    // several practices, so there is no single one to name.
    practitionerId: claims.practitioner_id as string | undefined,
    consoleRole: claims.console_role as string | undefined,
    roles: ((claims.realm_access as { roles?: string[] } | undefined)?.roles ?? []) as string[],
    refreshToken: body.refresh_token,
    clientId,
  };  // Remembered separately, so a later expiry cannot take it with it.
  lastIdToken = body.id_token ?? lastIdToken;

  // Remember that this browser has a live Keycloak session, so the NEXT cold
  // page load can restore silently instead of falling back to a chooser.
  rememberSignedIn(clientId);
  // A fresh, successful sign-in — whatever the last refresh attempt said is
  // no longer the story.
  lastRefreshFailure = null;
  dispatchSessionChanged('signed-in');
  scheduleRefresh();
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
