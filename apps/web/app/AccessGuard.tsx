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
import { SessionControl } from './SessionControl';
import { currentSession } from './auth';
import { useEffectivePractice } from './effectivePractice';
import { strings } from './strings';

/** Long enough to read the sentence, short enough not to feel stuck. */
const REDIRECT_AFTER_MS = 4000;

export function AccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [refused, setRefused] = useState<'unknown-page' | 'wrong-audience' | 'signed-out' | 'needs-acting-as' | null>(null);
  const [goingTo, setGoingTo] = useState('/');

  /*
   * THE PRACTICE CLAIM, INCLUDING THE ONE ACTING-AS GRANTS.
   *
   * This used to read `session.practiceId` alone — the OIDC token. An operator
   * acting as a practice holds their claim on the SERVER, where the interceptor
   * puts it on the principal, so every endpoint let them through while this
   * guard bounced them off the page four seconds after they arrived. The design
   * says practice pages open when you act as a practice; this is what makes
   * that true in the browser too.
   */
  const { practiceId, settled } = useEffectivePractice();

  useEffect(() => {
    const session = currentSession();

    /*
     * NOT YET. Deciding before the acting-as answer arrives would flash "this
     * page is not yours" at somebody it is. Refusing nothing while we do not
     * know is safe here: this guard is a courtesy, and the endpoints and the
     * database refuse for themselves regardless.
     */
    if (!settled) {
      setRefused(null);
      return;
    }

    /*
     * SIGNED OUT NEEDS ITS OWN ANSWER, and "pass through and let the page cope"
     * was the wrong one.
     *
     * `/practice/reviews` with no session rendered "We could not tell which
     * practice you belong to" — the message for somebody signed in whose token
     * carries no practice claim. Told to a signed-out person it is nonsense:
     * their session says nothing because they have not got one, and the advice
     * to sign out and in again is advice they cannot follow.
     *
     * A page that is `public` still passes through, because those are answered
     * by people who cannot sign in at all — an emailed token, an applicant with
     * no account. Everything else says the one useful thing: sign in.
     */
    if (!session) {
      const rule = ruleFor(pathname);
      setRefused(rule && !rule.audiences.includes('public') ? 'signed-out' : null);
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
      practiceId,
      practitionerId: session.practitionerId,
    });

    const home = landingPath({
      roles: session.roles,
      practiceId,
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
      if (adminOnly && audiences.includes('practice')) {
        setRefused(null);
      } else if (audiences.includes('platform') && rule?.audiences.includes('practice')) {
        /*
         * AN OPERATOR AT A PRACTICE PAGE IS A DIFFERENT REFUSAL.
         *
         * The generic message says "a practice's own screens are not a
         * practitioner's, and the other way round" -- true of the case it was
         * written for and baffling here, because an operator is neither. What
         * they need is the one sentence that resolves it: act as the practice,
         * and here is where to start.
         */
        setRefused('needs-acting-as');
      } else {
        setRefused('wrong-audience');
      }
    } else {
      setRefused(null);
    }
  }, [pathname, practiceId, settled]);

  useEffect(() => {
    /*
     * NOT REDIRECTED WHEN SIGNED OUT. They are already at the page they wanted;
     * bouncing them elsewhere loses it, and after signing in they would have to
     * find their way back. The sign-in control in the header is the way
     * forward, and `returnPath` already brings them back here afterwards.
     */
    if (!refused || refused === 'signed-out') return;
    const timer = setTimeout(() => router.replace(goingTo), REDIRECT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [refused, goingTo, router]);

  if (!refused) return <>{children}</>;

  if (refused === 'signed-out') {
    return (
      <Shell right={<SessionControl audience={strings.access.audience} />}>
        <h1 className={ui.pageTitle}>
          <ShieldAlert size={20} aria-hidden="true" /> {strings.access.signInTitle}
        </h1>
        <Notice tone="warn" title={strings.access.signInNoticeTitle}>{strings.access.signInBody}</Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className={ui.pageTitle}>
        <ShieldAlert size={20} aria-hidden="true" />{' '}
        {refused === 'unknown-page'
          ? strings.access.notFoundTitle
          : refused === 'needs-acting-as'
            ? strings.access.actingAsTitle
            : strings.access.refusedTitle}
      </h1>
      <Notice tone="warn" title={strings.access.takingYouBack}>
        {refused === 'unknown-page'
          ? strings.access.notFoundBody
          : refused === 'needs-acting-as'
            ? strings.access.actingAsBody
            : strings.access.refusedBody}
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
