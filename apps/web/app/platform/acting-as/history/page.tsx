import type { Metadata } from 'next';
import { ActingAsHistory } from './HistoryView';
import { strings } from '../../../strings';

export const metadata: Metadata = {
  title: `${strings.actingAsHistory.title} — ${strings.appName}`,
};

export default function ActingAsHistoryPage() {
  return <ActingAsHistory />;
}
