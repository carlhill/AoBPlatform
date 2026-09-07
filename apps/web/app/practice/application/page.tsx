import type { Metadata } from 'next';
import { ApplicationView } from './ApplicationView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.application.title} — ${strings.appName}`,
};

export default function ApplicationPage() {
  return <ApplicationView />;
}
