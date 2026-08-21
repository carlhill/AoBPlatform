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

import { useCallback, useEffect, useState } from 'react';
import { beginLogin, clearSession, currentSession, type Session } from './auth';
import { strings } from './strings';

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

  useEffect(() => {
    setSession(currentSession());
    // Survives the redirect back from /callback within the same tab only —
    // the token itself is memory-only and never lands in storage.
    setBypassed(window.sessionStorage.getItem('aob.devBypass') === 'true');
    setChecked(true);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    window.sessionStorage.removeItem('aob.devBypass');
    setSession(null);
    setBypassed(false);
  }, []);

  // Avoids flashing the sign-in card before the in-memory session is read.
  if (!checked) return null;

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
