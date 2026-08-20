import type { ReactNode } from 'react';

// UK/AU spelling in all user-facing text (CLAUDE.md §3). All user-facing
// strings move to the string table (REQ-LANG-01) as real screens are built.
export const metadata = {
  title: 'AoBPlatform',
  description: 'Consent and compliance record for Medicare Assignment of Benefit',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
