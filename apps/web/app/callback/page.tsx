'use client';

/**
 * The OIDC redirect target.
 *
 * IT NAVIGATES WITH THE ROUTER, NOT `window.location`, and that is the whole
 * reason this file has a comment.
 *
 * The access token is held in a module-level variable and deliberately nowhere
 * else — not localStorage, not sessionStorage — because a token for practice
 * data should not sit where any script on the page can read it. That decision
 * has a consequence which is easy to miss: `window.location.replace()` is a
 * FULL PAGE LOAD, every module is re-evaluated, and the session that was just
 * created is gone.
 *
 * The symptom was exact and baffling: "signed in as carl@hillsempire.com"
 * flashed on screen, the browser moved on, and the sign-in gate appeared again.
 * The exchange had worked perfectly every time.
 *
 * A client-side navigation keeps the JavaScript context, so the session
 * survives. The token still never touches storage.
 */

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { landingPath } from '@aobplatform/domain';
import { completeLogin, currentSession, returnPath, silentLoginFailed } from '../auth';
import { strings } from '../strings';

function CallbackInner() {
  const router = useRouter();
  const [message, setMessage] = useState<string>(strings.auth.completing);
  /*
   * NAVIGATE ONCE, READ THE RETURN PATH ONCE (Carl, 12 Sep 2026: Ctrl+F5 on
   * /practice/setup landed on /practice/today).
   *
   * THE MECHANISM. In development React runs every effect twice. Both runs
   * call `completeLogin`, which de-duplicates to the SAME in-flight promise, so
   * both `.then`s fire. `returnPath()` deletes the stored path on read: the
   * first run got `/practice/setup`, the second got nothing, fell to the
   * audience's default, and its `router.replace` ran last and won.
   *
   * WHY NOBODY SAW IT BEFORE TODAY. The practice default WAS `/practice/setup`,
   * so the wrong answer and the right one were the same page. The moment the
   * default moved to `/practice/today`, a latent double-consume became a
   * visible redirect. The bug was always here; the landing change exposed it.
   *
   * A REF, NOT STATE: it must not cause a render, and strict mode preserves it
   * across the simulated remount, which is exactly the case it guards.
   */
  const navigated = useRef(false);
  const navigateOnce = (to: () => string) => {
    if (navigated.current) return;
    navigated.current = true;
    router.replace(to());
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      /*
       * `login_required` is not a failure. It is the ANSWER to a silent
       * attempt: Keycloak was asked to restore an existing session without
       * prompting, and there was not one. Showing it as an error would put
       * "Sign-in failed: login_required" in front of somebody who had simply
       * not signed in yet.
       */
      if (error === 'login_required' || error === 'interaction_required') {
        /*
         * THE CODE TRAVELS, so the page we land back on can say WHY rather than
         * only that nobody is signed in. Keycloak's own word, never a token and
         * never a name (Carl, 7 Sep 2026).
         */
        silentLoginFailed(error);
        navigateOnce(() => returnPath());
        return;
      }
      setMessage(`${strings.auth.failed} ${params.get('error_description') ?? error}`);
      return;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      setMessage(strings.auth.noCode);
      return;
    }

    completeLogin(code, state)
      .then((session) => {
        setMessage(`${strings.auth.signedInAs} ${session.username ?? session.roles.join(', ')}`);
        // Back to WHERE THEY STARTED, and by client-side navigation so the
        // in-memory session survives. `returnPath` refuses anything that is not
        // a same-origin path — a stored destination followed without checking
        // is an open redirect.
        /*
         * WHERE THEY LAND is a rule, not a line here — the same one the root
         * page and the practice gate use. A practice administrator who signed
         * in with a passkey used to arrive on the developer scaffold, because
         * nothing decided anything: `returnPath()` answers '/' when there is
         * nowhere stored, and '/' was taken literally.
         */
        navigateOnce(() =>
          landingPath({
            roles: session.roles,
            practiceId: session.practiceId,
            practitionerId: session.practitionerId,
            intended: returnPath(),
          }),
        );
      })
      .catch((err) => {
        /*
         * A SESSION THAT ALREADY EXISTS BEATS THE ERROR.
         *
         * An authorization code is single-use, so a second arrival at this page
         * with the same code fails -- correctly -- with "Code not valid". By
         * then the person IS signed in, and telling them "Sign-in failed" sends
         * them off to fix something that already worked. `completeLogin` now
         * de-duplicates the exchange itself; this is the belt to that braces,
         * covering the case where the failure happened for some other reason
         * but the session is nonetheless there.
         */
        if (currentSession()) {
          navigateOnce(() => landingPath({ ...currentSession()!, intended: returnPath() }));
          return;
        }
        setMessage(`${strings.auth.failed} ${String(err)}`);
      });
    // `router` is stable across renders, so this runs once — which matters,
    // because the authorization code is single-use and a second attempt would
    // present a spent one.
  }, [router]);

  return <p>{message}</p>;
}

export default function CallbackPage() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>{strings.appName}</h1>
      <Suspense fallback={<p>{strings.auth.completing}</p>}>
        <CallbackInner />
      </Suspense>
    </main>
  );
}
