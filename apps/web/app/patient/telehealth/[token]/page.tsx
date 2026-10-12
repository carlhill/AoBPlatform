import type { Metadata } from 'next';
import { TelehealthPatientView } from './TelehealthPatientView';
import { strings } from '../../../strings';

export const metadata: Metadata = {
  title: `${strings.telehealth.patient.title} — ${strings.appName}`,
};

/**
 * `/patient/telehealth/[token]` — the one page for a telehealth consultation
 * (TELEHEALTH-PLAN.md §8 step 2). A new route on purpose: the existing
 * `/verify` and `/agree` pages are the remote-link flow and are being changed
 * by step 1 in parallel.
 */
export default async function TelehealthPatientPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TelehealthPatientView token={token} />;
}
