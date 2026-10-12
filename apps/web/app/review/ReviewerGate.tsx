'use client';

/**
 * The reviewer's sign-in gate.
 *
 * WHY A SEPARATE GATE FROM AuthGate. The console gate asks "are you signed
 * in"; this asks "are you a platform administrator". Those are different
 * questions, and the second one matters more here than anywhere else in the
 * product: a platform admin approves practices, and approving a practice is
 * what opens consent capture. It is the most privileged act in the system.
 *
 * WHAT THIS GATE DOES AND DOES NOT DO, stated rather than implied — a gate that
 * looks stronger than it is, is worse than no gate, because people plan around
 * the appearance:
 *
 *   - It stops a person BROWSING to the reviewer screens without the role.
 *   - It does NOT stop a request. Until AUTH_ENFORCE is on, the core API still
 *     accepts an x-practice-id header from anyone who can reach it. The server
 *     guard is a separate release gate.
 *
 * Both facts are on the screen, because the honest version of "we are not
 * finished" is more useful to whoever reads this next than a reassuring one.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { beginLogin, currentSession, signOut as endSession, type Session } from '../auth';
import { Button, Notice, Shell, ui } from '../ui';
import { strings } from '../strings';
import { SessionControl } from '../SessionControl';

const REQUIRED_ROLE = 'platform_admin';

/**
 * The reviewer's own Keycloak client, NOT `web`.
 *
 * `web` is the practice console and portal. Signing a reviewer in through it
 * would produce a token indistinguishable from a practice administrator's at
 * the API — which is precisely what the second client exists to prevent.
 */
const CONSOLE_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CONSOLE_CLIENT_ID ?? 'console';

/**
 * The development escape hatch, OFF unless switched on at build time.
 *
 * It exists because the platform-admin realm client is new and unproven on real
 * hardware, and without it a browser that cannot complete WebAuthn locks the
 * reviewer screens away entirely — including the screens used to approve the
 * practice whose admin would enrol the first passkey.
 */
const DEV_BYPASS_ALLOWED = process.env.NEXT_PUBLIC_DEV_UNAUTHENTICATED_CONSOLE === 'true';
const BYPASS_KEY = 'aob.reviewerBypass';

export function ReviewerGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setSession(currentSession());
    /*
     * THE FLAG DECIDES, NOT THE STORAGE. Hiding the bypass button when
     * NEXT_PUBLIC_DEV_UNAUTHENTICATED_CONSOLE is unset hides a control; it does
     * not remove one. Anybody with a developer console could set the key by
     * hand and the gate would open, which is the same class of mistake as
     * trusting a stored practice id: client-side state is a CLAIM, not a fact
     * (CONVENTIONS.md 9b).
     *
     * It matters more the moment AUTH_ENFORCE goes true. The API would refuse
     * the requests, so the console would be a shell of failing panels rather
     * than a leak -- but a screen that looks signed-in to somebody who is not
     * is the wrong thing to be shipping from a product whose premise is knowing
     * who did what.
     *
     * A stale key is also CLEARED rather than ignored, so switching the flag
     * off actually revokes an open bypass instead of leaving it dormant until
     * somebody switches the flag back on.
     */
    if (DEV_BYPASS_ALLOWED) {
      setBypassed(window.sessionStorage.getItem(BYPASS_KEY) === 'true');
    } else {
      window.sessionStorage.removeItem(BYPASS_KEY);
      setBypassed(false);
    }
    setChecked(true);
  }, []);

  /*
   * Clears the DEV BYPASS as well, then hands off to the shared sign-out —
   * which ends the Keycloak session rather than just this tab's copy of it.
   * Leaving the bypass set would sign somebody out of Keycloak and leave them
   * looking at reviewer screens anyway, which is the opposite of what the
   * button says.
   */
  const signOut = useCallback(() => {
    window.sessionStorage.removeItem(BYPASS_KEY);
    setSession(null);
    setBypassed(false);
    endSession();
  }, []);

  // Avoids flashing the sign-in card before the in-memory session is read.
  if (!checked) return null;

  if (session) {
    // Signed in, but as WHAT. A practice admin reaching these screens is a
    // wrong turn, not an attack, and is told so plainly.
    if (!session.roles.includes(REQUIRED_ROLE)) {
      return (
        <Shell right={<SessionControl audience={strings.review.audience} />}
      title={strings.reviewerGate.wrongRoleTitle}
      lead={strings.reviewerGate.wrongRoleBody}
    >
          <p className={ui.hint}>
            {strings.reviewerGate.signedInAs} <strong>{session.username}</strong>
            {session.roles.length > 0 && <> · {session.roles.join(', ')}</>}
          </p>
        </Shell>
      );
    }

    return (
      <>
        {children}
      </>
    );
  }

  if (bypassed) {
    return (
      <>
        {/*
          Loud, dashed and red, and it names itself. A development bypass that
          looks like a normal signed-in state is how one reaches production.
        */}
        <div className={`${ui.reviewerBanner} ${ui.reviewerBannerBypass}`}>
          <ShieldAlert size={15} aria-hidden="true" />
          <strong>{strings.reviewerGate.bypassActive}</strong>
          <span>{strings.reviewerGate.bypassNote}</span>
          <button type="button" className={ui.bannerButton} onClick={signOut} data-testid="reviewer-end-bypass">
            {strings.reviewerGate.endBypass}
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.review.audience} />}
      title={strings.reviewerGate.heading}
      lead={strings.reviewerGate.body}
    >
      <div className={ui.signInCard} data-testid="reviewer-gate">
        <div className={ui.signInMark}>
          <ShieldCheck size={20} aria-hidden="true" />
          {strings.appName}
        </div>

        <div className={ui.rowActions}>
          <Button variant="primary" onClick={() => void beginLogin(CONSOLE_CLIENT_ID)} data-testid="reviewer-sign-in">
            {strings.auth.signIn}
          </Button>
        </div>

        <p className={ui.hint} style={{ marginTop: 'var(--s4)' }}>
          {strings.auth.passkeyNote}
        </p>

        {/* The limit of what this gate does. Said, not implied. */}
        <Notice tone="warn" title={strings.reviewerGate.scopeHeading}>
          {strings.reviewerGate.scopeBody}
        </Notice>

        {DEV_BYPASS_ALLOWED && (
          <div className={ui.rowActions}>
            <Button
              variant="subtle"
              data-testid="reviewer-bypass"
              onClick={() => {
                window.sessionStorage.setItem(BYPASS_KEY, 'true');
                setBypassed(true);
              }}
            >
              {strings.reviewerGate.bypass}
            </Button>
            <span className={ui.hint}>{strings.reviewerGate.bypassOnlyHere}</span>
          </div>
        )}
      </div>
    </Shell>
  );
}
