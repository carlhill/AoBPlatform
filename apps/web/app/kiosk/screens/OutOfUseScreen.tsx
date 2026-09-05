'use client';

/**
 * THE SCREEN FOR "RECEPTION HAS TAKEN THIS TABLET OFF THE FLOOR" (Carl, 4–5
 * Sep 2026; TODO.md "Tablets: make one inactive from the send-to-tablet page").
 *
 * WHY A TABLET NEEDS THIS AT ALL. A flat battery, a tablet going out for
 * repair, one that has ended up on the wrong desk. Reception's answer used to
 * be either "leave it there and hope nobody picks it up" or "ask an
 * administrator to revoke it" — and revoke throws the credential away, so
 * bringing the tablet back costs a rotate and somebody walking over to type a
 * code in. Neither is a thing a receptionist should have to do to a tablet
 * with a flat battery.
 *
 * SO: A QUIET SCREEN, AND THE TABLET KEEPS HEARTBEATING BEHIND IT. That is the
 * whole distinction from a revoke. The device stays on the console, still says
 * where it is, and one press of "Put back in use" returns it — no re-pairing,
 * no reload, nobody visiting the device (CLAUDE.md §7).
 *
 * IT SAYS THE APPOINTMENT IS UNAFFECTED, because somebody may be holding it
 * when it appears. Nothing about a tablet being out of use touches an
 * agreement, a capture request or a patient being seen (hard rule 8,
 * REQ-REC-04) — and a patient looking at a screen that has just gone blank
 * deserves to be told that in words rather than left to assume.
 *
 * NO BUTTON, for the same reason the outage screen has none: there is nothing
 * on this device that pressing anything could fix, and a control that does
 * nothing is worse than no control. The way out is one press on
 * `/practice/devices`.
 */

import type { ReactNode } from 'react';
import { Blueprint, Screen } from '../components/Chrome';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function OutOfUseScreen({
  practiceName,
  locationLine,
}: {
  practiceName: string;
  locationLine: string | null;
}): ReactNode {
  return (
    <Screen practiceName={practiceName} locationLine={locationLine}>
      <div className={styles.centred}>
        <Blueprint className={styles.panel}>
          <h1 className={styles.h2} data-testid="out-of-use-heading">
            {strings.outOfUse.heading}
          </h1>
          <p className={styles.body} data-testid="out-of-use-body">
            {strings.outOfUse.body}
          </p>
        </Blueprint>
      </div>
    </Screen>
  );
}
