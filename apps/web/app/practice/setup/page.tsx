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
import { Shell, ui } from '../../ui';
import { strings } from '../../strings';
import { currentSession } from '../../auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const SELECTION_KEY = 'aob.practiceId';

export default function SetupPage() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const fromSession = currentSession()?.practiceId;
    const stored = fromSession ?? window.localStorage.getItem(SELECTION_KEY);
    if (!stored) {
      setChecked(true);
      return;
    }

    fetch(`${CORE_URL}/organisations/setup`, { headers: { 'x-practice-id': stored } })
      .then((r) => {
        if (r.ok) {
          setPracticeId(stored);
        } else {
          // Cleared rather than left to fail later, so the empty state explains
          // why the page has nothing on it instead of the reader concluding it
          // is broken.
          window.localStorage.removeItem(SELECTION_KEY);
        }
      })
      .catch(() => undefined)
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
