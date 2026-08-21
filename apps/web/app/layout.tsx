import type { ReactNode } from 'react';
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
      <body>{children}</body>
    </html>
  );
}
