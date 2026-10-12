'use client';

/**
 * WHERE A REVOKED TABLET LANDS — mid-morning, possibly with a patient holding
 * it.
 *
 * IT ADDRESSES THE PATIENT, unlike the pairing screen next to it, because this
 * one can appear at any moment: the credential is revoked in the console, the
 * next request answers 401, and whatever was on screen is replaced by this. So
 * it says the same thing every dead end on this device says — see reception,
 * your appointment is not affected, nothing has been lost (REQ-REC-04, hard
 * rule 8).
 *
 * IT OFFERS NO RETRY, AND THAT IS THE DESIGN. The credential is dead and will
 * be dead on every future attempt; a Try again would ask the server the same
 * refused question forever. "No retry loop hammering the server" is the
 * requirement (TODO.md, "Zero-footprint kiosk"), and the poll behind this
 * screen has already stopped for the same reason.
 *
 * THE STAFF LINE IS SMALL AND LAST. A patient does not need to know what
 * pairing is; the staff member who comes over does, and the alternative is a
 * tablet that says nothing and gets restarted three times before anyone
 * thinks of the console.
 *
 * NOTHING OF THE PREVIOUS PATIENT SURVIVES THIS. Reaching here drops the
 * ceremony's state exactly as the exit does; the tablet holds no draft, no
 * identifier value and no name.
 */

import type { ReactNode } from 'react';
import { Blueprint, Screen } from '../components/Chrome';
import { PrimaryButton } from '../components/Buttons';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function UnpairedScreen({ onPair }: { onPair: () => void }): ReactNode {
  return (
    <Screen practiceName={strings.appName}>
      <div className={styles.centred}>
        <Blueprint className={styles.panel}>
          <h1 className={styles.h2} data-testid="unpaired-heading">
            {strings.unpaired.heading}
          </h1>
          <p className={styles.body} data-testid="unpaired-body">
            {strings.unpaired.body}
          </p>
          <p className={styles.muted}>{strings.unpaired.staffNote}</p>
        </Blueprint>
        {/*
          THE WAY FORWARD IS PAIRING, NOT RETRYING. It goes to the pairing
          screen, where a staff member can type a fresh code — the one action
          that can actually change the answer.
        */}
        <PrimaryButton label={strings.unpaired.pairAction} onPress={onPair} testId="unpaired-pair" />
      </div>
    </Screen>
  );
}
