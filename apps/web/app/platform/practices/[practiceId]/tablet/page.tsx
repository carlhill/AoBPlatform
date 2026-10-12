'use client';

/**
 * TabletView, seen as the platform rather than as the practice.
 *
 * Same reasoning as every other twin: the practice's own component, wrapped
 * in `ViewOnly` so Send and Recall are inert rather than merely warned
 * about — that holds regardless of anything below.
 *
 * `GET tablet-sessions`, `GET tablet-sessions/pushable` and `GET devices`
 * are all `@PracticeScoped`, checked against the caller's OWN VERIFIED
 * token — sending a patient's particulars to a screen in this practice's
 * waiting room, and reading what is on it, is the PRACTICE'S OWN business,
 * the same reasoning `/practice/devices` carries. Once a deployment
 * authenticates practice-scoped callers for real, a genuine platform token
 * has no practice claim and meets the same refusal `TabletView` already
 * shows for any load failure. Seeing the real queue means acting as the
 * practice, exactly as the setup hub's Tablets card anticipates.
 */

import { use } from 'react';
import { TabletView } from '../../../../practice/tablet/TabletView';
import { ViewOnly } from '../ViewOnly';

export default function ViewTabletPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <TabletView practiceId={practiceId} />
    </ViewOnly>
  );
}
