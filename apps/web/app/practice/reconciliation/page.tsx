import type { Metadata } from 'next';
import { ReconciliationView } from './ReconciliationView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.reconciliation.title} — ${strings.appName}`,
};

export default function ReconciliationPage() {
  return <ReconciliationView />;
}
