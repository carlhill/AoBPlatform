'use client';

/**
 * Enforcing the page map, and saying something useful when it refuses.
 *
 * WHY THIS EXISTS. A practitioner opened `/practice/reviews` and was told "We
 * could not tell which practice you belong to" — the message a practice user
 * with no claim gets. It is true of them and it is not their problem: they are
 * not an unplaced practice user, they are the wrong audience for that page.
 * Telling somebody to sign out and in again when the answer is "this page is
 * not yours" sends them round a loop that cannot help.
 *
 * `page-access.ts` has known who may open what since it was written. Nothing
 * ever called it. This is the caller.
 *
 * IT IS NOT THE SECURITY BOUNDARY and must not be mistaken for one. Every
 * endpoint behind these pages checks for itself, and the database refuses
 * beyond that. This stops somebody wandering into a page that will not work
 * and explains why — a courtesy, not a control. A guard in the browser is
 * advice; the ones that matter are the two below it.
 *
 * IT SENDS THEM SOMEWHERE THEY CAN USE. `landingPath` already knows where each
 * audience belongs, so the redirect is to their own home rather than to a
 * generic one — a practitioner goes to their hub, an operator to the queue.
 */

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { audiencesOf, landingPath, mayReach, ruleFor } from '@aobplatform/domain';
import { Notice, Shell, ui } from './ui';
import { currentSession } from './auth';
import { strings } from './strings';

/** Long enough to read the sentence, short enough not to feel stuck. */
const REDIRECT_AFTER_MS = 4000;

export function AccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [refused, setRefused] = useState<'unknown-page' | 'wrong-audience' | null>(null);
  const [goingTo, setGoingTo] = useState('/');

  useEffect(() => {
    const session = currentSession();

    /*
     * SIGNED OUT IS NOT REFUSED. Somebody who has not signed in yet has no
     * audience beyond `public`, and telling them a page is not theirs before
     * they have had the chance to sign in would be wrong. The pages that need a
     * session say so themselves.
     */
    if (!session) {
      setRefused(null);
      return;
    }

    /*
     * `consoleRole` IS DELIBERATELY NOT PASSED, and this is the important
     * subtlety. It is not a token claim — it lives on the staff row, which is
     * where it belongs, because a realm role would drift the moment somebody
     * is promoted here without Keycloak being told.
     *
     * Passing `undefined` means this guard never grants `practice_admin`, so
     * it would refuse a REAL administrator opening /practice/users. A false
     * refusal is worse than no guard: it locks somebody out of a page they are
     * entitled to, and they have no way to argue with it.
     *
     * So the admin distinction is left to the server, which can see the row.
     * That page's controls are already hidden by `mayManage`, which the server
     * answers, and its endpoints refuse regardless. This guard's job is the
     * coarse one — practitioner versus practice versus platform — which the
     * token CAN answer.
     */
    const audiences = audiencesOf({
      roles: session.roles,
      practiceId: session.practiceId,
      practitionerId: session.practitionerId,
    });

    const home = landingPath({
      roles: session.roles,
      practiceId: session.practiceId,
      practitionerId: session.practitionerId,
    });
    setGoingTo(home);

    // An unknown page and a forbidden one are DIFFERENT things to be told.
    // "That page does not exist" and "that page is not yours" send somebody to
    // look in different places.
    if (!ruleFor(pathname)) {
      setRefused('unknown-page');
    } else if (!mayReach(pathname, audiences)) {
      /*
       * One exception, for the reason above: a page whose only audience is
       * `practice_admin` is left to the server, because this guard cannot tell
       * an administrator from an ordinary practice user and would refuse both.
       */
      const rule = ruleFor(pathname);
      const adminOnly = rule?.audiences.length === 1 && rule.audiences[0] === 'practice_admin';
      setRefused(adminOnly && audiences.includes('practice') ? null : 'wrong-audience');
    } else {
      setRefused(null);
    }
  }, [pathname]);

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => router.replace(goingTo), REDIRECT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [refused, goingTo, router]);

  if (!refused) return <>{children}</>;

  return (
    <Shell>
      <h1 className={ui.pageTitle}>
        <ShieldAlert size={20} aria-hidden="true" />{' '}
        {refused === 'unknown-page' ? strings.access.notFoundTitle : strings.access.refusedTitle}
      </h1>
      <Notice tone="warn" title={strings.access.takingYouBack}>
        {refused === 'unknown-page' ? strings.access.notFoundBody : strings.access.refusedBody}
      </Notice>
      {/*
        A link as well as the timer. Somebody who reads faster than four seconds
        should not have to wait for a redirect they can see coming, and somebody
        whose timer never fires should not be stranded.
      */}
      <p className={ui.hint}>
        <a href={goingTo}>{strings.access.goNow}</a>
      </p>
    </Shell>
  );
}
