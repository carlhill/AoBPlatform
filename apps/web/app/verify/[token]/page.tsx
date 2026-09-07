import type { Metadata } from 'next';
import { VerifyView } from './VerifyView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.verify.audience} — ${strings.appName}`,
};

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VerifyView token={token} />;
}
