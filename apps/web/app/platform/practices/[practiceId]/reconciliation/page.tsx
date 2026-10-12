'use client';

/**
 * ReconciliationView, scoped to one practice, seen as the platform.
 *
 * `PracticeOverride` fixes which practice the page is about from the URL and
 * `ViewOnly` disables every control inside — resending is the practice's act
 * (or the operator's, acting as them), never a read-only window's.
 */

import { use } from 'react';
import { ReconciliationView } from '../../../../practice/reconciliation/ReconciliationView';
import { PracticeOverride } from '../../../../practice/usePractice';
import { ViewOnly } from '../ViewOnly';

export default function ViewReconciliationPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <PracticeOverride practiceId={practiceId}>
        <ReconciliationView />
      </PracticeOverride>
    </ViewOnly>
  );
}
