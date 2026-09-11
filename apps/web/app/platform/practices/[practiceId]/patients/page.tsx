'use client';

/**
 * The patients work list, seen as the platform rather than as the practice.
 *
 * Same reasoning as every other twin: the practice's own component, wrapped in
 * `ViewOnly` so nothing on it can be pressed — that holds regardless of
 * anything below. `GET /patients?open=today` is `@PracticeScoped` and checked
 * against the caller's OWN VERIFIED token, so seeing a real queue means acting
 * as the practice, which leaves a record of on whose behalf.
 */

import { use } from 'react';
import { PatientsQueueView } from '../../../../practice/patients/PatientsQueueView';
import { ViewOnly } from '../ViewOnly';

export default function ViewPatientsPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <PatientsQueueView practiceId={practiceId} />
    </ViewOnly>
  );
}
