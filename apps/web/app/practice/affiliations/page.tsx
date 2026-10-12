'use client';

import { PracticeGate } from '../PracticeGate';
import { AffiliationsView } from './AffiliationsView';

export default function AffiliationsPage() {
  return <PracticeGate>{(practiceId) => <AffiliationsView practiceId={practiceId} />}</PracticeGate>;
}
