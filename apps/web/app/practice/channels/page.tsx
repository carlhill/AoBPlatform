'use client';

import { PracticeGate } from '../PracticeGate';
import { ChannelsView } from './ChannelsView';

export default function ChannelsPage() {
  return <PracticeGate>{(practiceId) => <ChannelsView practiceId={practiceId} />}</PracticeGate>;
}
