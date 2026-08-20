'use client';

import { Suspense, useEffect, useState } from 'react';
import { completeLogin } from '../auth';
import { strings } from '../strings';

function CallbackInner() {
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
        // Back to the console with the session in memory.
        window.location.replace('/');
      })
      .catch((err) => setMessage(`${strings.auth.failed} ${String(err)}`));
  }, []);

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
