'use client';

/**
 * Who is signed in, WHICH PRACTICE they are from, and the way out. Shown in
 * the top bar of every console screen.
 *
 * WHY IT HAD TO EXIST. The practice screens showed a fixed label — "PRACTICE
 * ADMIN" — which looks like a session indicator and is not one. It says what
 * KIND of screen you are on, never who you are, and it says the same thing to
 * somebody signed in, somebody signed out, and somebody signed in as the wrong
 * person. There was also no way to sign out at all.
 *
 * That matters more here than in most products. Everything done in this
 * console is recorded against a name, and a screen that cannot tell you whose
 * name that is invites somebody to act while a colleague's session is open.
 *
 * IT NAMES THE PRACTICE, not just the person, because "admin.821709fb" answers
 * neither question anybody actually has. A platform operator moves between
 * practices all day and a practice user must never be in the wrong one, so the
 * affiliation is the load-bearing half: whether you are acting as AoBPlatform
 * or as Riverview Family Practice changes what every button on the page means.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, LogIn, LogOut, Building2, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  beginLogin,
  currentSession,
  signOut as endSession,
  refreshFailureReason,
  restoreRefusalReason,
  sessionIdleMinutes,
  silentRestoreInFlight,
  type Session,
} from './auth';
import { strings } from './strings';
import { ui } from './ui';
import { apiHeaders } from './auth';

/** How often the bar re-checks a session that self-expires silently — not a
 *  reload, just a re-read of the in-memory value (auth.ts). */
