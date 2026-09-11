'use client';

import { PracticeGate } from '../PracticeGate';
import { PractitionersView } from './PractitionersView';

export default function PractitionersPage() {
  return <PracticeGate>{(practiceId) => <PractitionersView practiceId={practiceId} />}</PracticeGate>;
}
