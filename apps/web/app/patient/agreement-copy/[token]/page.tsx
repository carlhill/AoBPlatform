import type { Metadata } from 'next';
import { AgreementCopyView } from './AgreementCopyView';
import { strings } from '../../../strings';

export const metadata: Metadata = {
  title: `${strings.patientCopy.title} — ${strings.appName}`,
};

export default async function AgreementCopyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AgreementCopyView token={token} />;
}
