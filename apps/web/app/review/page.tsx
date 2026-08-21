import type { Metadata } from 'next';
import { QueueView } from './QueueView';
import { strings } from '../strings';

export const metadata: Metadata = {
  title: `${strings.review.queueTitle} — ${strings.appName}`,
};

export default function ReviewQueuePage() {
  return <QueueView />;
}
