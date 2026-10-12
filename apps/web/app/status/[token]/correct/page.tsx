import type { Metadata } from 'next';
import { CorrectView } from './CorrectView';
import { strings } from '../../../strings';

export const metadata: Metadata = {
  title: `${strings.status.correctTitle} — ${strings.appName}`,
};

export default async function CorrectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CorrectView token={token} />;
}
