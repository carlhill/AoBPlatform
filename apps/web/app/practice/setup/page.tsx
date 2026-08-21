'use client';

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
 * AND IT OFFERS A WAY TO CHOOSE, which the first version did not. A page that
 * depends on a selection made somewhere else, and provides no way to make it
 * here, is a dead end — the empty state was correct and useless. The picker is
 * marked as the development affordance it is, because in production a practice
 * admin must never see a list of other practices.
 */

import { useEffect, useState } from 'react';
import { SetupHub } from './SetupHub';
import { Button, Notice, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import { currentSession } from '../../auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const SELECTION_KEY = 'aob.practiceId';

interface Choice {
  id: string;
  name: string;
  abn: string | null;
  validationState: string;
}

export default function SetupPage() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);

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

  // Only fetched when there is nothing selected — this list is the development
  // affordance, not part of the page.
  useEffect(() => {
    if (!checked || practiceId) return;
    fetch(`${CORE_URL}/organisations?state=validated`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { organisations: Choice[] }) => setChoices(data.organisations ?? []))
      .catch(() => setChoices([]));
  }, [checked, practiceId]);

  function choose(id: string) {
    window.localStorage.setItem(SELECTION_KEY, id);
    setPracticeId(id);
  }

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

        <Notice tone="warn" title={strings.setup.pickerDevTitle}>
          {strings.setup.pickerDevBody}
        </Notice>

        {choices === null && <p className={ui.hint}>{strings.review.loading}</p>}

        {choices !== null && choices.length === 0 && (
          <p className={ui.hint}>{strings.setup.pickerEmpty}</p>
        )}

        {choices !== null && choices.length > 0 && (
          <ul className={ui.plainList} data-testid="setup-picker">
            {choices.map((c) => (
              <li key={c.id}>
                <Button onClick={() => choose(c.id)} data-testid={`setup-pick-${c.id}`}>
                  {c.name}
                </Button>{' '}
                <span className={ui.hint}>ABN {c.abn ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </Shell>
    );
  }

  return <SetupHub practiceId={practiceId} />;
}
