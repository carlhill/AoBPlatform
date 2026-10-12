'use client';

/**
 * QueueView, scoped to one practice, seen as the platform.
 *
 * This practice's outbound messages, not everything at once.
 * The global version at /practice/queue still exists for platform-wide work;
 * this one exists because somebody examining ONE practice should not be thrown
 * out into everything to answer a question about it.
 *
 * `PracticeOverride` fixes which practice the page is about from the URL.
 * `ViewOnly` disables every control inside -- a resend or a resolve is work,
 * and work needs either a practice claim or the operator's own queue, not a
 * read-only window.
 */

import { use } from 'react';
import { QueueView } from '../../../../practice/queue/QueueView';
import { PracticeOverride } from '../../../../practice/usePractice';
import { ViewOnly } from '../ViewOnly';

export default function ViewQueueViewPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <PracticeOverride practiceId={practiceId}>
        <QueueView />
      </PracticeOverride>
    </ViewOnly>
  );
}
