'use client';

/**
 * "Still there?" — the thirty seconds before the tablet returns to the start
 * (Carl, 4 September 2026).
 *
 * IT IS NOT A DIALOG, AND THAT IS THE DESIGN. There is no button, nothing to
 * find, nothing to press and nothing to trap focus: `useInactivityReset`
 * re-arms on any pointer, touch or key event anywhere on the page, so the way
 * to answer "still there?" is to touch the screen — which is what somebody
 * standing at a tablet does anyway. A modal with an "I'm still here" control
 * would ask a person who may be unwell, standing up, to find and press a
 * control they did not ask for, and would block the screen behind it while
 * they did.
 *
 * `pointer-events: none` FOLLOWS FROM THAT. The overlay must not intercept the
 * tap that dismisses it: whatever the patient was reaching for underneath is
 * still what they hit, and the same tap cancels the countdown. An overlay that
 * swallowed the first touch would make the warning cost a tap.
 *
 * WHAT A SCREEN READER HEARS. `role="status"` with `aria-live="polite"` and a
 * SINGLE announcement, not the ticking number — a count re-read once a second
 * would talk over everything else on the screen. The digits are
 * `aria-hidden`; the sentence beside them says what is happening and what to
 * do about it.
 *
 * IT PROMISES NOTHING AND THREATENS NOTHING. Nothing is expiring, no session
 * is ending, and neither the appointment nor the agreement is affected — the
 * tablet is tidying itself up so the next person does not read somebody else's
 * date of birth (REQ-REC-04, hard rule 8).
 */

import type { ReactNode } from 'react';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function InactivityWarning({ secondsLeft }: { secondsLeft: number }): ReactNode {
  return (
    <div className={styles.inactivity} data-testid="inactivity-warning">
      <div className={styles.inactivityCard} role="status" aria-live="polite">
        <p className={styles.inactivityHeading}>{strings.inactivity.heading}</p>
        {/*
          The ticking half, for eyes only. The screen reader is given the
          sentence below instead, once, rather than a number every second.
        */}
        <p className={styles.inactivityCountdown} aria-hidden="true" data-testid="inactivity-countdown">
          {strings.inactivity.countdown(secondsLeft)}
        </p>
        <p className={styles.visuallyHidden}>{strings.inactivity.announcement}</p>
        <p className={styles.inactivityHint} aria-hidden="true">
          {strings.inactivity.dismissHint}
        </p>
      </div>
    </div>
  );
}
