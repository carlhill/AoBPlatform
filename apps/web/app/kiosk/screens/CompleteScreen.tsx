'use client';

/**
 * K-6 — done, and back to idle.
 *
 * IT REPORTS THE EVENT, NOT SUCCESS ON ITS OWN AUTHORITY (handoff §6). The
 * heading appears because the server returned a stored agreement and a
 * completed capture request; the write-back line says "being written back",
 * because that is a queued sweep and claiming it landed would be a claim the
 * kiosk cannot support.
 *
 * NO PORTAL ACTIVATION HERE. The handoff offers it and the MVP scope
 * explicitly excludes it — an optional account is a whole flow (identity,
 * delivery, revocation) and building half of it would be worse than not
 * offering it.
 *
 * NOTHING PATIENT-IDENTIFYING SURVIVES THIS SCREEN, and there is no way back
 * to it. The countdown returns to idle and the ceremony drops every piece of
 * state it held; the sub-steps are component state rather than routes, so
 * there is no history entry for the next person to walk back through
 * (C2: no residual patient data on device).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Screen } from '../components/Chrome';
import { PrimaryButton } from '../components/Buttons';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

/** The Expo build's timeout, unchanged. Long enough to read, short enough to clear the counter. */
export const RETURN_SECONDS = 20;

export function CompleteScreen({
  practiceName,
  locationLine,
  givenName,
  enduringProviderName,
  sessionId,
  onDone,
}: {
  practiceName: string;
  locationLine: string | null;
  givenName: string;
  /**
   * WHAT IS DIFFERENT ABOUT HAVING SIGNED AN ONGOING AGREEMENT (Carl, 4 Sep
   * 2026). Passed only for that type, and it carries the PROVIDER'S name
   * because that is where hard rule 6 would otherwise be quietly broken in the
   * patient's head: an ongoing agreement is per practitioner x patient and
   * never practice-wide (REQ-END-01), and "you will not be asked again here"
   * would say the opposite.
   */
  enduringProviderName?: string | null;
  /** The pushed session's own id — an audit/testing aid in the footer. See `Chrome.tsx`'s `Screen`. */
  sessionId?: string | null;
  onDone: () => void;
}): ReactNode {
  const [remaining, setRemaining] = useState(RETURN_SECONDS);

  useEffect(() => {
    if (remaining <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onDone]);

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.complete}
      context={strings.complete.writeBackQueued}
      sessionId={sessionId}
    >
      <div className={styles.centred}>
        <h1 className={styles.h1Small} data-testid="complete-heading">
          {strings.complete.heading(givenName)}
        </h1>
        <p className={styles.lede}>{strings.complete.body}</p>
        {enduringProviderName ? (
          <p className={styles.lede} data-testid="complete-enduring">
            {strings.complete.enduringBody(enduringProviderName)}
          </p>
        ) : null}
        <PrimaryButton label={strings.complete.done} onPress={onDone} testId="complete-done" />
        <p className={styles.muted}>{strings.complete.returning(remaining)}</p>
      </div>
    </Screen>
  );
}
