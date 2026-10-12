import type { Metadata } from 'next';
import { CorrespondenceView } from './CorrespondenceView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.correspondence.title} — ${strings.appName}`,
};

export default function CorrespondencePage() {
  return <CorrespondenceView />;
}
