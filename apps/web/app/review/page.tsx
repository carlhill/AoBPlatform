import type { Metadata } from 'next';
import { QueueView } from './QueueView';
import { ReviewerGate } from './ReviewerGate';
import { strings } from '../strings';

export const metadata: Metadata = {
  title: `${strings.review.queueTitle} — ${strings.appName}`,
};

export default function ReviewQueuePage() {
  return (
    <ReviewerGate>
      <QueueView />
    </ReviewerGate>
  );
}
