'use client';
import { SessionControl } from '../../SessionControl';

/**
 * The setup hub route.
 *
 * WHICH PRACTICE. Once platform sign-in exists this comes from the session and
 * there is nothing to choose: a practice admin belongs to one practice and the
 * token says which. Until then it falls back to the console's stored selection.
 *
 * That selection is REVALIDATED on load rather than trusted. A stored id can
 * point at a practice that has since been deleted, which is exactly the
 * stale-localStorage bug this codebase has already been bitten by once
 * (CONVENTIONS.md §9b: client-side persistence is a claim, not a fact).
 *
 * AND IT OFFERS A WAY OUT, which the first version did not. A page that depends
 * on a selection made somewhere else, and provides no way to make it, is a dead
 * end — the empty state was correct and completely useless. Choosing happens on
 * /practice, which is a real page rather than a picker bolted on here: a
 * practice administrator can legitimately hold several practices, so switching
 * between them is ordinary work.
 */

import { useEffect, useState } from 'react';
import { SetupHub } from './SetupHub';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Notice, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders, currentSession } from '../../auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const SELECTION_KEY = 'aob.practiceId';

export default function SetupPage() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const fromSession = currentSession()?.practiceId;
    const stored = fromSession ?? window.localStorage.getItem(SELECTION_KEY);
    if (!stored) {
      setChecked(true);
      return;
    }

    fetch(`${CORE_URL}/organisations/setup`, { headers: apiHeaders(stored) })
      .then((r) => {
        if (r.ok) {
          setPracticeId(stored);
          return;
        }

        /*
         * A SERVER FAULT IS NOT AN ANSWER. 5xx means the API could not say
         * whether this practice exists, and treating "could not say" as "does
         * not exist" is how a stored selection gets thrown away during a
         * restart. Only a definitive refusal -- it is gone, or it is not yours
         * -- clears it.
         */
        if (r.status >= 500) {
          setUnreachable(true);
          return;
        }

        // Cleared rather than left to fail later, so the empty state explains
        // why the page has nothing on it instead of the reader concluding it
        // is broken.
        window.localStorage.removeItem(SELECTION_KEY);
      })
      .catch(() => {
        /*
         * THE API IS DOWN, and this branch used to be `() => undefined` -- so a
         * dead core fell through to "No practice is selected -- or the one that
         * was selected no longer exists", which reads as DATA LOSS. It cost a
         * real scare. An unreachable server is a fact about the server, and the
         * page now says so rather than making an accusation about the data.
         */
        setUnreachable(true);
      })
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <p className={ui.hint}>{strings.review.loading}</p>
      </Shell>
    );
  }

  /*
   * NOTHING IS SHOWN when the API cannot be reached. Not an empty practice, not
   * a picker, not a suggestion that anything is missing -- there is no way to
   * tell from here what exists, and a screen that guesses is worse than one
   * that admits it does not know.
   */
  if (unreachable) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <h1 className={ui.pageTitle}>{strings.setup.offlineTitle}</h1>
        <Notice tone="stop" title={strings.setup.offlineTitle} data-testid="setup-offline">
          {strings.setup.offlineBody}
        </Notice>
      </Shell>
    );
  }

  /*
   * Nothing selected. Sends the reader to the LIST rather than showing a picker
   * here — a practice administrator can hold several practices, so choosing
   * between them is ordinary work with a page of its own, not a dead end with a
   * dev-only warning box on it.
   */
  if (!practiceId) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <h1 className={ui.pageTitle}>{strings.setup.noPracticeTitle}</h1>
        <p className={ui.pageLead}>{strings.setup.noPracticeBody}</p>
        <Link href="/practice" className={ui.buttonLink} data-testid="setup-to-list">
          {strings.practices.title}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </Shell>
    );
  }

  return <SetupHub practiceId={practiceId} />;
}
