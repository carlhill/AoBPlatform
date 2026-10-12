import type { Metadata } from 'next';
import { PatientMessagesView } from './PatientMessagesView';
import { strings } from '../../../strings';

export const metadata: Metadata = {
  title: `${strings.patientMessages.title} — ${strings.appName}`,
};

export default async function PatientMessagesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PatientMessagesView token={token} />;
}
