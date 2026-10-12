import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ConfirmEmailView } from './ConfirmEmailView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.confirmEmail.title} — ${strings.appName}`,
};

export default function ConfirmEmailPage() {
  // `useSearchParams` needs a Suspense boundary, and the token lives there.
  return (
    <Suspense>
      <ConfirmEmailView />
    </Suspense>
  );
}
