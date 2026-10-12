'use client';

/**
 * A page that does not exist, said plainly and then left behind.
 *
 * Next's default is a bare "404 | This page could not be found" on a blank
 * page — no header, no sign-out, and no way onward except the back button.
 * Somebody who mistyped a URL or followed a stale link is left to work out
 * where they were supposed to be.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass } from 'lucide-react';
import { landingPath } from '@aobplatform/domain';
import { Notice, Shell, ui } from './ui';
import { currentSession } from './auth';
import { strings } from './strings';

const REDIRECT_AFTER_MS = 4000;

export function NotFoundView() {
  const router = useRouter();
  const [goingTo, setGoingTo] = useState('/');

  useEffect(() => {
    const session = currentSession();
    // Signed out, the public landing page IS where they belong.
    const home = session
      ? landingPath({
          roles: session.roles,
          practiceId: session.practiceId,
          practitionerId: session.practitionerId,
        })
      : '/';
    setGoingTo(home);

    const timer = setTimeout(() => router.replace(home), REDIRECT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <Shell>
      <h1 className={ui.pageTitle}>
        <Compass size={20} aria-hidden="true" /> {strings.access.notFoundTitle}
      </h1>
      <Notice tone="warn" title={strings.access.takingYouBack}>
        {strings.access.notFoundBody}
      </Notice>
      <p className={ui.hint}>
        <a href={goingTo}>{strings.access.goNow}</a>
      </p>
    </Shell>
  );
}
