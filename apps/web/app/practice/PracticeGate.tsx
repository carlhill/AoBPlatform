'use client';

/**
 * "Which practice" resolved, with the two states that answer can be in.
 *
 * A page that depends on a selection made elsewhere and offers no way to make
 * it is a dead end — the empty state is correct and completely useless. So the
 * no-practice case leads to the list, which is a real page, because a practice
 * administrator can hold several practices and switching between them is
 * ordinary work rather than an error.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Shell, ui } from '../ui';
import { strings } from '../strings';
import { usePractice } from './usePractice';

export function PracticeGate({ children }: { children: (practiceId: string) => React.ReactNode }) {
  const { practiceId, checked } = usePractice();

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
        <Link href="/practice" className={ui.buttonLink} data-testid="gate-to-list">
          {strings.practices.title}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </Shell>
    );
  }

  return <>{children(practiceId)}</>;
}