const LIVE_CHECK_MS = 30_000;

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export function SessionControl({
  audience,
  clientId,
}: {
  /** What kind of screen this is — shown when nobody is signed in. */
  audience: string;
  /** Which Keycloak client to sign in against. The console and the practice
   *  portal are separate clients on purpose, so a practice token and a
   *  platform token are never interchangeable. */
  clientId?: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);
  const [practiceName, setPracticeName] = useState<string | null>(null);
  /*
   * "SIGNED IN, ONCE, THEN NOT" — DISTINCT FROM "NEVER SIGNED IN" (Carl, 7 Sep
   * 2026). A tab that never signed in shows a plain sign-in button; a tab that
   * DID and then expired shows the same button plus the amber note below, so
   * the person knows why it reappeared rather than wondering whether they were
   * ever signed in at all.
   */
  const [expired, setExpired] = useState(false);
  /** Keycloak's own error code for why the background refresh failed, when
   *  one is known — never a token value (`refreshFailureReason`, auth.ts). */
  const [expiredReason, setExpiredReason] = useState<string | null>(null);
  /*
   * A RELOAD IS NOT A SIGN-OUT (Carl, 7 Sep 2026). The token is memory-only by
   * design, so pressing the browser's reload starts this tab with no session
   * and a silent redirect then restores it from Keycloak's SSO session. For
   * that second the bar said "Sign in", which is not early — it is wrong.
   */
  const [restoring, setRestoring] = useState(false);
  /*
   * AND WHETHER A RESTORE WAS REFUSED (Carl, 7 Sep 2026). Different from
   * `expired`, which is a session that died in THIS tab under somebody: this is
   * a cold load whose silent restore Keycloak turned down because the SSO
   * session had idled out. Both end with no session; only one of them means
   * "your earlier sign-in has ended".
   */
  const [restoreRefused, setRestoreRefused] = useState(false);
  const wasSignedIn = useRef(false);

  const sync = useCallback(() => {
    const s = currentSession();
    if (s) {
      wasSignedIn.current = true;
      setExpired(false);
      setExpiredReason(null);
    } else if (wasSignedIn.current) {
      setExpired(true);
      // Guarded, not called bare: a test that mocks `./auth` without this
      // export must still render the plain "expired" note rather than throw.
      setExpiredReason(typeof refreshFailureReason === 'function' ? refreshFailureReason() : null);
    }
    /*
     * ONLY ABOUT A PAGE THAT HAS NEVER HELD A SESSION. A tab whose session
     * expired under somebody is a different fact and keeps its amber note —
     * promising them a restore that is not coming would be the old lie with a
     * friendlier face.
     */
    setRestoring(
      !s && !wasSignedIn.current && typeof silentRestoreInFlight === 'function'
        ? silentRestoreInFlight()
        : false,
    );
    setRestoreRefused(
      !s && typeof restoreRefusalReason === 'function' ? restoreRefusalReason() !== null : false,
    );
    setSession(s);
  }, []);

  // A deliberate sign-out (`SessionChangeReason` 'signed-out', auth.ts) is not
  // an expiry, wherever it was pressed — this bar must not say "your sign-in
  // has expired" about a session somebody ended on purpose.
  const onSessionEvent = useCallback(
    (e: Event) => {
      if ((e as CustomEvent<{ reason?: string }>).detail?.reason === 'signed-out') {
        wasSignedIn.current = false;
        setExpired(false);
        setExpiredReason(null);
        setRestoring(false);
        setRestoreRefused(false);
      }
      sync();
    },
    [sync],
  );

  useEffect(() => {
    sync();
    setChecked(true);
    // The self-expiry in `currentSession()` is lazy — nothing fires it on its
    // own — so this tab has to go looking. The interval is the backstop; the
    // event (auth.ts, `dispatchSessionChanged`) and visibility are the fast
    // paths for a refresh, a sign-in, or a tab regaining focus after being
    // throttled in the background.
    const interval = setInterval(sync, LIVE_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('aob:session-changed', onSessionEvent);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('aob:session-changed', onSessionEvent);
    };
  }, [sync, onSessionEvent]);

  /*
   * A FAST TICK, AND ONLY WHILE THE RESTORE IS OPEN. Thirty seconds is right
   * for a session that self-expires quietly; it is far too slow for a window
   * that closes in tens of milliseconds — the bar would go on saying "signing
   * you back in" long after the answer arrived. `sync` clears `restoring` the
   * moment the question is settled, which stops this interval as a side
   * effect: nothing polls once there is nothing left to wait for.
   */
  useEffect(() => {
    if (!restoring) return;
    const tick = setInterval(sync, 250);
    return () => clearInterval(tick);
  }, [restoring, sync]);

  /*
   * The practice's NAME, which the token does not carry — it carries the id,
   * and an id in a top bar tells nobody anything. Failing quietly is right
   * here: an unreachable name must not take out the sign-out button, which is
   * the one control somebody needs when something is wrong.
   */
  useEffect(() => {
    const practiceId = session?.practiceId;
    if (!practiceId) return;
    let live = true;
    fetch(`${CORE_URL}/practices/${practiceId}`, { headers: apiHeaders(practiceId) })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!live || !p) return;
        setPracticeName(p.tradingNames?.[0] ?? p.legalName ?? null);
      })
      .catch(() => {
        // Leave the fallback in place.
      });
    return () => {
      live = false;
    };
  }, [session?.practiceId]);

  // Ends the Keycloak session too. A local-only sign-out left the SSO session
  // live, so the next page load silently signed the person back in.
  const signOut = useCallback(() => {
    // A deliberate sign-out is not an expiry — the note is for a session that
    // ended without anybody choosing it.
    wasSignedIn.current = false;
    setExpired(false);
    setExpiredReason(null);
    setRestoreRefused(false);
    setSession(null);
    endSession();
  }, []);

  // Nothing until the in-memory session has been read, or the bar flickers
  // from "sign in" to "signed in as…" on every page load.
  if (!checked) return null;

  /*
   * THE RESTORE IS IN FLIGHT — say what is happening, and offer nothing.
   *
   * NO SIGN-IN BUTTON, deliberately: pressing it would start a SECOND,
   * interactive login on top of a silent one that is about to land, and ask
   * for a passkey nobody needed to give. NO EXPIRY NOTE either, and none is
   * possible — that note is for a session that lived in THIS tab and died, and
   * this tab has not had one yet.
   *
   * The spinner is the refresh button's own, so "something is happening" looks
   * the same everywhere in the top bar.
   */
  if (!session && restoring) {
    return (
      <span className={ui.sessionBar}>
        <span className={ui.sessionAudience}>{audience}</span>
        <span className={ui.sessionWho} data-testid="session-restoring">
          <RefreshCw size={13} aria-hidden="true" className={ui.spinning} />{' '}
          {strings.auth.signingBackIn}
        </span>
      </span>
    );
  }

  if (!session) {
    return (
      <span className={ui.sessionBar}>
        <span className={ui.sessionAudience}>{audience}</span>
        {expired && (
          <span className={ui.sessionStale} style={{ cursor: 'default' }} data-testid="session-expired-note">
            <AlertTriangle size={13} aria-hidden="true" />
            {expiredReason
              ? strings.auth.sessionExpiredNoteWithReason(expiredReason)
              : strings.auth.sessionExpiredNote}
          </span>
        )}
        {/*
          A RESTORE KEYCLOAK REFUSED. Shown INSTEAD of nothing, not instead of
          the expiry note above — the two cannot both be true, because `expired`
          is about a session this tab held and this is about a cold load that
          had none. The heading is the bar's share; the rule and the way back
          are the gate's, and the `title` carries them for a hover.
        */}
        {!expired && restoreRefused && (
          <span
            className={ui.sessionStale}
            style={{ cursor: 'default' }}
            title={strings.auth.restoreRefusedBody(sessionIdleMinutes())}
            data-testid="session-restore-refused-note"
          >
            <AlertTriangle size={13} aria-hidden="true" />
            {strings.auth.restoreRefusedHeading}
          </span>
        )}
        <button
          type="button"
          className={ui.sessionButton}
          onClick={() => void beginLogin(clientId)}
          data-testid="session-sign-in"
        >
          <LogIn size={13} aria-hidden="true" />
          {strings.auth.signIn}
        </button>
      </span>
    );
  }

  /*
   * A TOKEN CARRYING NO ROLES AT ALL is not somebody with no permissions — it
   * is a token of the wrong shape, and the two are indistinguishable from the
   * inside. Every role-gated control simply vanishes, which reads as "you are
   * not allowed" rather than "your session is stale".
   *
   * It happens for a real reason: the realm's `roles` client scope was not a
   * default, so tokens minted before that was fixed carry no `realm_access`.
   * They keep refreshing silently and never regain it — the only cure is
   * signing in again, and nothing was telling anybody that.
   *
   * Everybody has at least `default-roles-<realm>`, so an empty list is always
   * the broken case and never a legitimate one.
   */
  const rolesMissing = (session.roles ?? []).length === 0;

  // A practice claim beats a platform role — the same rule landingPath() uses.
  // Somebody scoped to a practice is acting AS that practice, whatever else
  // they may also hold.
  const scopedToPractice = Boolean(session.practiceId);
  const affiliation = scopedToPractice
    ? (practiceName ?? strings.auth.practiceLoading)
    : strings.auth.platformUser;

  return (
    <span className={ui.sessionBar}>
      {rolesMissing && (
        <button
          type="button"
          className={ui.sessionStale}
          onClick={signOut}
          title={strings.auth.staleTokenHint}
          data-testid="session-stale"
        >
          <AlertTriangle size={13} aria-hidden="true" />
          {strings.auth.staleToken}
        </button>
      )}
      {scopedToPractice ? (
        <Building2 size={14} aria-hidden="true" className={ui.sessionIcon} />
      ) : (
        <ShieldCheck size={14} aria-hidden="true" className={ui.sessionIcon} />
      )}
      <span className={ui.sessionIdentity}>
        <span className={ui.sessionAffiliation} title={session.practiceId ?? strings.auth.platformUser}>
          {affiliation}
        </span>
        <span className={ui.sessionSeparator} aria-hidden="true">
          ·
        </span>
        <span className={ui.sessionWho} title={session.username}>
          {session.username ?? audience}
        </span>
      </span>
      <button type="button" className={ui.sessionButton} onClick={signOut} data-testid="session-sign-out">
        <LogOut size={13} aria-hidden="true" />
        {strings.auth.signOut}
      </button>
    </span>
  );
}
