import type { Metadata } from 'next';
import { DossierView } from './DossierView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.review.dossierTitle} — ${strings.appName}`,
};

export default async function ReviewDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DossierView id={id} />;
}
