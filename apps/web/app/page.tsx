'use client';

/**
 * The root, which is a SIGNPOST rather than a destination.
 *
 * WHAT WENT WRONG HERE. A practice administrator enrolled a passkey, signed in,
 * and landed on this page — a developer scaffold headed "Scaffold status view",
 * offering the practice-onboarding form they had already completed and a
 * console for organisations that are not theirs. Nothing was broken; nothing
 * had decided where they should go.
 *
 * So anybody the session can identify is sent on:
 *
 *   - a PRACTICE USER — anybody carrying a practice claim — to their own hub
 *   - a PLATFORM OPERATOR to the review queue
 *
 * and only somebody the session cannot place sees the scaffold, which is the
 * one audience it was ever for.
 *
 * The rule lives in the domain and is shared with the OIDC callback, because
 * "where does this person go" giving two answers in two places is exactly how
 * the scaffold came to be somebody's home page.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { landingPath } from '@aobplatform/domain';
import { ConsoleDashboard } from './ConsoleDashboard';
import { OrgConsole } from './OrgConsole';
import { AuthGate } from './AuthGate';
import { strings } from './strings';
import { currentSession } from './auth';

export default function Home() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const session = currentSession();
    const to = session
      ? landingPath({
          roles: session.roles,
          practiceId: session.practiceId,
          practitionerId: session.practitionerId,
        })
      : '/';
    if (to !== '/') {
      // `replace`, not `push`: the scaffold should not sit in the back stack
      // of somebody who was never meant to see it.
      router.replace(to);
      return;
    }
    setChecked(true);
  }, [router]);

  // Nothing is rendered while the decision is being made. Painting the
  // scaffold first and redirecting after would show a practice administrator
  // an onboarding form, briefly, every single time they sign in.
  if (!checked) return null;

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 1000 }}>
      <h1>{strings.appName}</h1>
      <p>{strings.console.subtitle}</p>
      <AuthGate>
        <OrgConsole />
      </AuthGate>
      <hr style={{ margin: '2rem 0', border: 0, borderTop: '1px solid #d0d7de' }} />
      <ConsoleDashboard />
    </main>
  );
}
