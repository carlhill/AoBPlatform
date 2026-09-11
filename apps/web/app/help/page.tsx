import type { Metadata } from 'next';
import { HelpView } from './HelpView';
import { strings } from '../strings';

export const metadata: Metadata = {
  title: `${strings.help.title} — ${strings.appName}`,
};

export default function HelpPage() {
  return <HelpView />;
}
