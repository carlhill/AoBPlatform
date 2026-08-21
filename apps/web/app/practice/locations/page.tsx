'use client';

import { PracticeGate } from '../PracticeGate';
import { LocationsView } from './LocationsView';

export default function LocationsPage() {
  return <PracticeGate>{(practiceId) => <LocationsView practiceId={practiceId} />}</PracticeGate>;
}
