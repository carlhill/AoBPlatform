import type { Metadata } from 'next';
import { SummaryView } from '../queue/SummaryView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.summary.bySiteTitle} — ${strings.appName}`,
};

export default function QueueBySitePage() {
  return <SummaryView groupBy="site" />;
}
