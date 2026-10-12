import type { Metadata } from 'next';
import { PracticeList } from './PracticeList';
import { strings } from '../strings';

export const metadata: Metadata = {
  title: `${strings.practices.title} — ${strings.appName}`,
};

export default function PracticesPage() {
  return <PracticeList />;
}
