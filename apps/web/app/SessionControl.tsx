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

import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut, Building2, ShieldCheck } from 'lucide-react';
import { beginLogin, currentSession, signOut as endSession, type Session } from './auth';
import { strings } from './strings';
import { ui } from './ui';

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

  useEffect(() => {
    setSession(currentSession());
    setChecked(true);
  }, []);

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
    fetch(`${CORE_URL}/practices/${practiceId}`, { headers: { 'x-practice-id': practiceId } })
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
    setSession(null);
    endSession();
  }, []);

  // Nothing until the in-memory session has been read, or the bar flickers
  // from "sign in" to "signed in as…" on every page load.
  if (!checked) return null;

  if (!session) {
    return (
      <span className={ui.sessionBar}>
        <span className={ui.sessionAudience}>{audience}</span>
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

  // A practice claim beats a platform role — the same rule landingPath() uses.
  // Somebody scoped to a practice is acting AS that practice, whatever else
  // they may also hold.
  const scopedToPractice = Boolean(session.practiceId);
  const affiliation = scopedToPractice
    ? (practiceName ?? strings.auth.practiceLoading)
    : strings.auth.platformUser;

  return (
    <span className={ui.sessionBar}>
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
