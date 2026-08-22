'use client';

/**
 * Which practice is this page about?
 *
 * EXTRACTED RATHER THAN COPIED. Four pages now need this answer and the logic
 * is not one line: prefer the session, fall back to a stored selection,
 * REVALIDATE that selection against the server, and clear it visibly if it no
 * longer resolves. Copied four times it would drift, and the drift would be a
 * page that trusts a stale id while its neighbour does not.
 *
 * THE REVALIDATION IS THE POINT (CONVENTIONS.md §9b). A value in localStorage
 * is a CLAIM, not a fact: it can name a practice that has since been deleted,
 * rejected, or that this person was never entitled to. This codebase has
 * already been bitten by trusting one. So the stored id is checked on every
 * load, and a failed check clears it rather than leaving a page to fail later
 * in some less legible way.
 *
 * Once platform sign-in covers practice accounts there is nothing to choose:
 * the token says which practice, and the stored-selection branch goes away.
 */

import { useEffect, useState } from 'react';
import { mayChoosePractice } from '@aobplatform/domain';
import { apiHeaders, attemptSilentLogin, currentSession } from '../auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const SELECTION_KEY = 'aob.practiceId';

export interface PracticeSelection {
  /**
   * True when the TOKEN fixed the practice, so nothing may change it.
   * Screens use this to hide choosers rather than offer a refusal.
   */
  scoped: boolean;
  /** Null once `checked` is true means: nothing selected, or what was selected is gone. */
  practiceId: string | null;
  /** False while the revalidation round trip is in flight. */
  checked: boolean;
}

export function usePractice(): PracticeSelection {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [scoped, setScoped] = useState(false);

  useEffect(() => {
    let live = true;

    const session = currentSession();

    /*
     * NO SESSION ON A COLD LOAD IS THE NORMAL CASE, not an anomaly.
     *
     * The token lives in a module variable and nowhere else, so any full page
     * load destroys it. Falling straight through to a stored selection here is
     * what let somebody who navigated directly to /practice/locations be shown
     * a chooser listing every practice on the platform: with no session there
     * was no claim to scope them by.
     *
     * So a browser that has signed in before tries to restore SILENTLY first.
     * If Keycloak's session is live this returns having started a redirect and
     * nothing below runs; if it is not, it returns false and the normal gate
     * takes over.
     */
    if (!session) {
      void attemptSilentLogin().then((started) => {
        if (!started && live) setChecked(true);
      });
      return;
    }

    /*
     * A TOKEN CLAIM IS AUTHORITATIVE AND ENDS THE QUESTION.
     *
     * A practice user has exactly one practice and the server put it in their
     * token. Falling back to a stored selection for them would let a value any
     * script can write override a value the server issued — and the stored one
     * names somebody else's practice, because that is the only reason it would
     * differ.
     *
     * So the claim is not merely preferred: when it exists, any stored
     * selection is REMOVED, so a practice user who once had one cannot carry it
     * around.
     */
    if (session && mayChoosePractice({ roles: session.roles, practiceId: session.practiceId }) === false) {
      window.localStorage.removeItem(SELECTION_KEY);
      setPracticeId(session.practiceId ?? null);
      setScoped(true);
      setChecked(true);
      return;
    }

    const stored = window.localStorage.getItem(SELECTION_KEY);
    if (!stored) {
      setChecked(true);
      return;
    }

    // The setup hub is the cheapest endpoint that answers "does this practice
    // exist AND is it mine": it is practice-scoped, so RLS refuses it for
    // anything the header does not entitle us to.
    fetch(`${CORE_URL}/organisations/setup`, { headers: apiHeaders(stored) })
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setPracticeId(stored);
        } else {
          window.localStorage.removeItem(SELECTION_KEY);
        }
      })
      .catch(() => undefined)
      .finally(() => live && setChecked(true));

    return () => {
      live = false;
    };
  }, []);

  return { practiceId, checked, scoped };
}
