'use client';

/**
 * The setup hub route.
 *
 * The practice comes from the SESSION once platform sign-in exists; until then
 * it falls back to the selection the console already holds. That selection is
 * REVALIDATED on load rather than trusted — a stored id can point at a practice
 * that has since been deleted, which is exactly the stale-localStorage bug this
 * codebase has already been bitten by once (CONVENTIONS.md §9b: client-side
 * persistence is a claim, not a fact).
 */

import { useEffect, useState } from 'react';
import { SetupHub } from './SetupHub';
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
          // Cleared rather than left to fail later. The empty state below then
          // explains why the page has nothing on it, instead of the reader
          // concluding it is broken.
          window.localStorage.removeItem(SELECTION_KEY);
        }
      })
      .catch(() => undefined)
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return (
      <Shell right={strings.setup.audience}>
        <p className={ui.hint}>{strings.review.loading}</p>
      </Shell>
    );
  }

  if (!practiceId) {
    return (
      <Shell right={strings.setup.audience}>
        <h1 className={ui.pageTitle}>{strings.setup.noPracticeTitle}</h1>
        <p className={ui.pageLead}>{strings.setup.noPracticeBody}</p>
      </Shell>
    );
  }

  return <SetupHub practiceId={practiceId} />;
}
