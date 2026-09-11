import type { Metadata } from 'next';
import { QueueView } from './QueueView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.queue.title} — ${strings.appName}`,
};

export default function QueuePage() {
  return <QueueView />;
}
