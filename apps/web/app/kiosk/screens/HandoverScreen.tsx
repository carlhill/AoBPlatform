'use client';

/**
 * The one screen every dead end on this device ends at: "please see reception".
 *
 * IT EXISTS BECAUSE NOTHING MAY BLOCK CARE (REQ-REC-04). A verification
 * lockout, a rules-engine refusal, a core that stopped answering, a patient who
 * simply wants to talk to a person — each of them stops the EVIDENCE, and none
 * of them may stop the patient. So every dead end on this tablet has a door,
 * the door says the appointment is unaffected, and it resets the device for the
 * next person rather than stranding this one on an error.
 *
 * NARROWER THAN IT WAS. In the Expo build this screen also caught the "someone
 * else is signing" branch, because nothing could re-point an agreement at a new
 * assignor. `POST /agreements/:id/assignor` now can, so that branch continues
 * to K-3 and this screen is left with what it was always for: a lockout, a
 * failure, and somebody walking away.
 */

import type { ReactNode } from 'react';
import { Blueprint, Screen } from '../components/Chrome';
import { PrimaryButton } from '../components/Buttons';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function HandoverScreen({
  practiceName,
  locationLine,
  heading,
  body,
  onDone,
}: {
  practiceName: string;
  locationLine: string | null;
  heading: string;
  body: string;
  onDone: () => void;
}): ReactNode {
  return (
    <Screen practiceName={practiceName} locationLine={locationLine} context={strings.chrome.staffHelp}>
      <div className={styles.centred}>
        <Blueprint className={styles.panel}>
          <h1 className={styles.h2} data-testid="handover-heading">
            {heading}
          </h1>
          <p className={styles.body} data-testid="handover-body">
            {body}
          </p>
          <p className={styles.muted}>{strings.verify.lockedReassurance}</p>
        </Blueprint>
        <PrimaryButton label={strings.errors.startOver} onPress={onDone} testId="handover-done" />
      </div>
    </Screen>
  );
}
