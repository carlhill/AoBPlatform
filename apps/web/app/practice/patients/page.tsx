'use client';

import { PracticeGate } from '../PracticeGate';
import { PatientsQueueView } from './PatientsQueueView';

/**
 * `/practice/patients` — the patients with something open today.
 *
 * `practice` IN THE PAGE-ACCESS MAP, exactly as `/practice/tablet` is, and for
 * the identical reason: this is the ordinary work of the front desk, done
 * dozens of times a morning by whoever is standing at the counter. It shows
 * nothing an administrator may see that a receptionist may not, and every act
 * behind it is the same `@PracticeScoped` act it already was.
 */
export default function PatientsPage() {
  return <PracticeGate>{(practiceId) => <PatientsQueueView practiceId={practiceId} />}</PracticeGate>;
}
