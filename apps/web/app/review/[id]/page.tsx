import type { Metadata } from 'next';
import { DossierView } from './DossierView';
import { ReviewerGate } from '../ReviewerGate';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.review.dossierTitle} — ${strings.appName}`,
};

export default async function ReviewDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ReviewerGate>
      <DossierView id={id} />
    </ReviewerGate>
  );
}
