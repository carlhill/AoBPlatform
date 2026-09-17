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
import { audiencesOf, landingPath, mayReach, profileAllows, ruleFor, surfaceOf } from '@aobplatform/domain';
import { Notice, Shell, ui } from './ui';
import { SessionControl } from './SessionControl';
import {
  SILENT_RESTORE_PARAM,
  isSilentRestoreClient,
  type SilentRestoreClient,
} from '@aobplatform/contracts';
import {
  attemptSilentLogin,
  beginLogin,
  currentSession,
  hasSignedInBefore,
  restoreRefusalReason,
  sessionIdleMinutes,
  silentRestoreInFlight,
} from './auth';
import { useEffectivePractice } from './effectivePractice';
import { useSurfaceProfile } from './surfaceProfile';
import { strings } from './strings';

/** Long enough to read the sentence, short enough not to feel stuck. */
const REDIRECT_AFTER_MS = 4000;

/**
 * THE CLIENT AN INVITATION NAMED, IF THIS PAGE LOAD IS THE RETURN FROM ONE.
 *
 * READ ONCE AND THEN ERASED FROM THE ADDRESS BAR. The marker is a fact about
 * THIS arrival, not about the page: leaving it there would put it in a
 * bookmark, a shared link and the back button, where it would ask Keycloak
 * again on every visit for no reason. `replaceState` keeps the history entry,
 * so Back still goes where the person expects.
 *
 * `attemptSilentLogin` keeps its own once-per-document marker, so stripping
 * this cannot cause a second attempt and failing to strip it could not cause
 * one either. This is hygiene, not the guard.
 */
function invitationClient(): SilentRestoreClient | null {
  if (typeof window === 'undefined') return null;
  /*
   * NOTHING IN HERE MAY THROW. This runs inside the guard that decides whether
   * ANY console page renders, so an exception would not degrade the restore —
   * it would break sign-in for everybody. Reading `search` rather than parsing
   * `href` is the smaller ask of the environment, and the tidy-up below is
   * wrapped because it is cosmetic and must never be the reason a page fails.
   */
  const named = new URLSearchParams(window.location.search ?? '').get(SILENT_RESTORE_PARAM);
  if (!named) return null;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(SILENT_RESTORE_PARAM);
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Left in the address bar. `attemptSilentLogin` still refuses a second
    // attempt in this document, so the only cost is an untidy URL.
  }
  return isSilentRestoreClient(named) ? named : null;
}

