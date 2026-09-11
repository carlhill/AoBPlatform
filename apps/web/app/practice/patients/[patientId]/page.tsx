'use client';

import { use } from 'react';
import { PracticeGate } from '../../PracticeGate';
import { PatientWorkView } from '../PatientWorkView';

/**
 * `/practice/patients/<id>` — one patient, everything open, one page.
 *
 * THE PATIENT IS IN THE PATH, so the page-access rule for `/practice/patients`
 * declares `matchesChildren` — an unclassified page is REFUSED by `mayReach`,
 * which would be a screen reception could not open.
 *
 * `PracticeGate` RESOLVES WHICH PRACTICE, exactly as `/practice/tablet` does.
 * The id in the path names a patient, never a practice: the scope comes from
 * the caller's own claim and the server fails closed on a stranger's id (RLS
 * finds nothing rather than refusing, which is the answer that admits least).
 */
export default function PatientWorkPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  return (
    <PracticeGate>
      {(practiceId) => <PatientWorkView practiceId={practiceId} patientId={patientId} />}
    </PracticeGate>
  );
}
