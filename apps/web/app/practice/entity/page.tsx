'use client';

import { PracticeGate } from '../PracticeGate';
import { EntityView } from './EntityView';

export default function EntityPage() {
  return <PracticeGate>{(practiceId) => <EntityView practiceId={practiceId} />}</PracticeGate>;
}
