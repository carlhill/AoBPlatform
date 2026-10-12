import type { Metadata } from 'next';
import { TelehealthPatientView } from './TelehealthPatientView';
import { strings } from '../../../strings';

/*
 * THE PAGE'S OWN HEAD, NEUTRAL UNTIL G10 IS ANSWERED (TELEHEALTH-PLAN.md §9).
 * Without a description here the root layout's ("Consent and compliance record
 * for Medicare Assignment of Benefit") is what a link preview shows on the
 * patient's phone. The title drops the product name for the same reason; the
 * wordmark itself is Carl's call (PR #29, "needs Carl's decision").
 */
export const metadata: Metadata = {
  title: strings.telehealth.patient.title,
  description: strings.telehealth.patient.metaDescription,
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
