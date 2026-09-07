import type { Metadata } from 'next';
import { IdentityDashboard } from './IdentityDashboard';
import { ReviewerGate } from '../ReviewerGate';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.identity.title} — ${strings.appName}`,
};

export default function IdentityDashboardPage() {
  return (
    <ReviewerGate>
      <IdentityDashboard />
    </ReviewerGate>
  );
}
