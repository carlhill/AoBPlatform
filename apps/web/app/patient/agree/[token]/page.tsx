import type { Metadata } from 'next';
import { AgreeView } from './AgreeView';
import { strings } from '../../../strings';

export const metadata: Metadata = {
  title: `${strings.agree.audience} — ${strings.appName}`,
};

export default async function AgreePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AgreeView token={token} />;
}
