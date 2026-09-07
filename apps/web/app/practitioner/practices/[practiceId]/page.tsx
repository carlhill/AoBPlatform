import type { Metadata } from 'next';
import { PracticeView } from './PracticeView';
import { strings } from '../../../strings';

export const metadata: Metadata = {
  title: `${strings.practicePublic.title} — ${strings.appName}`,
};

export default async function PractitionerPracticePage({
  params,
}: {
  params: Promise<{ practiceId: string }>;
}) {
  const { practiceId } = await params;
  return <PracticeView practiceId={practiceId} />;
}
