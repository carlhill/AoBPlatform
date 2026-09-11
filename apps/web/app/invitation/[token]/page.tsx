import type { Metadata } from 'next';
import { InvitationView } from './InvitationView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.invitation.audience} — ${strings.appName}`,
};

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitationView token={token} />;
}
