'use client';

/**
 * THE SCREEN FOR "CORE STOPPED ANSWERING" (TODO.md "Outage screen on the
 * tablet", Carl 4 Sep 2026: "When the server is down, hide everything and say,
 * Please contact reception.").
 *
 * IT REPLACES THE WHOLE SCREEN, NOT A BANNER OVER IT. Carl watched Begin still
 * showing while core was down — a patient could press it, type three
 * identifiers into a tablet that cannot check them, and be told nothing until
 * the claim failed. This is what `useOutageState` swaps in instead, on every
 * screen but pairing and unpaired (a staff-only screen with no patient
 * standing at it, and a screen that is already the "see reception" answer to
 * a different problem).
 *
 * NOTHING BUT THE TWO SENTENCES (Carl's words: "hide everything"). No field,
 * no half-drawn agreement, no patient detail — whatever the ceremony was
 * holding when the outage was declared stays in memory, unseen, until either
 * the server answers again (`Ceremony.tsx` drops it all and returns to idle)
 * or somebody switches the tablet off. There is no button here and no way
 * out: "leave" is a request this tablet cannot make right now either, and a
 * control that does nothing is worse than no control (CLAUDE.md §6).
 *
 * THE FOOTER IS UNCHANGED — same `Screen` chrome as every other screen, so
 * the build mark and (network permitting) the device identity still name this
 * tablet for whoever picks up the phone (TODO.md: "a version banner support
 * can read").
 */

import type { ReactNode } from 'react';
import { Blueprint, Screen } from '../components/Chrome';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function OutageScreen({
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
          <h1 className={styles.h2} data-testid="outage-heading">
            {strings.outage.heading}
          </h1>
          <p className={styles.body} data-testid="outage-body">
            {strings.outage.body}
          </p>
        </Blueprint>
      </div>
    </Screen>
  );
}
