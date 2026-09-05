'use client';

import { PracticeGate } from '../PracticeGate';
import { TemplatesView } from './TemplatesView';

export default function TemplatesPage() {
  return <PracticeGate>{(practiceId) => <TemplatesView practiceId={practiceId} />}</PracticeGate>;
}
