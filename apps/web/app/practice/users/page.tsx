import type { Metadata } from 'next';
import { UsersView } from './UsersView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.users.title} — ${strings.appName}`,
};

export default function UsersPage() {
  return <UsersView />;
}
