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

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { landingPath } from '@aobplatform/domain';
import { completeLogin, returnPath } from '../auth';
import { strings } from '../strings';

function CallbackInner() {
  const router = useRouter();
  const [message, setMessage] = useState<string>(strings.auth.completing);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
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
        router.replace(
          landingPath({
            roles: session.roles,
            practiceId: session.practiceId,
            intended: returnPath(),
          }),
        );
      })
      .catch((err) => setMessage(`${strings.auth.failed} ${String(err)}`));
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
