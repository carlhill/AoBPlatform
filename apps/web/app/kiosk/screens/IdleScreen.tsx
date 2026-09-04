'use client';

/**
 * K-1 — idle. A heading, a button, and nothing else on it.
 *
 * WHAT WAS REMOVED, AND WHY IT WAS NOT ENOUGH TO SOFTEN IT (Carl, 4 Sep 2026:
 * "Remove the 'x people ready to sign' text — this is a security feature").
 *
 * This screen used to carry a COUNT — "3 people are ready to sign" — on the
 * reasoning that a count is not identifying and the names are. That reasoning
 * held for three people and failed for one: "1 person is ready to sign", on a
 * tablet, with one person standing at the desk, is not anonymous. And a tablet
 * on a counter announcing how busy the waiting room is tells everyone in the
 * room something about the people in it. It is gone, not reworded.
 *
 * BEGIN NO LONGER OPENS A LIST. On an ordinary tablet it goes straight to K-2,
 * "Confirm your details": the patient types three details and the SERVER finds
 * the one waiting row that matches (`POST /kiosk/claim`). Nobody's name is
 * displayed before somebody has proved it is theirs.
 *
 * THE LIST SURVIVES FOR TESTING ONLY, on a device the CONSOLE has flagged —
 * never a tick-box on the tablet — and it renders under a permanent banner
 * saying so. `mode: 'list'` is that screen.
 *
 * A FAILED LOAD ENDS AT THE DESK, NOT AT A DEAD END (REQ-REC-04). `error`
 * comes from the poll, which is now a heartbeat rather than a list read: a
 * hidden response carries no names and no count, only the reload flag and the
 * fact that the server answered. That is the health signal Begin is gated on.
 */

import type { ReactNode } from 'react';
import { Blueprint, Screen, Tag } from '../components/Chrome';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import type { KioskWaitingRow } from '../api';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function IdleScreen({
  practiceName,
  locationLine,
  mode,
  rows,
  error,
  anyoneWaiting = true,
  online,
  testDevice,
  onStart,
  onBack,
  onPick,
  onRetry,
}: {
  practiceName: string;
  locationLine: string | null;
  mode: 'idle' | 'list';
  rows: readonly KioskWaitingRow[];
  error: string | null;
  /**
   * FALSE HIDES BEGIN over an empty queue (Carl, 4 Sep 2026): a button that
   * opens a form nobody can pass is worse than a sentence. A boolean from the
   * server, never a count; null (no answer yet) is treated as true so the
   * button is not withheld while the first poll is in flight.
   */
  anyoneWaiting?: boolean | null;
  online: boolean;
  /**
   * THE CONSOLE SAID THIS TABLET MAY SHOW NAMES. It is the ONLY thing that
   * puts `mode: 'list'` on screen, and the banner below is drawn from it — a
   * device showing patient names must always say why (Carl, 4 Sep 2026).
   */
  testDevice: boolean;
  onStart: () => void;
  onBack: () => void;
  onPick: (row: KioskWaitingRow) => void;
  onRetry: () => void;
}): ReactNode {
  const context = online ? strings.chrome.allSynced : strings.chrome.offline;

  if (mode === 'idle') {
    return (
      <Screen practiceName={practiceName} locationLine={locationLine} context={context}>
        <div className={styles.centred}>
          <h1 className={styles.h1}>{strings.idle.heading}</h1>
          {/*
            NO BUTTON THAT PROMISES A LIST THE SERVER COULD NOT SEND (Carl,
            4 Sep 2026). `error` covers a failed fetch, a non-2xx, and a
            device the poll has flagged unpaired but not yet redirected off
            this screen — none of those states have a real waiting list
            behind them, so "Start check-in" is hidden rather than left live
            over nothing, and the failure message is the one thing shown.
            The poll keeps running underneath (`useWaitingList` — no retry
            loop of its own, just the existing cadence); the button returns
            on its own the moment `error` clears.
          */}
          {error ? (
            <p className={styles.error} data-testid="idle-load-failed">
              {strings.idle.loadFailed}
            </p>
          ) : anyoneWaiting === false ? (
            <p className={styles.muted} data-testid="idle-nobody-waiting">
              {strings.idle.nobodyWaitingIdle}
            </p>
          ) : (
            /*
              A HEADING AND A BUTTON. Nothing under it: no count, no "nobody is
              waiting", nothing that describes the room to the room. What the
              button opens depends on the device — K-2 on an ordinary tablet,
              the list on a test device — and the screen looks identical
              either way, which is right: the patient's next tap is the same.
            */
            <PrimaryButton label={strings.idle.start} onPress={onStart} testId="start-check-in" />
          )}
          {testDevice ? (
            <p className={styles.error} data-testid="test-device-banner">
              {strings.idle.testDeviceBanner}
            </p>
          ) : null}
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.idle.listHeading}
      context={context}
    >
      {/*
        THE BANNER IS PERMANENT AND IT IS ABOVE THE NAMES (Carl, 4 Sep 2026 —
        "the list page is only for testing purposes"). Not dismissible: a
        banner that can be closed is a banner that is closed, and the thing it
        is warning about is a screen full of patients' names. Anybody walking
        past should be able to tell in one glance whether this tablet is a test
        rig or a misconfiguration.
      */}
      <p className={styles.error} data-testid="test-device-banner">
        {strings.idle.testDeviceBanner}
      </p>
      <div className={styles.listHeader}>
        <h1 className={styles.h2}>{strings.idle.listHeading}</h1>
        <p className={styles.muted}>{strings.idle.listHint}</p>
      </div>
      {error ? (
        <Blueprint className={styles.panel}>
          <p className={styles.body}>{strings.idle.loadFailed}</p>
          <SecondaryButton label={strings.idle.retry} onPress={onRetry} testId="waiting-retry" />
        </Blueprint>
      ) : null}
      <div className={styles.list}>
        {rows.length === 0 ? (
          <p className={styles.muted}>{strings.idle.nobodyWaiting}</p>
        ) : (
          rows.map((row) => (
            <div key={row.captureRequestId} className={styles.rowWrap} data-testid={`waiting-row-${row.captureRequestId}`}>
              {/*
                STILL TAPPABLE (TODO.md, "Two rulings from pairing day", 4 Sep
                2026). The tag below is a hint that saves a tap, not a lock on
                the row: tapping an unsignable row still works, and goes
                straight to the named hand-over rather than to verification —
                see `Ceremony.tsx`'s `pick`.
              */}
              <SecondaryButton
                label={row.patientName}
                align="left"
                onPress={() => onPick(row)}
                testId={`pick-${row.captureRequestId}`}
              />
              <div className={styles.rowMeta}>
                <Tag label={row.appointmentTime ?? strings.idle.walkIn} />
                {row.providerName ? <Tag label={row.providerName} /> : null}
                {row.signable === false ? (
                  <span data-testid={`unsignable-${row.captureRequestId}`}>
                    <Tag label={strings.idle.pleaseSeeReception} />
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
      <div className={styles.listFooter}>
        <SecondaryButton label={strings.idle.backToIdle} onPress={onBack} testId="back-to-idle" />
      </div>
    </Screen>
  );
}
