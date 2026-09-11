import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConfirmBackupView } from './ConfirmBackupView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.confirmBackup.title} — ${strings.appName}`,
};

// Suspense because the view reads useSearchParams, which Next requires to be
// inside a boundary during static generation.
export default function ConfirmBackupPage() {
  return (
    <Suspense>
      <ConfirmBackupView />
    </Suspense>
  );
}