export function AccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [refused, setRefused] = useState<
    'unknown-page' | 'wrong-audience' | 'signed-out' | 'needs-acting-as' | 'surface-off' | null
  >(null);
  const [goingTo, setGoingTo] = useState('/');
  /** Which part of AoB the practice has not got, for the sentence that says so. */
  const [surfaceOff, setSurfaceOff] = useState<string | null>(null);
  /** A restore this guard asked for, and how it went. See the effects below. */
  const [restoring, setRestoring] = useState(false);
  const [restoreRefused, setRestoreRefused] = useState(false);

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

  /*
   * AND WHAT THAT PRACTICE HAS BOUGHT (D-2026-09-14-04). A SECOND question
   * beside the audience one, deliberately kept separate: `mayReach` answers
   * "may this kind of account open this page" and has never seen a practice,
   * while this answers "does this practice use this part of the product".
   * Both must pass, and folding them together would make one check whose
   * answer depends on two unrelated facts.
   *
   * IT FAILS OPEN — no practice, or a settings read that did not work, means
   * everything. See `surfaceProfile.ts`; the endpoints behind every page
   * refuse for themselves with their own reason code.
   */
  const { profile, settled: profileSettled } = useSurfaceProfile(practiceId);

  useEffect(() => {
    const session = currentSession();

    /*
     * NOT YET. Deciding before the acting-as answer arrives would flash "this
     * page is not yours" at somebody it is. Refusing nothing while we do not
     * know is safe here: this guard is a courtesy, and the endpoints and the
     * database refuse for themselves regardless.
     */
    if (!settled || !profileSettled) {
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
    } else if (practiceId && !profileAllows(profile, pathname)) {
      /*
       * THE AUDIENCE IS RIGHT AND THE PRACTICE HAS NOT GOT IT
       * (D-2026-09-14-04). Its own refusal, because the generic one — "that
       * page is not for this account" — would be a lie: the account is
       * perfectly entitled to the page, and somebody told that goes off to
       * check their sign-in, which cannot help them.
       *
       * ONLY WHEN THERE IS A PRACTICE TO ASK ABOUT. A signed-in person with no
       * practice claim has no profile that could answer, and refusing them
       * here would take the platform's own pages away from an operator.
       */
      setSurfaceOff(surfaceOf(pathname));
      setRefused('surface-off');
    } else {
      setRefused(null);
    }
  }, [pathname, practiceId, settled, profile, profileSettled]);

  /*
   * THE ONE PLACE THE SILENT RESTORE IS ASKED FOR (Carl, 7 Sep 2026, second
   * round: a NEW tab on /practice/setup with a live Keycloak session showed
   * "You are not signed in", and no redirect ever left the page).
   *
   * WHY IT HAD TO MOVE HERE. `attemptSilentLogin` was called from exactly two
   * components — `usePractice` and `PracticeList` — so whether a page ever
   * asked Keycloak anything depended on which hook it happened to mount.
   * `/practice/setup` mounts neither, and nor do most console pages. Worse,
   * this guard REPLACES the children of every non-public page when there is no
   * session, so on those pages the two callers were never rendered at all: no
   * console page reliably attempted a restore, and the ones that seemed to were
   * winning a race against `useEffectivePractice` settling.
   *
   * THIS COMPONENT IS THE ONE THAT ALWAYS RUNS. It is in the root layout, so
   * every page renders it, and it already knows from `ruleFor(pathname)`
   * whether the page is a gated console page or a public one — which is exactly
   * the question "should this browser be signed in here?". `refused ===
   * 'signed-out'` IS that condition, already computed above.
   *
   * NOTHING PUBLIC IS TOUCHED, and that matters more than it looks: `/kiosk`,
   * `/patient/*`, `/apply`, `/verify` and `/callback` are all `public` in the
   * page map, so none of them can be sent to Keycloak from here. A waiting-room
   * tablet redirected to a sign-in page would be the worst possible version of
   * this bug (CLAUDE.md §7, zero-footprint kiosk).
   *
   * ONLY FOR A BROWSER THAT HAS SIGNED IN HERE. `hasSignedInBefore()` is a hint,
   * not a credential — it holds no token and grants nothing. Without it, a
   * first-time visitor would be sent on a pointless round trip to Keycloak and
   * shown "Signing you back in…" about a session they have never had.
   *
   * ONCE PER DOCUMENT: `attemptSilentLogin` keeps its own marker and refuses a
   * second attempt in the same page load.
   */
  useEffect(() => {
    if (refused !== 'signed-out') return;
    /*
     * AGAINST THE CLIENT THIS BROWSER ACTUALLY SIGNED IN WITH, which is what
     * the hint stores. The console and the reviewer console are separate
     * Keycloak clients on purpose — a practice token and a platform token must
     * never be interchangeable (auth.ts) — so restoring a reviewer's session
     * against the default `web` client would ask the wrong question and get a
     * wrong or useless answer. It only mattered once the attempt moved here:
     * the two callers it replaced were practice pages, always `web`.
     */
    /*
     * OR BECAUSE AN INVITATION SAID SO (Carl, 12 Sep 2026). A practitioner who
     * has just registered a passkey through the setup email HAS a realm session
     * and has never signed in here, so the hint is absent and the first thing
     * the platform said to them was "you are not signed in". The invitation's
     * return URL carries `aob_restore=<client>` for exactly this moment.
     *
     * IT IS PERMISSION TO ASK, NOT A CREDENTIAL. It grants nothing: the worst a
     * forged one can do is spend one redirect discovering there is no session,
     * which is what an honest one does after the session expires. The value is
     * checked against the two real clients rather than passed to Keycloak as
     * typed.
     */
    const invited = invitationClient();
    /*
     * AN INVITATION IS SIGNED IN PROPERLY, NOT RESTORED — AND THE DIFFERENCE IS
     * THE WHOLE BUG (corrected 12 Sep 2026, after the first attempt failed on
     * Carl's machine).
     *
     * The first version of this treated the invitation like a returning tab and
     * asked Keycloak `prompt=none`. It could never have worked. A
     * `execute-actions-email` link authenticates FOR THE DURATION OF THE ACTION
     * and leaves no browser SSO session behind — measured, not assumed: after
     * three successful registrations Jo had three passkeys and zero sessions.
     * There was nothing to restore, so the silent attempt returned
     * `login_required` every time and the person still read "you are not
     * signed in".
     *
     * So the invitation starts a REAL sign-in. It is not a round trip wasted on
     * somebody who never asked for it: they have this second finished
     * registering a passkey, they arrived here from our own email, and the
     * sign-in they get is one touch of the key they just made. `beginLogin`
     * keeps the destination, so they land where the invitation was pointing.
     */
    if (invited) {
      void beginLogin(invited);
      return;
    }
    const client = hasSignedInBefore();
    if (!client) return;
    void attemptSilentLogin(client);
  }, [refused]);

  /*
   * AND WHAT TO SAY WHILE IT RUNS. Read straight after the attempt above — the
   * effects run in order, and `attemptSilentLogin` opens its window
   * synchronously before its first `await`, so the first read already sees it.
   */
  useEffect(() => {
    if (refused !== 'signed-out') {
      setRestoring(false);
      setRestoreRefused(false);
      return;
    }
    setRestoring(silentRestoreInFlight());
    setRestoreRefused(restoreRefusalReason() !== null);
  }, [refused]);

  /*
   * A FAST TICK, AND ONLY WHILE THE ATTEMPT IS OPEN. It closes in tens of
   * milliseconds when Keycloak answers; the redirect tears this document down
   * when it succeeds, and the grace period ends it when it does not. The
   * interval stops itself the moment `restoring` goes false.
   */
  useEffect(() => {
    if (!restoring) return;
    const tick = setInterval(() => {
      setRestoring(silentRestoreInFlight());
      setRestoreRefused(restoreRefusalReason() !== null);
    }, 250);
    return () => clearInterval(tick);
  }, [restoring]);

  useEffect(() => {
    /*
     * NOT REDIRECTED WHEN SIGNED OUT. They are already at the page they wanted;
     * bouncing them elsewhere loses it, and after signing in they would have to
     * find their way back. The sign-in control in the header is the way
     * forward, and `returnPath` already brings them back here afterwards.
     */
    /*
     * NOR WHEN A SURFACE IS OFF. That screen's whole value is the link to the
     * place it is switched on; a redirect four seconds later takes the answer
     * away while somebody is still reading the question. Both links on it go
     * somewhere useful, so nobody is stranded.
     */
    if (!refused || refused === 'signed-out' || refused === 'surface-off') return;
    const timer = setTimeout(() => router.replace(goingTo), REDIRECT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [refused, goingTo, router]);

  if (!refused) return <>{children}</>;

  if (refused === 'signed-out') {
    return (
      <Shell right={<SessionControl audience={strings.access.audience} />}>
        {/*
          THREE THINGS THIS SCREEN CAN MEAN, and they were all one sentence.

          RESTORING: a redirect to Keycloak is in flight and nobody is being
          asked for anything. No sign-in prompt and no refusal — offering one
          would invite a second, interactive login on top of the silent one.

          REFUSED: this browser HAD signed in here and Keycloak has said the
          session is gone. "You are not signed in" describes that and hides the
          cause; the idle rule and the way back are what somebody needs.

          NEITHER: the original copy, which is true of a browser that has never
          been here.
        */}
        {restoring ? (
          <h1 className={ui.pageTitle} data-testid="access-restoring">
            <ShieldAlert size={20} aria-hidden="true" /> {strings.auth.signingBackIn}
          </h1>
        ) : restoreRefused ? (
          <>
            <h1 className={ui.pageTitle} data-testid="access-restore-refused">
              <ShieldAlert size={20} aria-hidden="true" /> {strings.auth.restoreRefusedHeading}
            </h1>
            <Notice tone="warn" title={strings.auth.restoreRefusedHeading}>
              {strings.auth.restoreRefusedBody(sessionIdleMinutes())}
            </Notice>
          </>
        ) : (
          <>
            <h1 className={ui.pageTitle} data-testid="access-signed-out">
              <ShieldAlert size={20} aria-hidden="true" /> {strings.access.signInTitle}
            </h1>
            <Notice tone="warn" title={strings.access.signInNoticeTitle}>{strings.access.signInBody}</Notice>
          </>
        )}
      </Shell>
    );
  }

  /*
   * A SURFACE THAT IS OFF GETS ITS OWN SCREEN, not a third branch inside the
   * generic one. It is the only refusal here whose answer is a setting rather
   * than an account, so it is the only one that can name the thing and the
   * place it is turned on (CLAUDE.md §7, "Shortcuts to the answer"). An
   * unmapped surface key shows the key, so a new surface is diagnosable rather
   * than a blank.
   */
  if (refused === 'surface-off') {
    return (
      <Shell right={<SessionControl audience={strings.access.audience} />}>
        <h1 className={ui.pageTitle} data-testid="access-surface-off">
          <ShieldAlert size={20} aria-hidden="true" /> {strings.access.surfaceOffTitle}
        </h1>
        <Notice tone="warn" title={strings.access.takingYouBack}>
          {strings.access.surfaceOffBody}
          {surfaceOff && (
            <>
              {' '}
              <span data-testid="access-surface-name">
                {strings.access.surfaceOffWhich.replace(
                  '{surface}',
                  strings.channels.surfaceNames[surfaceOff] ?? surfaceOff,
                )}
              </span>
            </>
          )}
        </Notice>
        <p className={ui.hint}>
          <a href="/practice/channels" data-testid="access-surface-off-channels">
            {strings.access.surfaceOffGoToChannels}
          </a>
        </p>
        <p className={ui.hint}>
          <a href={goingTo}>{strings.access.goNow}</a>
        </p>
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
