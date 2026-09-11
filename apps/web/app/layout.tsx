import type { ReactNode } from 'react';
import { AccessGuard } from './AccessGuard';
import './tokens.css';

// UK/AU spelling in all user-facing text (CLAUDE.md §3). All user-facing
// strings live in the string table (REQ-LANG-01).
export const metadata = {
  title: 'AoBPlatform',
  description: 'Consent and compliance record for Medicare Assignment of Benefit',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // lang is en-AU so a screen reader pronounces "Yagoona" and "ABN" the way an
  // Australian reader expects, and so spell-checking matches our own spelling.
  return (
    <html lang="en-AU">
      {/*
        THE PAGE MAP, ENFORCED. It has known who may open what since it was
        written and nothing called it — so a practitioner opening a practice
        screen was told "we could not tell which practice you belong to", which
        is true of them and not their problem.

        Advisory, not a boundary: every endpoint behind these pages checks for
        itself and the database refuses beyond that. This stops somebody
        wandering somewhere that will not work, and says why.
      */}
      <body>
        <AccessGuard>{children}</AccessGuard>
      </body>
    </html>
  );
}
