'use client';

/**
 * One patient's work page, seen as the platform: readable, and genuinely
 * inert. The same twin pattern as `/platform/practices/<id>/tablet` — the
 * practice's own component inside `ViewOnly`, whose disabled fieldset makes
 * Send, Recall, Correct and Re-send unreachable rather than merely warned
 * about.
 *
 * TWO IDS IN ONE PATH, and they are not the same kind of thing: the practice
 * id says whose page this is, the patient id says which row. Every read behind
 * it is `@PracticeScoped` and scoped again by RLS, so a mismatched pair finds
 * nothing rather than being refused.
 */

import { use } from 'react';
import { PatientWorkView } from '../../../../../practice/patients/PatientWorkView';
import { ViewOnly } from '../../ViewOnly';

export default function ViewPatientWorkPage({
  params,
}: {
  params: Promise<{ practiceId: string; patientId: string }>;
}) {
  const { practiceId, patientId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <PatientWorkView practiceId={practiceId} patientId={patientId} />
    </ViewOnly>
  );
}
