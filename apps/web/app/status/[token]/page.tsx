import type { Metadata } from 'next';
import { StatusView } from './StatusView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.status.audience} — ${strings.appName}`,
};

export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <StatusView token={token} />;
}
