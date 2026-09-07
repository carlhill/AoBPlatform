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
import { SessionControl } from '../SessionControl';

export function PracticeGate({ children }: { children: (practiceId: string) => React.ReactNode }) {
  const { practiceId, checked, scoped } = usePractice();

  if (!checked) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}
      title={strings.setup.noPracticeTitle}
      lead={scoped ? strings.setup.noPracticeScoped : strings.setup.noPracticeBody}
    >
        <p className={ui.hint}>{strings.review.loading}</p>
      </Shell>
    );
  }

  if (!practiceId) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        {/*
          The way out is a LIST, and only somebody entitled to a list is offered
          one. A scoped user has exactly one practice and cannot choose another,
          so pointing them at a chooser would be pointing them at a refusal.
        */}
        {!scoped && (
          <Link href="/practice" className={ui.buttonLink} data-testid="gate-to-list">
            {strings.practices.title}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </Shell>
    );
  }

  return <>{children(practiceId)}</>;
}
