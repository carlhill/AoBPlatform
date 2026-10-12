'use client';

/**
 * The practice's correspondence, seen as the platform: states, never bodies.
 *
 * `PracticeOverride` fixes which practice the page is about from the URL and
 * `ViewOnly` disables every control inside it. The audience is passed as
 * `platform`, which is what withholds the message text — "a platform-wide view
 * of messages — states, not bodies" (TODO.md). What a message SAID belongs to
 * the practice that sent it and the person who received it; that an operator
 * can see it was sent and whether it arrived is the whole job of this window.
 */

import { use } from 'react';
import { CorrespondenceView } from '../../../../practice/correspondence/CorrespondenceView';
import { PracticeOverride } from '../../../../practice/usePractice';
import { ViewOnly } from '../ViewOnly';

export default function ViewCorrespondencePage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <PracticeOverride practiceId={practiceId}>
        <CorrespondenceView audience="platform" />
      </PracticeOverride>
    </ViewOnly>
  );
}
