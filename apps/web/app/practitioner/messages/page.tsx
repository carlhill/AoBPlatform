import type { Metadata } from 'next';
import { MessagesView } from './MessagesView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.myMessages.title} — ${strings.appName}`,
};

export default function PractitionerMessagesPage() {
  return <MessagesView />;
}
