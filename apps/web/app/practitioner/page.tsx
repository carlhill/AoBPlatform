import type { Metadata } from 'next';
import { PractitionerHub } from './PractitionerHub';
import { strings } from '../strings';

export const metadata: Metadata = {
  title: `${strings.practitioner.title} — ${strings.appName}`,
};

export default function PractitionerPage() {
  return <PractitionerHub />;
}
