import { Suspense } from 'react';
import type { Metadata } from 'next';
import { StopEmailChangeView } from './StopEmailChangeView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.stopEmail.title} — ${strings.appName}`,
};

export default function StopEmailChangePage() {
  return (
    <Suspense>
      <StopEmailChangeView />
    </Suspense>
  );
}
