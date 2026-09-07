'use client';

/**
 * The console sign-in gate.
 *
 * WHAT THIS IS, PRECISELY: a gate on the CONSOLE, not on the API. While the
 * core service runs with AUTH_ENFORCE=false it still accepts an
 * `x-practice-id` header from anyone who can reach it, so this component
 * stops a person browsing to the console — it does not stop a request. Saying
 * that on screen matters more than hiding it: a gate that looks stronger than
 * it is, is worse than no gate, because people plan around the appearance.
 *
 * The staging is deliberate and is documented on the core AuthGuard: the guard
 * exists before every surface has a login, and enforcing it early would lock
 * the console out of the very screens a practitioner uses to enrol the passkey
 * that the login requires. Order matters. Flipping AUTH_ENFORCE=true is a
 * release gate, and the button below is what proves the ceremony works first.
 *
 * There is no password path anywhere in this file, and there cannot be: the
 * `web` client is bound to a Keycloak flow where WebAuthn is REQUIRED with no
 * fallback (rule 15 / REQ-VAULT-04). This component could not collect a
 * password if it tried.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { beginLogin, clearSession, currentSession, silentRestoreInFlight, type Session } from './auth';
import { strings } from './strings';

/** How often this gate re-checks a session that self-expires silently. */
const LIVE_CHECK_MS = 30_000;

/**
 * The development escape hatch, OFF unless explicitly switched on at build
 * time. The local image sets it; any other build has no bypass at all.
 *
 * It exists because the passkey ceremony is unproven on real hardware — see
 * TESTING-GUIDE.md §6. Without it, a browser that cannot complete WebAuthn
 * locks you out of the console entirely, including the screens used to invite
 * a practitioner to enrol.
 */
const DEV_BYPASS_ALLOWED = process.env.NEXT_PUBLIC_DEV_UNAUTHENTICATED_CONSOLE === 'true';

