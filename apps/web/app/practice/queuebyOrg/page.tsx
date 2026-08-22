import type { Metadata } from 'next';
import { SummaryView } from '../queue/SummaryView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.summary.byOrgTitle} — ${strings.appName}`,
};

export default function QueueByOrgPage() {
  return <SummaryView groupBy="org" />;
}
