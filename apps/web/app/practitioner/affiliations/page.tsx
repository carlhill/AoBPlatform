import type { Metadata } from 'next';
import { AffiliationsView } from './AffiliationsView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.myAffiliations.title} — ${strings.appName}`,
};

export default function PractitionerAffiliationsPage() {
  return <AffiliationsView />;
}