const card: React.CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  margin: '1rem 0',
};
const AMBER = '#9a6700';
const RED = '#cf222e';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const [checked, setChecked] = useState(false);
  /*
   * WHETHER *THIS PAGE, THIS MOUNT* EVER SAW A SESSION (Carl, 7 Sep 2026).
   * Read only from the live tracking below — never from `hasSignedInBefore()`
   * in storage, which answers a different question ("has this browser ever
   * signed in") and would wrongly let a page that opened signed-out skip
   * straight to a non-blocking card. The distinction matters for what a
   * missing session is allowed to mean: a page that never had one still gets
   * the full blocking gate (a practice screen with nobody signed in is a
   * disclosure risk, not an inconvenience — see auth.ts); a page that HAD one
   * and lost it mid-visit gets a card above still-mounted content instead,
   * so whatever the person was doing is not thrown away under them.
   */
  const hadSession = useRef(false);
  /*
   * A RELOAD IS NOT A SIGN-OUT (Carl, 7 Sep 2026). The token is memory-only by
   * design, so the browser's reload starts this page with no session and a
   * silent redirect then restores it from Keycloak's SSO session without asking
   * for anything. This gate used to spend that moment telling somebody to sign
   * in again, which reads as "you have been signed out" — and nobody had been.
   */
  const [restoring, setRestoring] = useState(false);

  const sync = useCallback(() => {
    const s = currentSession();
    if (s) hadSession.current = true;
    /*
     * ONLY ABOUT A PAGE THAT HAS NEVER HELD A SESSION. One that HAD one and
     * lost it mid-visit keeps the card-over-content treatment above, which is
     * what stops somebody's half-finished work being thrown away.
     */
    setRestoring(
      !s && !hadSession.current && typeof silentRestoreInFlight === 'function'
        ? silentRestoreInFlight()
        : false,
    );
    setSession(s);
  }, []);

  /*
   * A DELIBERATE SIGN-OUT IS NOT AN EXPIRY. `sync()` alone cannot tell the
   * two apart — both leave `currentSession()` returning null — and getting
   * this wrong the other way is worse than the bug this file exists to fix:
   * somebody who pressed Sign Out on a shared machine, believing they had
   * left, must not have the practice's own data still on screen under a
   * "sign in again" card. Only the event carries which one happened
   * (`SessionChangeReason`, auth.ts); a `'signed-out'` reason resets
   * `hadSession` so the full blocking gate returns, exactly as if this page
   * had never been signed in at all.
   */
  const onSessionEvent = useCallback(
    (e: Event) => {
      if ((e as CustomEvent<{ reason?: string }>).detail?.reason === 'signed-out') {
        hadSession.current = false;
        setRestoring(false);
      }
      sync();
    },
    [sync],
  );

  useEffect(() => {
    sync();
    // Survives the redirect back from /callback within the same tab only —
    // the token itself is memory-only and never lands in storage.
    setBypassed(window.sessionStorage.getItem('aob.devBypass') === 'true');
    setChecked(true);
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
   * A FAST TICK WHILE THE RESTORE IS OPEN, and none afterwards. Thirty seconds
   * is right for a session that self-expires quietly and far too slow for a
   * window that closes in tens of milliseconds — this gate renders nothing
   * during it, and nothing for thirty seconds is its own fault. `sync` clears
   * `restoring` the moment the question is settled, which stops this interval.
   */
  useEffect(() => {
    if (!restoring) return;
    const tick = setInterval(sync, 250);
    return () => clearInterval(tick);
  }, [restoring, sync]);

  const signOut = useCallback(() => {
    clearSession();
    window.sessionStorage.removeItem('aob.devBypass');
    hadSession.current = false;
    setRestoring(false);
    setSession(null);
    setBypassed(false);
  }, []);

  // Avoids flashing the sign-in card before the in-memory session is read.
  if (!checked) return null;

  /*
   * A SILENT RESTORE IS IN FLIGHT — no card at all, exactly as above.
   *
   * NOT A "SIGNING YOU BACK IN" CARD OF ITS OWN. The top bar already says it
   * (`SessionControl`), and this gate's whole vocabulary is refusals: any card
   * here reads as a thing standing between somebody and the page. Showing
   * nothing for the tens of milliseconds a live SSO session takes to answer is
   * what the `!checked` branch above already does, for the same reason, and
   * `silentRestoreInFlight` is bounded so this cannot become a page that never
   * paints.
   */
  if (!session && !bypassed && restoring) return null;

  if (session) {
    return (
      <>
        <section aria-label={strings.auth.signIn} style={{ ...card, borderColor: '#1a7f37' }}>
          <p style={{ margin: 0 }}>
            {strings.auth.signedInAs} <strong data-testid="gate-signed-in-as">{session.username}</strong>
            {session.roles.length > 0 && (
              <>
                {' · '}
                <code>{session.roles.join(', ')}</code>
              </>
            )}{' '}
            <button onClick={signOut} data-testid="gate-sign-out">
              {strings.auth.signOut}
            </button>
          </p>
          {session.practiceId ? (
            <p style={{ margin: '0.5rem 0 0', color: '#57606a', fontSize: '0.85rem' }}>
              {strings.gate.scopedTo} <code>{session.practiceId}</code> — {strings.gate.tokenWins}
            </p>
          ) : (
            <p style={{ margin: '0.5rem 0 0', color: AMBER, fontSize: '0.85rem' }}>{strings.gate.noPracticeClaim}</p>
          )}
        </section>
        {children}
      </>
    );
  }

  if (bypassed) {
    return (
      <>
        <section aria-label={strings.gate.bypassActive} style={{ ...card, borderColor: RED, borderStyle: 'dashed' }}>
          <p style={{ margin: 0, color: RED }}>
            <strong>{strings.gate.bypassActive}</strong>{' '}
            <button onClick={signOut} data-testid="gate-end-bypass">
              {strings.gate.endBypass}
            </button>
          </p>
          <p style={{ margin: '0.5rem 0 0', color: '#57606a', fontSize: '0.85rem' }}>{strings.gate.bypassNote}</p>
        </section>
        {children}
      </>
    );
  }

  /*
   * SIGNED IN EARLIER ON THIS PAGE, NOT ANY MORE. Carl, 7 Sep 2026: "a console
   * tab left open shows signed in after the session has expired" — and the
   * fix for the top bar (SessionControl.tsx) is not enough on its own, because
   * this gate used to render NOTHING BUT the sign-in card once the session
   * disappeared, which threw away everything on screen mid-action. Rendering
   * the children under the card is what makes "sign in again and retry"
   * literally true rather than a promise: the button somebody was about to
   * press is still there, in the same state, once they are signed in again.
   */
  if (hadSession.current) {
    return (
      <>
        <section aria-label={strings.auth.expiredHeading} style={{ ...card, borderColor: AMBER }} data-testid="auth-gate-expired">
          <p style={{ margin: 0, color: AMBER }}>
            <strong>{strings.auth.expiredHeading}</strong>
          </p>
          <p style={{ margin: '0.5rem 0 0', color: '#57606a', fontSize: '0.85rem' }}>{strings.auth.expiredBody}</p>
          <p style={{ margin: '0.75rem 0 0' }}>
            <button onClick={() => void beginLogin()} data-testid="gate-sign-in-again">
              {strings.auth.signIn}
            </button>
          </p>
        </section>
        {children}
      </>
    );
  }

  return (
    <section aria-label={strings.gate.heading} style={card} data-testid="auth-gate">
      <h2 style={{ marginTop: 0 }}>{strings.gate.heading}</h2>
      <p>{strings.gate.body}</p>
      <p>
        <button onClick={() => void beginLogin()} data-testid="gate-sign-in">
          {strings.auth.signIn}
        </button>
      </p>
      <p style={{ color: '#57606a', fontSize: '0.85rem' }}>{strings.auth.passkeyNote}</p>

      <hr style={{ border: 0, borderTop: '1px solid #d0d7de', margin: '1rem 0' }} />

      {/* The limit of what this gate does, stated rather than implied. */}
      <p style={{ color: AMBER, fontSize: '0.85rem' }}>
        <strong>{strings.gate.scopeWarningHeading}</strong> {strings.gate.scopeWarning}
      </p>

      {DEV_BYPASS_ALLOWED && (
        <p>
          <button
            data-testid="gate-bypass"
            onClick={() => {
              window.sessionStorage.setItem('aob.devBypass', 'true');
              setBypassed(true);
            }}
          >
            {strings.gate.bypassButton}
          </button>{' '}
          <span style={{ color: '#57606a', fontSize: '0.85rem' }}>{strings.gate.bypassWhy}</span>
        </p>
      )}
    </section>
  );
}
