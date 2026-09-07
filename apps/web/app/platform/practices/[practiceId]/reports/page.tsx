'use client';

/**
 * ReportsView, seen as the platform rather than as the practice.
 *
 * `PracticeOverride` tells it which practice the URL is about -- it asks
 * `usePractice()`, which otherwise answers from the session and a stored
 * selection and would show whatever practice happened to be lying around.
 *
 * `ViewOnly` wraps it in a disabled fieldset, so every control inside is inert
 * rather than merely warned about. The server needs no telling: an operator
 * carries no practice claim, so every write behind this page already refuses
 * them.
 */

import { use } from 'react';
import { ReportsView } from '../../../../practice/reports/ReportsView';
import { PracticeOverride } from '../../../../practice/usePractice';
import { ViewOnly } from '../ViewOnly';

export default function ViewReportsViewPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <PracticeOverride practiceId={practiceId}>
        <ReportsView />
      </PracticeOverride>
    </ViewOnly>
  );
}
