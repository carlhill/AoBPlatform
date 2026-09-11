import type { Metadata } from 'next';
import { ReportsView } from './ReportsView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.reports.title} — ${strings.appName}`,
};

export default function ReportsPage() {
  return <ReportsView />;
}
